'use client';

import { memo, useEffect, useRef } from 'react';
import { cn } from '../../../lib/utils';
import { MemoizedMarkdown } from '../../../components/chat-markdown-renderer';
import { applySearchHighlights, clearSearchHighlights } from '../../find/dom-text-highlighter';
import { useSearchQuery, useSearchHighlight } from '../search';

interface MemoizedTextPartProps {
  text: string;
  messageId: string;
  partIndex: number;
  isFinalText: boolean;
  visibleStepsCount: number;
  isStreaming?: boolean;
}

// Inner component - pure render, no hooks that cause re-renders
// Only re-renders when props change (text, styling props)
const MemoizedTextPartInner = memo(
  function MemoizedTextPartInner({
    text,
    messageId,
    partIndex,
    isFinalText,
    visibleStepsCount
  }: Omit<MemoizedTextPartProps, 'isStreaming'>) {
    if (!text?.trim()) return null;

    return (
      <div
        className={cn('text-foreground px-2', isFinalText && visibleStepsCount > 0 && 'pt-3 border-t border-border/50')}
        data-message-id={messageId}
        data-part-index={partIndex}
        data-part-type="text">
        {isFinalText && visibleStepsCount > 0 && (
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-1">Response</div>
        )}
        <MemoizedMarkdown content={text} id={`${messageId}-${partIndex}`} size="sm" />
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.text === next.text &&
      prev.messageId === next.messageId &&
      prev.partIndex === next.partIndex &&
      prev.isFinalText === next.isFinalText &&
      prev.visibleStepsCount === next.visibleStepsCount
    );
  }
);

// Outer component - handles search highlighting via DOM manipulation
// This may re-render when search changes, but the inner MemoizedTextPartInner won't
// because its props (text, etc.) haven't changed
export const MemoizedTextPart = memo(
  function MemoizedTextPart({
    text,
    messageId,
    partIndex,
    isFinalText,
    visibleStepsCount,
    isStreaming = false
  }: MemoizedTextPartProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Search hooks - when search is closed, these return empty/null values
    // and don't cause re-renders (SearchHighlightProvider returns static context)
    const searchQuery = useSearchQuery();
    const highlights = useSearchHighlight(messageId, partIndex, 'text');
    const currentHighlight = highlights.find((h) => h.isCurrent);
    const currentMatchIndexInPart = currentHighlight?.indexInPart ?? null;

    // Apply DOM-based highlighting after render
    // Skip during streaming to avoid performance issues
    useEffect(() => {
      const container = containerRef.current;
      if (!container || isStreaming || !searchQuery) return;

      applySearchHighlights(container, searchQuery, currentMatchIndexInPart);

      return () => {
        clearSearchHighlights(container);
      };
    }, [searchQuery, currentMatchIndexInPart, isStreaming, text]);

    if (!text?.trim()) return null;

    return (
      <div ref={containerRef}>
        <MemoizedTextPartInner
          text={text}
          messageId={messageId}
          partIndex={partIndex}
          isFinalText={isFinalText}
          visibleStepsCount={visibleStepsCount}
        />
      </div>
    );
  },
  (prev, next) => {
    // Only re-render outer component when these props change
    // Search-related re-renders happen but inner component stays memoized
    return (
      prev.text === next.text &&
      prev.messageId === next.messageId &&
      prev.partIndex === next.partIndex &&
      prev.isFinalText === next.isFinalText &&
      prev.visibleStepsCount === next.visibleStepsCount &&
      prev.isStreaming === next.isStreaming
    );
  }
);
