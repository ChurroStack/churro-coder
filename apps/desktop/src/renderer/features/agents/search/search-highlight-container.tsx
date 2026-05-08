'use client';

import { useEffect, useRef } from 'react';

import { applySearchHighlights, clearSearchHighlights } from '../../find/dom-text-highlighter';
import { useSearchHighlight, useSearchQuery } from './search-highlight-context';

interface SearchHighlightContainerProps {
  messageId: string;
  partIndex: number;
  partType: string;
  children: React.ReactNode;
}

// The wrapped tool renderers already stamp data-message-id / data-part-index /
// data-part-type on their own outermost element. Don't duplicate them here —
// duplicate selectors break any DOM lookup that expects a single match per part.
export function SearchHighlightContainer({ messageId, partIndex, partType, children }: SearchHighlightContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchQuery = useSearchQuery();
  const highlights = useSearchHighlight(messageId, partIndex, partType);
  const currentHighlight = highlights.find((highlight) => highlight.isCurrent);

  useEffect(() => {
    if (!containerRef.current) return;

    const { currentElement } = applySearchHighlights(
      containerRef.current,
      searchQuery,
      currentHighlight?.indexInPart ?? null
    );
    currentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return () => {
      clearSearchHighlights(containerRef.current);
    };
  }, [currentHighlight?.indexInPart, searchQuery]);

  return <div ref={containerRef}>{children}</div>;
}
