import type { IDockviewPanelProps } from 'dockview-react';
import { useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { ChatMarkdownRenderer } from '@/components/chat-markdown-renderer';
import { Button } from '@/components/ui/button';
import { pendingFixReviewIssuesAtom } from '../../agents/atoms';
import { renderBuiltinPrompt } from '../../../../prompts/render';
import type { ReviewPanelEntity } from '../atoms';

/**
 * Full-panel view of a review artifact. Mirrors PlanPanel: a header bar with
 * the action button on top, scrollable markdown body below. The Fix button
 * uses the same `pendingFixReviewIssuesAtom` flow as the inline chat card —
 * ChatViewInner picks up the pending message and runs the agent against the
 * persisted review (which is read back via the `read_review` MCP tool).
 */
export function ReviewPanel({ params, api, containerApi }: IDockviewPanelProps<ReviewPanelEntity>) {
  const { data } = trpc.chats.getReviewContent.useQuery(
    { subChatId: params.subChatId },
    { enabled: !!params.subChatId }
  );
  const content = data?.exists ? data.content : null;

  const setPendingFixReviewIssues = useSetAtom(pendingFixReviewIssuesAtom);

  const contentRef = useRef<HTMLDivElement>(null);
  const topGradientRef = useRef<HTMLDivElement>(null);
  const bottomGradientRef = useRef<HTMLDivElement>(null);

  const updateScrollGradients = useCallback(() => {
    const el = contentRef.current;
    const top = topGradientRef.current;
    const bot = bottomGradientRef.current;
    if (!el || !top || !bot) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const scrollable = scrollHeight > clientHeight;
    top.style.opacity = scrollable && scrollTop > 1 ? '1' : '0';
    bot.style.opacity = scrollable && scrollTop + clientHeight < scrollHeight - 1 ? '1' : '0';
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollGradients);
    updateScrollGradients();
    return () => el.removeEventListener('scroll', updateScrollGradients);
  }, [updateScrollGradients]);

  useEffect(() => {
    updateScrollGradients();
  }, [content, updateScrollGradients]);

  const handleFix = useCallback(() => {
    if (!params.subChatId) return;
    setPendingFixReviewIssues({
      subChatId: params.subChatId,
      message: renderBuiltinPrompt('workflow/fix-review-issues', { subChatId: params.subChatId })
    });
    // Navigate back to the chat for this sub-chat (so the user sees the agent
    // start working) and close this panel — same UX as PlanPanel's Approve.
    const chatPanel = containerApi.getPanel(`chat:${params.subChatId}`);
    if (chatPanel) chatPanel.api.setActive();
    api.close();
  }, [params.subChatId, setPendingFixReviewIssues, api, containerApi]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {content && (
        <div className="flex items-center justify-end gap-2 px-3 h-9 border-b border-border bg-muted/30 flex-shrink-0">
          <Button
            size="sm"
            onClick={handleFix}
            className="h-6 px-3 text-xs font-medium rounded transition-transform duration-150 active:scale-[0.97]">
            Fix
          </Button>
        </div>
      )}
      {content ? (
        <div className="relative flex-1 min-h-0">
          <div
            ref={topGradientRef}
            className="absolute top-0 left-0 right-0 h-6 pointer-events-none z-10 transition-opacity duration-150"
            style={{
              opacity: 0,
              background:
                'linear-gradient(to bottom, color-mix(in srgb, hsl(var(--muted)) 30%, hsl(var(--background))) 0%, transparent 100%)'
            }}
          />
          <div ref={contentRef} className="h-full overflow-y-auto allow-text-selection px-4 py-3">
            <ChatMarkdownRenderer content={content} size="sm" />
          </div>
          <div
            ref={bottomGradientRef}
            className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none z-10 transition-opacity duration-150"
            style={{
              opacity: 1,
              background: 'linear-gradient(to top, hsl(var(--background)) 0%, transparent 100%)'
            }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-xs text-muted-foreground">No review yet</p>
        </div>
      )}
    </div>
  );
}
