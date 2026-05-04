// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { ScrollToBottomButton } from './scroll-to-bottom-button';

afterEach(cleanup);

/**
 * RAF + scroll-listener wrapper. The button manages its own scroll listener
 * + RAF throttle, so the test:
 *   - Mounts a real scrollable container.
 *   - Sets scrollTop / scrollHeight to simulate "not at bottom".
 *   - Dispatches a scroll event.
 *   - Drains setTimeout(50) + RAF before asserting the button rendered.
 */
function ScrollHarness({
  isActive = true,
  onScrollToBottom = () => {}
}: {
  isActive?: boolean;
  onScrollToBottom?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  return (
    <TooltipProvider>
      <div ref={ref} data-testid="scroll-container" style={{ height: '100px', overflow: 'auto' }}>
        <div style={{ height: '1000px' }}>long content</div>
        <ScrollToBottomButton
          containerRef={ref}
          onScrollToBottom={onScrollToBottom}
          isActive={isActive}
          subChatId="sub-1"
        />
      </div>
    </TooltipProvider>
  );
}

describe('ScrollToBottomButton', () => {
  test('hidden initially when at bottom', async () => {
    const { container } = render(<ScrollHarness />);
    // The initial state check fires after a 50ms timeout. Drain it.
    await new Promise((r) => setTimeout(r, 80));
    expect(container.querySelector('[aria-label="Scroll to bottom"]')).toBeNull();
  });

  test('renders when scroll moves away from bottom (RAF + setState)', async () => {
    const onScrollToBottom = vi.fn();
    const { container, getByTestId } = render(<ScrollHarness onScrollToBottom={onScrollToBottom} />);

    const scrollContainer = getByTestId('scroll-container') as HTMLDivElement;
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0
    });

    // Trigger the post-mount initial check (50ms timeout) AND a scroll event so
    // the RAF callback runs. Drain timers + RAF.
    await act(async () => {
      fireEvent.scroll(scrollContainer);
      // Wait for the 50ms post-mount delay + RAF.
      await new Promise((r) => setTimeout(r, 80));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const btn = container.querySelector('[aria-label="Scroll to bottom"]');
    expect(btn).not.toBeNull();
  });

  test('does NOT attach listener when isActive=false and isSplitPane=false', async () => {
    const onScrollToBottom = vi.fn();
    const { getByTestId } = render(<ScrollHarness isActive={false} onScrollToBottom={onScrollToBottom} />);
    const scrollContainer = getByTestId('scroll-container') as HTMLDivElement;
    const addSpy = vi.spyOn(scrollContainer, 'addEventListener');

    // Re-render the same harness wouldn't help; instead assert that with
    // isActive=false, the container has no scroll listener attached.
    // The component returned early so addEventListener was never called for
    // this container after isActive=false. Drain timers to be sure.
    await new Promise((r) => setTimeout(r, 80));
    expect(addSpy).not.toHaveBeenCalled();
  });

  test('invokes onScrollToBottom when the rendered button is clicked', async () => {
    const onScrollToBottom = vi.fn();
    const { container, getByTestId } = render(<ScrollHarness onScrollToBottom={onScrollToBottom} />);
    const scrollContainer = getByTestId('scroll-container') as HTMLDivElement;
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0
    });
    await act(async () => {
      fireEvent.scroll(scrollContainer);
      await new Promise((r) => setTimeout(r, 80));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const btn = container.querySelector('[aria-label="Scroll to bottom"]') as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onScrollToBottom).toHaveBeenCalledTimes(1);
  });
});
