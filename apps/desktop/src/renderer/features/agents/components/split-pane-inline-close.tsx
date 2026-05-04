'use client';

import { memo } from 'react';
import { X as XIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { useAgentSubChatStore } from '../stores/sub-chat-store';

export interface SplitPaneInlineCloseProps {
  subChatId: string;
}

/**
 * Persistent (not hover-to-reveal) close button for split-pane chats.
 *
 * Hiding the button on hover caused it to vanish as the pointer approached
 * it, so it's always visible. Tooltip text adapts when only two panes are
 * open (closing the second one collapses the split view entirely).
 *
 * Extracted from `active-chat.tsx` (Phase 3).
 */
export const SplitPaneInlineClose = memo(function SplitPaneInlineClose({ subChatId }: SplitPaneInlineCloseProps) {
  const removeFromSplit = useAgentSubChatStore((s) => s.removeFromSplit);
  const splitPaneCount = useAgentSubChatStore((s) => s.splitPaneIds.length);
  const isLastPair = splitPaneCount === 2;
  const label = isLastPair ? 'Close split view' : 'Remove from split';
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeFromSplit(subChatId);
          }}
          aria-label={label}
          className="flex-shrink-0 mr-4 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
});
