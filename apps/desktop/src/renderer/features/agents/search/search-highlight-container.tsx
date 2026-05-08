'use client';

import { memo, useEffect, useRef } from 'react';

import { applySearchHighlights, clearSearchHighlights } from '../../find/dom-text-highlighter';
import { useSearchHighlight, useSearchQuery } from './search-highlight-context';

interface SearchHighlightContainerProps {
  messageId: string;
  partIndex: number;
  partType: string;
  children: React.ReactNode;
}

export const SearchHighlightContainer = memo(function SearchHighlightContainer({
  messageId,
  partIndex,
  partType,
  children
}: SearchHighlightContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchQuery = useSearchQuery();
  const highlights = useSearchHighlight(messageId, partIndex, partType);
  const currentHighlight = highlights.find((highlight) => highlight.isCurrent);

  useEffect(() => {
    if (!containerRef.current) return;

    const { currentElement } = applySearchHighlights(containerRef.current, searchQuery, currentHighlight?.indexInPart ?? null);
    currentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return () => {
      clearSearchHighlights(containerRef.current);
    };
  }, [currentHighlight?.indexInPart, searchQuery]);

  return (
    <div ref={containerRef} data-message-id={messageId} data-part-index={partIndex} data-part-type={partType}>
      {children}
    </div>
  );
});
