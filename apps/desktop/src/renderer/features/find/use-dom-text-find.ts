import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';

import { applySearchHighlights, clearSearchHighlights } from './dom-text-highlighter';

interface UseDomTextFindOptions {
  rootRef: RefObject<HTMLElement | null>;
  contentKey?: string;
  enabled?: boolean;
}

export function useDomTextFind({ rootRef, contentKey, enabled = true }: UseDomTextFindOptions) {
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  const apply = useCallback(
    (nextQuery: string, nextIndex: number) => {
      if (!enabled) return;

      const { matchCount: total, currentElement } = applySearchHighlights(rootRef.current, nextQuery, nextIndex);
      setMatchCount(total);

      if (total === 0) {
        setCurrentIndex(0);
        return;
      }

      const normalizedIndex = ((nextIndex % total) + total) % total;
      if (normalizedIndex !== nextIndex) {
        const rerendered = applySearchHighlights(rootRef.current, nextQuery, normalizedIndex);
        setMatchCount(rerendered.matchCount);
        rerendered.currentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setCurrentIndex(normalizedIndex);
        return;
      }

      currentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentIndex(normalizedIndex);
    },
    [enabled, rootRef]
  );

  useEffect(() => {
    if (!enabled) {
      clearSearchHighlights(rootRef.current);
      setQuery('');
      setMatchCount(0);
      setCurrentIndex(0);
      return;
    }

    if (!query.trim()) {
      clearSearchHighlights(rootRef.current);
      setMatchCount(0);
      setCurrentIndex(0);
      return;
    }

    apply(query, currentIndex);
  }, [apply, currentIndex, enabled, query, rootRef, contentKey]);

  useEffect(() => {
    return () => {
      clearSearchHighlights(rootRef.current);
    };
  }, [rootRef]);

  const total = matchCount;
  const current = total > 0 ? currentIndex + 1 : 0;

  return useMemo(
    () => ({
      query,
      setQuery,
      total,
      current,
      searchCompleted: true,
      next: () => {
        if (!query.trim()) return;
        apply(query, currentIndex + 1);
      },
      prev: () => {
        if (!query.trim()) return;
        apply(query, currentIndex - 1);
      },
      close: () => {
        setQuery('');
        setMatchCount(0);
        setCurrentIndex(0);
        clearSearchHighlights(rootRef.current);
      }
    }),
    [apply, current, currentIndex, query, rootRef, total]
  );
}
