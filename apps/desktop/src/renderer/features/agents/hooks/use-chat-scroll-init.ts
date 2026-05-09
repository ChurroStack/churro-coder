import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react';

/**
 * Initializes the chat scroll container on mount / tab re-activation:
 * always pins to the bottom and keeps following while `shouldAutoScrollRef`
 * remains true. Extracted from `active-chat.tsx` so it can be exercised
 * in isolation by the regression test in `use-chat-scroll-init.test.tsx`.
 *
 * Why no saved-position restore: the chat panel is unmounted on hide for
 * memory reasons, and `content-visibility: auto` makes saved offsets
 * unreliable on remount (see the deleted `scrollPositionCache` for history).
 */
export interface UseChatScrollInitOptions {
  containerRef: RefObject<HTMLElement | null>;
  contentWrapperRef: RefObject<HTMLElement | null>;
  isVisiblePane: boolean;
  isVisiblePaneRef: MutableRefObject<boolean>;
  shouldAutoScrollRef: MutableRefObject<boolean>;
  scrollInitializedRef: MutableRefObject<boolean>;
  isInitializingScrollRef: MutableRefObject<boolean>;
  isAutoScrollingRef: MutableRefObject<boolean>;
}

export function useChatScrollInit({
  containerRef,
  contentWrapperRef,
  isVisiblePane,
  isVisiblePaneRef,
  shouldAutoScrollRef,
  scrollInitializedRef,
  isInitializingScrollRef,
  isAutoScrollingRef
}: UseChatScrollInitOptions): void {
  useLayoutEffect(() => {
    if (!isVisiblePane) return;

    const container = containerRef.current;
    if (!container) return;

    scrollInitializedRef.current = false;
    isInitializingScrollRef.current = true;

    shouldAutoScrollRef.current = true;
    container.scrollTop = container.scrollHeight;

    scrollInitializedRef.current = true;
    isInitializingScrollRef.current = false;

    // Belt-and-suspenders: re-pin after paint so content-visibility groups
    // that resolve real heights after the synchronous snap still land at
    // bottom even if no resize fires.
    const rafId = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    const contentWrapper = contentWrapperRef.current;
    let lastContentHeight = contentWrapper?.getBoundingClientRect().height ?? 0;
    let prevScrollHeight = container.scrollHeight;

    const resizeObserver = new ResizeObserver(() => {
      if (!isVisiblePaneRef.current) return;

      const newContentHeight = contentWrapper?.getBoundingClientRect().height ?? 0;
      if (newContentHeight === lastContentHeight) return;
      lastContentHeight = newContentHeight;

      if (shouldAutoScrollRef.current) {
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = true;
          container.scrollTop = container.scrollHeight;
          requestAnimationFrame(() => {
            isAutoScrollingRef.current = false;
          });
        });
      } else {
        // User is scrolled up — maintain their relative position as content
        // height changes (e.g., syntax highlighting expanding code blocks
        // above the viewport).
        const newScrollHeight = container.scrollHeight;
        if (newScrollHeight !== prevScrollHeight && prevScrollHeight > 0) {
          const delta = newScrollHeight - prevScrollHeight;
          container.scrollTop = container.scrollTop + delta;
        }
      }
      prevScrollHeight = container.scrollHeight;
    });

    if (contentWrapper) {
      resizeObserver.observe(contentWrapper);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisiblePane]);
}
