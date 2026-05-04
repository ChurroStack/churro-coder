// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi, beforeAll } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessageGroup } from './message-group';

// jsdom doesn't implement ResizeObserver. Install a no-op stub at module load
// so MessageGroup's effect can subscribe without throwing.
beforeAll(() => {
  class StubResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  (globalThis as any).ResizeObserver = StubResizeObserver;
});

afterEach(cleanup);

describe('MessageGroup', () => {
  test('renders children inside the group element', () => {
    const { getByText } = render(
      <MessageGroup>
        <span>hello</span>
      </MessageGroup>
    );
    expect(getByText('hello')).toBeTruthy();
  });

  test('non-last group: applies content-visibility/auto + container-intrinsic-size', () => {
    const { container } = render(
      <MessageGroup>
        <div data-user-bubble>x</div>
      </MessageGroup>
    );
    const groupEl = container.firstChild as HTMLElement;
    expect(groupEl.style.contentVisibility).toBe('auto');
    expect(groupEl.style.containIntrinsicSize).toContain('200px');
    // Non-last groups do NOT receive a min-height.
    expect(groupEl.style.minHeight).toBe('');
  });

  test('last group: omits content-visibility, applies min-height', () => {
    const { container } = render(
      <MessageGroup isLastGroup>
        <div data-user-bubble>x</div>
      </MessageGroup>
    );
    const groupEl = container.firstChild as HTMLElement;
    expect(groupEl.style.contentVisibility).toBe('');
    expect(groupEl.style.minHeight).toContain('var(--chat-container-height)');
  });

  test('last group: data attribute set', () => {
    const { container } = render(
      <MessageGroup isLastGroup>
        <div data-user-bubble>x</div>
      </MessageGroup>
    );
    const groupEl = container.firstChild as HTMLElement;
    expect(groupEl.dataset.lastGroup).toBe('true');
  });

  test('non-last group: data-last-group attribute is absent', () => {
    const { container } = render(
      <MessageGroup>
        <div data-user-bubble>x</div>
      </MessageGroup>
    );
    const groupEl = container.firstChild as HTMLElement;
    expect(groupEl.dataset.lastGroup).toBeUndefined();
  });

  test("sets --user-message-height CSS var from the bubble's offsetHeight", () => {
    // jsdom doesn't compute layout, so we stub offsetHeight on the bubble.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-user-bubble') ? 64 : 0;
      }
    });

    // ResizeObserver is not implemented in jsdom; stub to a no-op.
    class StubResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    (globalThis as any).ResizeObserver = StubResizeObserver;

    const { container } = render(
      <MessageGroup>
        <div data-user-bubble>bubble</div>
      </MessageGroup>
    );

    const groupEl = container.firstChild as HTMLElement;
    expect(groupEl.style.getPropertyValue('--user-message-height')).toBe('64px');
  });

  test('missing data-user-bubble: no CSS var set, no observer error', () => {
    class StubResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    (globalThis as any).ResizeObserver = StubResizeObserver;

    const { container } = render(
      <MessageGroup>
        <div>no bubble inside</div>
      </MessageGroup>
    );
    const groupEl = container.firstChild as HTMLElement;
    expect(groupEl.style.getPropertyValue('--user-message-height')).toBe('');
  });
});
