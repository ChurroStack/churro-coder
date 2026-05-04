'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Kbd } from '../../../components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { cn } from '../../../lib/utils';

export interface ScrollToBottomButtonProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onScrollToBottom: () => void;
  hasStackedCards?: boolean;
  subChatId?: string;
  isActive?: boolean;
  isSplitPane?: boolean;
}

/**
 * Sticky "scroll to bottom" button that appears when the chat container is
 * scrolled away from the latest message.
 *
 * Owns its own scroll listener so the parent's render cycle is decoupled
 * from scroll events (the original active-chat.tsx isolation goal). The
 * listener uses RAF throttling and only setStates when the at-bottom flag
 * actually changes.
 *
 * Extracted from `active-chat.tsx` (Phase 3).
 */
export const ScrollToBottomButton = memo(function ScrollToBottomButton({
  containerRef,
  onScrollToBottom,
  subChatId,
  isActive = true,
  isSplitPane = false
}: ScrollToBottomButtonProps) {
  const [isVisible, setIsVisible] = useState(false);
  const shouldMonitor = isActive || isSplitPane;

  // Keep current monitoring state in ref for scroll event handler.
  const shouldMonitorRef = useRef(shouldMonitor);
  shouldMonitorRef.current = shouldMonitor;

  useEffect(() => {
    if (!shouldMonitor) return;

    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    let lastAtBottom: boolean | null = null;

    const checkVisibility = () => {
      if (!shouldMonitorRef.current || rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!shouldMonitorRef.current) return;

        const threshold = 50;
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;

        if (lastAtBottom !== atBottom) {
          lastAtBottom = atBottom;
          setIsVisible(!atBottom);
        }
      });
    };

    // Initial check after a short delay so scroll position is settled when
    // entering a sub-chat that's persisted at a non-bottom scroll offset.
    const timeoutId = setTimeout(() => {
      if (!shouldMonitorRef.current) return;

      const threshold = 50;
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
      lastAtBottom = atBottom;
      setIsVisible(!atBottom);
    }, 50);

    container.addEventListener('scroll', checkVisibility, { passive: true });
    return () => {
      clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
      container.removeEventListener('scroll', checkVisibility);
    };
  }, [containerRef, subChatId, shouldMonitor]);

  return (
    <AnimatePresence>
      {isVisible && (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <motion.button
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              onClick={onScrollToBottom}
              className={cn(
                'absolute p-2 rounded-full bg-background border border-border shadow-md hover:bg-accent active:scale-[0.97] transition-[color,background-color,bottom] duration-200 z-20'
              )}
              style={{
                right: '0.75rem',
                bottom:
                  'clamp(0.75rem, (48rem - var(--chat-container-width, 0px)) * 1000, calc(var(--chat-input-height, 4rem) + 1rem))'
              }}
              aria-label="Scroll to bottom">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </motion.button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Scroll to bottom
            <span className="inline-flex items-center gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>
                <ArrowDown className="h-3 w-3" />
              </Kbd>
            </span>
          </TooltipContent>
        </Tooltip>
      )}
    </AnimatePresence>
  );
});
