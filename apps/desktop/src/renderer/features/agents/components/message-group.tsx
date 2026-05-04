'use client';

import { useEffect, useRef } from 'react';

export interface MessageGroupProps {
  children: React.ReactNode;
  isLastGroup?: boolean;
}

/**
 * Wrapper around a single user-message + assistant-response group.
 *
 * Two responsibilities:
 *
 *   1. Measure the user-message bubble's height and expose it as the
 *      `--user-message-height` CSS variable on this group's element.
 *      The variable is consumed by sticky overlays (todo widget, status
 *      card) that need to clear the bubble.
 *
 *   2. Apply `content-visibility: auto` to all groups EXCEPT the last
 *      one. The browser then skips layout/paint for groups outside the
 *      viewport — a major perf win for long chats. The last group is
 *      excluded because content-visibility breaks scrollHeight while a
 *      response is streaming in.
 *
 * Extracted from `active-chat.tsx` (Phase 3).
 */
export function MessageGroup({ children, isLastGroup }: MessageGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const groupEl = groupRef.current;
    if (!groupEl) return;

    // Find the actual bubble element (not the wrapper which includes the gradient overlay).
    const bubbleEl = groupEl.querySelector('[data-user-bubble]') as HTMLDivElement | null;
    if (!bubbleEl) return;

    const updateHeight = () => {
      const height = bubbleEl.offsetHeight;
      // Set the CSS variable directly on the DOM — no React state, no re-renders.
      groupEl.style.setProperty('--user-message-height', `${height}px`);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(bubbleEl);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={groupRef}
      className="relative"
      style={{
        ...(!isLastGroup && {
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 200px'
        }),
        ...(isLastGroup && { minHeight: 'calc(var(--chat-container-height) - 32px)' })
      }}
      data-last-group={isLastGroup || undefined}>
      {children}
    </div>
  );
}
