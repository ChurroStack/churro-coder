'use client';

import { memo, useCallback, useState } from 'react';
import { RefreshCw, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useSessionSummaryDispatcher } from '../../agents/hooks/use-session-summary-dispatcher';

interface SessionWidgetProps {
  activeSubChatId?: string | null;
}

/** A labeled prompt block (Original / Last input) with expand-on-overflow. */
function PromptRow({ label, text }: { label: string; text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = !!text && text.length > 160;
  return (
    <div className="px-2 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</div>
      {text ? (
        <>
          <p
            className={cn(
              'mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground/90 allow-text-selection',
              !expanded && 'line-clamp-3'
            )}>
            {text}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground">
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : (
        <p className="mt-0.5 text-xs italic text-muted-foreground/60">—</p>
      )}
    </div>
  );
}

/**
 * Session widget — at-a-glance reminder of what this sub-chat is for: the
 * original prompt, the last user input, and a rolling LLM summary of what the
 * session is doing. Original/last are read live from the durable `messages`
 * table (shared by builtin + CLI). The summary is persisted server-side and
 * refreshed incrementally after each turn (see use-session-summary-dispatcher).
 */
export const SessionWidget = memo(function SessionWidget({ activeSubChatId }: SessionWidgetProps) {
  const subChatId = activeSubChatId ?? null;
  const enabled = !!subChatId;
  const utils = trpc.useUtils();

  const promptsQuery = trpc.messages.getSessionPrompts.useQuery({ subChatId: subChatId ?? '' }, { enabled });
  const summaryQuery = trpc.chats.getSessionSummary.useQuery({ subChatId: subChatId ?? '' }, { enabled });

  // The dispatcher owns the busy→idle edge for both generation AND query
  // refresh; `onTurnIdle` keeps "last input"/summary fresh the moment a turn
  // ends, and `stale` drives the reopen-an-old-session auto-fire.
  const { refresh, isGenerating } = useSessionSummaryDispatcher(subChatId, {
    stale: summaryQuery.data?.stale ?? false,
    onTurnIdle: useCallback(() => {
      if (!subChatId) return;
      utils.messages.getSessionPrompts.invalidate({ subChatId });
      utils.chats.getSessionSummary.invalidate({ subChatId });
    }, [subChatId, utils])
  });

  const handleRefresh = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      refresh();
    },
    [refresh]
  );

  if (!subChatId) return null;

  const first = promptsQuery.data?.first?.text ?? null;
  const last = promptsQuery.data?.last?.text ?? null;
  const summary = summaryQuery.data?.summary ?? null;

  return (
    <div className="mx-2 mb-2">
      <div className="overflow-hidden rounded-lg border border-border/50">
        {/* Header */}
        <div className="group flex h-8 select-none items-center gap-2 bg-muted/30 px-2">
          <MessageSquareText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs font-medium text-foreground">Session</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={isGenerating}
                className="h-5 w-5 flex-shrink-0 rounded-md p-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                aria-label="Refresh summary">
                <RefreshCw className={cn('h-3 w-3', isGenerating && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Refresh summary</TooltipContent>
          </Tooltip>
        </div>

        {/* Summary */}
        <div className="border-b border-border/40 px-2 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Summary</div>
          {summary ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground/90 allow-text-selection">
              {summary}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-muted-foreground/60">
              {isGenerating ? 'Generating summary…' : 'No summary yet'}
            </p>
          )}
        </div>

        {/* Original + last user input */}
        <PromptRow label="Original prompt" text={first} />
        <div className="border-t border-border/40" />
        <PromptRow label="Last input" text={last} />
      </div>
    </div>
  );
});
