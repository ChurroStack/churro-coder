'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { ChatMarkdownRenderer } from '../../../components/chat-markdown-renderer';
import { CheckIcon, ClipboardIcon, CollapseIcon, CopyIcon, ExpandIcon } from '../../../components/ui/icons';
import { TextShimmer } from '../../../components/ui/text-shimmer';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { trpc } from '../../../lib/trpc';
import { pendingFixReviewIssuesAtom } from '../atoms';
import { addOrFocus } from '../../dock/add-or-focus';
import { useDockApi } from '../../dock/dock-context';
import { getToolStatus } from './agent-tool-registry';
import { areToolPropsEqual } from './agent-tool-utils';
import { renderBuiltinPrompt } from '../../../../prompts/render';

interface AgentReviewToolProps {
  part: {
    type: string;
    state?: string;
    input?: {
      markdown?: string;
      title?: string;
    };
    output?: string;
  };
  chatStatus?: string;
  subChatId?: string;
}

/**
 * AgentReviewTool — shown when the agent calls the `write_review` MCP tool.
 * Mirrors the AgentPlanFileTool layout: collapsed header + expandable content +
 * action footer with "View review" and "Fix issues" buttons.
 */
export const AgentReviewTool = memo(function AgentReviewTool({ part, chatStatus, subChatId }: AgentReviewToolProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { isPending } = getToolStatus(part, chatStatus);
  const setPendingFixReviewIssues = useSetAtom(pendingFixReviewIssuesAtom);
  const dockApi = useDockApi();

  const contentRef = useRef<HTMLDivElement>(null);
  const topGradientRef = useRef<HTMLDivElement>(null);
  const bottomGradientRef = useRef<HTMLDivElement>(null);

  const isActivelyStreaming = chatStatus === 'streaming' || chatStatus === 'submitted';
  const isInputStreaming = part.state === 'input-streaming' && isActivelyStreaming;
  const shouldShowShimmer = isPending || isInputStreaming;

  const reviewContentFromPart = part.input?.markdown || '';

  // Fallback: if the tool part has no content (e.g. input not yet populated),
  // load it from the persisted review store.
  const { data: storedReview } = trpc.chats.getReviewContent.useQuery(
    { subChatId: subChatId ?? '' },
    { enabled: !!subChatId && !reviewContentFromPart }
  );
  const reviewContent = reviewContentFromPart || (storedReview?.exists ? (storedReview.content ?? '') : '');
  const hasVisibleContent = reviewContent.length > 0;

  const updateScrollGradients = useCallback(() => {
    const content = contentRef.current;
    const topGradient = topGradientRef.current;
    const bottomGradient = bottomGradientRef.current;
    if (!content || !topGradient || !bottomGradient) return;

    const { scrollTop, scrollHeight, clientHeight } = content;
    const isScrollable = scrollHeight > clientHeight;
    const isAtTop = scrollTop <= 1;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

    topGradient.style.opacity = isScrollable && !isAtTop ? '1' : '0';
    bottomGradient.style.opacity = isScrollable && !isAtBottom ? '1' : '0';
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.addEventListener('scroll', updateScrollGradients);
    updateScrollGradients();
    return () => content.removeEventListener('scroll', updateScrollGradients);
  }, [updateScrollGradients, isExpanded]);

  useEffect(() => {
    updateScrollGradients();
  }, [reviewContent, updateScrollGradients]);

  const handleToggleExpand = useCallback(() => setIsExpanded((prev) => !prev), []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(reviewContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [reviewContent]);

  const handleViewReview = useCallback(() => {
    if (!dockApi || !subChatId) return;
    addOrFocus(dockApi, { kind: 'review', data: { subChatId } });
  }, [dockApi, subChatId]);

  const handleFixIssues = useCallback(() => {
    if (!subChatId) return;
    setPendingFixReviewIssues({
      subChatId,
      message: renderBuiltinPrompt('workflow/fix-review-issues', { subChatId })
    });
  }, [subChatId, setPendingFixReviewIssues]);

  if (!hasVisibleContent) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5">
        {!shouldShowShimmer && <ClipboardIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
        <span className="text-xs text-muted-foreground">
          {shouldShowShimmer ? (
            <TextShimmer as="span" duration={1.2}>
              Writing review...
            </TextShimmer>
          ) : (
            'Review'
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden mx-2">
      {/* Header */}
      <div
        onClick={handleToggleExpand}
        className="flex items-center justify-between pl-2.5 pr-0.5 h-7 cursor-pointer hover:bg-muted/50 transition-colors duration-150">
        <div className="flex items-center gap-1.5 text-xs truncate flex-1 min-w-0">
          <ClipboardIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
          {shouldShowShimmer ? (
            <TextShimmer as="span" duration={1.2} className="truncate">
              Writing review...
            </TextShimmer>
          ) : (
            <span className="truncate text-foreground font-medium">Review</span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {hasVisibleContent && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className="group p-1 rounded-md hover:bg-accent transition-[background-color,transform] duration-150 ease-out active:scale-95">
                  <div className="relative w-3.5 h-3.5">
                    <CopyIcon
                      className={cn(
                        'absolute inset-0 w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out',
                        copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
                      )}
                    />
                    <CheckIcon
                      className={cn(
                        'absolute inset-0 w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out',
                        copied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                      )}
                    />
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" showArrow={false}>
                Copy review
              </TooltipContent>
            </Tooltip>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleExpand();
            }}
            className="group p-1 rounded-md hover:bg-accent transition-[background-color,transform] duration-150 ease-out active:scale-95">
            <div className="relative w-4 h-4">
              <ExpandIcon
                className={cn(
                  'absolute inset-0 w-4 h-4 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out',
                  isExpanded ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
                )}
              />
              <CollapseIcon
                className={cn(
                  'absolute inset-0 w-4 h-4 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out',
                  isExpanded ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                )}
              />
            </div>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative">
        <div
          ref={topGradientRef}
          className="absolute top-0 left-0 right-0 h-6 pointer-events-none z-10 transition-opacity duration-150"
          style={{
            opacity: 0,
            background:
              'linear-gradient(to bottom, color-mix(in srgb, hsl(var(--muted)) 30%, hsl(var(--background))) 0%, transparent 100%)'
          }}
        />

        <div
          ref={contentRef}
          onClick={() => !isExpanded && setIsExpanded(true)}
          className={cn(
            'text-xs overflow-hidden transition-all duration-200',
            isExpanded ? 'max-h-[300px] overflow-y-auto' : 'h-[72px] cursor-pointer hover:bg-muted/50'
          )}>
          <div className="px-3 py-2">
            <ChatMarkdownRenderer content={reviewContent} size="sm" />
          </div>
        </div>

        <div
          ref={bottomGradientRef}
          className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none z-10 transition-opacity duration-150"
          style={{
            opacity: 1,
            background:
              'linear-gradient(to top, color-mix(in srgb, hsl(var(--muted)) 30%, hsl(var(--background))) 0%, transparent 100%)'
          }}
        />
      </div>

      {/* Footer — action buttons (mirrors AgentPlanFileTool) */}
      <div className="flex items-center justify-between p-1.5">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleViewReview}
            disabled={!subChatId || !dockApi}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
            View review
          </Button>
        </div>

        {subChatId && !isPending && (
          <Button
            size="sm"
            onClick={handleFixIssues}
            className="h-6 px-3 text-xs font-medium rounded-md transition-transform duration-150 active:scale-[0.97]">
            Fix issues
          </Button>
        )}
      </div>
    </div>
  );
}, areToolPropsEqual);
