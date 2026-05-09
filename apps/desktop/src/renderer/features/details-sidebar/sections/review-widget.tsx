'use client';

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ClipboardIcon, ExpandIcon, CollapseIcon } from '@/components/ui/icons';
import { ChatMarkdownRenderer } from '@/components/chat-markdown-renderer';
import { trpc } from '@/lib/trpc';
import { useWidgetPanel } from '../../dock';
import { PromotedToPanelStub } from './promoted-to-panel-stub';

interface ReviewWidgetProps {
  /** Active sub-chat ID for review fetching */
  activeSubChatId?: string | null;
}

/**
 * Review Widget for Details Sidebar.
 * Shows the current review artifact with expand/collapse and "View review" (dock panel) functionality.
 * Only renders when a review artifact exists for the active sub-chat.
 */
export const ReviewWidget = memo(function ReviewWidget({ activeSubChatId }: ReviewWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const bottomGradientRef = useRef<HTMLDivElement>(null);

  // Widget ↔ panel mutex: when promoted to a dockview panel, show stub instead.
  const widgetPanel = useWidgetPanel('review', {
    kind: 'review',
    data: { subChatId: activeSubChatId ?? '' }
  });

  const { data: reviewData } = trpc.chats.getReviewContent.useQuery(
    { subChatId: activeSubChatId ?? '' },
    { enabled: !!activeSubChatId }
  );

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  }, []);

  const updateScrollGradient = useCallback(() => {
    const content = contentRef.current;
    const bottomGradient = bottomGradientRef.current;
    if (!content || !bottomGradient) return;

    const { scrollTop, scrollHeight, clientHeight } = content;
    const isScrollable = scrollHeight > clientHeight;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

    bottomGradient.style.opacity = isScrollable && !isAtBottom ? '1' : '0';
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.addEventListener('scroll', updateScrollGradient);
    updateScrollGradient();
    return () => content.removeEventListener('scroll', updateScrollGradient);
  }, [updateScrollGradient, isExpanded]);

  useEffect(() => {
    updateScrollGradient();
  }, [reviewData, updateScrollGradient]);

  if (!reviewData?.exists) return null;

  const reviewContent = reviewData.content ?? null;

  // Widget is promoted to a dockview panel — show stub instead of summary.
  if (widgetPanel.isOpen) {
    return <PromotedToPanelStub label="Review" onReturnToSummary={widgetPanel.closePanel} />;
  }

  return (
    <div className="mx-2 mb-2">
      <div className="rounded-lg border border-border/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-2 h-8 select-none group bg-muted/30">
          <ClipboardIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium text-foreground flex-1">Review</span>

          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                if (activeSubChatId) widgetPanel.openAsPanel();
              }}
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground">
              View review
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleExpand}
              className="h-5 w-5 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground rounded-md transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0"
              aria-label={isExpanded ? 'Collapse review' : 'Expand review'}>
              <div className="relative w-3.5 h-3.5">
                <ExpandIcon
                  className={cn(
                    'absolute inset-0 w-3.5 h-3.5 transition-[opacity,transform] duration-200 ease-out',
                    isExpanded ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
                  )}
                />
                <CollapseIcon
                  className={cn(
                    'absolute inset-0 w-3.5 h-3.5 transition-[opacity,transform] duration-200 ease-out',
                    isExpanded ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                  )}
                />
              </div>
            </Button>
          </div>
        </div>

        {/* Content */}
        {reviewContent ? (
          <div className="relative">
            <div
              ref={contentRef}
              className={cn('px-2 py-2 allow-text-selection', isExpanded ? '' : 'max-h-64 overflow-hidden')}>
              <ChatMarkdownRenderer content={reviewContent} size="sm" />
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
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-muted-foreground">Review complete</p>
          </div>
        )}
      </div>
    </div>
  );
});
