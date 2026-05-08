import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { applySearchHighlights, clearSearchHighlights, countSearchMatches } from './dom-text-highlighter';

interface UseDomTextFindOptions {
  rootRef: RefObject<HTMLElement | null>;
  contentKey?: string;
  enabled?: boolean;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 150;

export function useDomTextFind({
  rootRef,
  contentKey,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS
}: UseDomTextFindOptions) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchCompleted, setSearchCompleted] = useState(true);

  // Debounce input → debouncedQuery so we don't re-walk the DOM per keystroke.
  useEffect(() => {
    if (!enabled) return;
    setSearchCompleted(false);
    const handle = setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [query, debounceMs, enabled]);

  const paint = useCallback(
    (effectiveQuery: string, requestedIndex: number, scrollSmooth: boolean) => {
      if (!enabled) return;

      const root = rootRef.current;
      if (!effectiveQuery.trim() || !root) {
        clearSearchHighlights(root);
        setMatchCount(0);
        setCurrentIndex(0);
        setSearchCompleted(true);
        return;
      }

      // Count first so we can normalize the index, then paint exactly once.
      const total = countSearchMatches(root, effectiveQuery);
      if (total === 0) {
        clearSearchHighlights(root);
        setMatchCount(0);
        setCurrentIndex(0);
        setSearchCompleted(true);
        return;
      }

      const normalized = ((requestedIndex % total) + total) % total;
      const { currentElement } = applySearchHighlights(root, effectiveQuery, normalized);
      setMatchCount(total);
      setCurrentIndex(normalized);
      setSearchCompleted(true);
      currentElement?.scrollIntoView({ behavior: scrollSmooth ? 'smooth' : 'auto', block: 'center' });
    },
    [enabled, rootRef]
  );

  // Re-paint when the debounced query, content, or enabled state changes.
  // Intentionally exclude currentIndex — next/prev call paint() directly.
  const lastIndexRef = useRef(currentIndex);
  lastIndexRef.current = currentIndex;

  useEffect(() => {
    if (!enabled) {
      clearSearchHighlights(rootRef.current);
      setMatchCount(0);
      setCurrentIndex(0);
      return;
    }
    paint(debouncedQuery, lastIndexRef.current, false);
  }, [paint, debouncedQuery, contentKey, enabled, rootRef]);

  // Cleanup on unmount.
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
      searchCompleted,
      next: () => {
        if (!debouncedQuery.trim()) return;
        paint(debouncedQuery, currentIndex + 1, true);
      },
      prev: () => {
        if (!debouncedQuery.trim()) return;
        paint(debouncedQuery, currentIndex - 1, true);
      },
      close: () => {
        setQuery('');
        setDebouncedQuery('');
        setMatchCount(0);
        setCurrentIndex(0);
        setSearchCompleted(true);
        clearSearchHighlights(rootRef.current);
      }
    }),
    [paint, current, currentIndex, debouncedQuery, query, rootRef, searchCompleted, total]
  );
}
