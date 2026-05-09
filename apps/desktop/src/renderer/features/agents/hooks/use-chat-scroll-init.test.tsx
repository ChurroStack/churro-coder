// @vitest-environment jsdom
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type MutableRefObject } from 'react';
import { useChatScrollInit } from './use-chat-scroll-init';

afterEach(cleanup);

interface ObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
}

const observerInstances: ObserverInstance[] = [];

beforeAll(() => {
  // jsdom doesn't implement ResizeObserver. Stub it so the hook can construct one.
  class StubResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    constructor(_cb: ResizeObserverCallback) {
      observerInstances.push(this);
    }
  }
  (globalThis as any).ResizeObserver = StubResizeObserver;
});

afterEach(() => {
  observerInstances.length = 0;
});

interface ExposedRefs {
  shouldAutoScrollRef: MutableRefObject<boolean>;
  scrollInitializedRef: MutableRefObject<boolean>;
  isInitializingScrollRef: MutableRefObject<boolean>;
  isAutoScrollingRef: MutableRefObject<boolean>;
}

interface HarnessProps {
  isVisiblePane: boolean;
  scrollHeight: number;
  clientHeight: number;
  onContainer?: (el: HTMLDivElement | null) => void;
  onRefs?: (refs: ExposedRefs) => void;
}

function Harness({ isVisiblePane, scrollHeight, clientHeight, onContainer, onRefs }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentWrapperRef = useRef<HTMLDivElement | null>(null);
  const isVisiblePaneRef = useRef(isVisiblePane);
  isVisiblePaneRef.current = isVisiblePane;

  // Start `shouldAutoScrollRef` false so we can confirm the hook flips it to true on mount.
  const shouldAutoScrollRef = useRef(false);
  const scrollInitializedRef = useRef(false);
  const isInitializingScrollRef = useRef(false);
  const isAutoScrollingRef = useRef(false);

  onRefs?.({
    shouldAutoScrollRef,
    scrollInitializedRef,
    isInitializingScrollRef,
    isAutoScrollingRef
  });

  useChatScrollInit({
    containerRef,
    contentWrapperRef,
    isVisiblePane,
    isVisiblePaneRef,
    shouldAutoScrollRef,
    scrollInitializedRef,
    isInitializingScrollRef,
    isAutoScrollingRef
  });

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        onContainer?.(el);
        if (el) {
          Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
          Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
        }
      }}
      data-testid="container">
      <div ref={contentWrapperRef} data-testid="wrapper" />
    </div>
  );
}

describe('useChatScrollInit', () => {
  test('lands at bottom on mount with isVisiblePane=true', () => {
    let container: HTMLDivElement | null = null;
    let refs: ExposedRefs | null = null;
    render(
      <Harness
        isVisiblePane={true}
        scrollHeight={1000}
        clientHeight={200}
        onContainer={(el) => {
          container = el;
        }}
        onRefs={(r) => {
          refs = r;
        }}
      />
    );

    expect(container!.scrollTop).toBe(1000);
    expect(refs!.shouldAutoScrollRef.current).toBe(true);
    expect(refs!.scrollInitializedRef.current).toBe(true);
    expect(refs!.isInitializingScrollRef.current).toBe(false);
  });

  test('post-mount RAF re-pins to bottom even after scrollHeight grows', async () => {
    let container: HTMLDivElement | null = null;
    render(
      <Harness
        isVisiblePane={true}
        scrollHeight={1000}
        clientHeight={200}
        onContainer={(el) => {
          container = el;
        }}
      />
    );

    // Synchronous post-mount snap pinned scrollTop to the initial scrollHeight.
    expect(container!.scrollTop).toBe(1000);

    // Simulate `content-visibility: auto` groups resolving real heights AFTER
    // the synchronous snap (e.g. tall code blocks expanding). The RAF re-pin
    // is what protects against this.
    Object.defineProperty(container!, 'scrollHeight', { configurable: true, value: 4000 });

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(container!.scrollTop).toBe(4000);
  });

  test('does not initialize when isVisiblePane=false', () => {
    let container: HTMLDivElement | null = null;
    let refs: ExposedRefs | null = null;
    render(
      <Harness
        isVisiblePane={false}
        scrollHeight={1000}
        clientHeight={200}
        onContainer={(el) => {
          container = el;
        }}
        onRefs={(r) => {
          refs = r;
        }}
      />
    );

    expect(container!.scrollTop).toBe(0);
    expect(refs!.shouldAutoScrollRef.current).toBe(false);
    expect(refs!.scrollInitializedRef.current).toBe(false);
    expect(observerInstances).toHaveLength(0);
  });

  test('cleanup cancels pending RAF and disconnects ResizeObserver', async () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');

    const { unmount } = render(<Harness isVisiblePane={true} scrollHeight={1000} clientHeight={200} />);

    expect(observerInstances).toHaveLength(1);
    const observer = observerInstances[0];
    expect(observer.observe).toHaveBeenCalledTimes(1);
    expect(observer.disconnect).not.toHaveBeenCalled();

    unmount();

    expect(cancelSpy).toHaveBeenCalled();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);

    cancelSpy.mockRestore();
  });
});
