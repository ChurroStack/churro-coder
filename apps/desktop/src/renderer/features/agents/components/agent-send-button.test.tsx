// @vitest-environment jsdom
/**
 * Regression tests for AgentSendButton — guards key states so the component
 * cannot be silently broken or deleted without a test failure.
 *
 * Focus areas:
 *  (a) Idle state: aria-label "Send message", not disabled.
 *  (b) Streaming state: aria-label "Stop generation".
 *  (c) advisory prop: data-advisory attribute set, button NOT hard-disabled
 *      (force-send must always remain possible).
 *  (d) variant='square-action': renders an action button with the provided label.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { AgentSendButton } from './agent-send-button';
import React from 'react';

// AgentSendButton reads hotkeys via window context — stub them out.
vi.mock('../../../lib/hotkeys', () => ({
  useResolvedHotkeyDisplay: () => null,
  useResolvedHotkeyDisplayWithAlt: () => ({ primary: null, alt: null })
}));

afterEach(cleanup);

function renderBtn(props: Partial<React.ComponentProps<typeof AgentSendButton>> = {}) {
  const onClick = props.onClick ?? vi.fn();
  return render(
    <TooltipProvider>
      <AgentSendButton onClick={onClick} {...props} />
    </TooltipProvider>
  );
}

// ── (a) Idle state ────────────────────────────────────────────────────────────

describe('AgentSendButton — idle state', () => {
  it('renders with aria-label "Send message"', () => {
    renderBtn();
    expect(screen.getByRole('button', { name: /send message/i })).toBeTruthy();
  });

  it('is not disabled in idle state', () => {
    renderBtn();
    const btn = screen.getByRole('button', { name: /send message/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    renderBtn({ onClick });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

// ── (b) Streaming state ────────────────────────────────────────────────────────

describe('AgentSendButton — streaming state', () => {
  it('renders with aria-label "Stop generation" when isStreaming=true and no content', () => {
    renderBtn({ isStreaming: true, hasContent: false, onStop: vi.fn() });
    expect(screen.getByRole('button', { name: /stop generation/i })).toBeTruthy();
  });

  it('calls onStop (not onClick) when clicked during streaming with no content', () => {
    const onClick = vi.fn();
    const onStop = vi.fn();
    renderBtn({ isStreaming: true, hasContent: false, onClick, onStop });
    fireEvent.click(screen.getByRole('button', { name: /stop generation/i }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders "Add to queue" label when isStreaming=true and has content', () => {
    renderBtn({ isStreaming: true, hasContent: true });
    expect(screen.getByRole('button', { name: /add to queue/i })).toBeTruthy();
  });
});

// ── (c) Advisory prop — CLI busy-state hint ──────────────────────────────────

describe('AgentSendButton — advisory prop', () => {
  it('sets data-advisory attribute when advisory=true', () => {
    renderBtn({ advisory: true });
    const btn = screen.getByRole('button', { name: /send message/i });
    expect(btn.hasAttribute('data-advisory')).toBe(true);
  });

  it('does NOT set data-advisory when advisory=false (default)', () => {
    renderBtn({ advisory: false });
    const btn = screen.getByRole('button', { name: /send message/i });
    expect(btn.hasAttribute('data-advisory')).toBe(false);
  });

  it('is NOT hard-disabled when advisory=true (force-send must remain possible)', () => {
    renderBtn({ advisory: true });
    const btn = screen.getByRole('button', { name: /send message/i }) as HTMLButtonElement;
    // advisory is a visual-only hint — disabled must be false
    expect(btn.disabled).toBe(false);
  });

  it('still calls onClick when clicked with advisory=true', () => {
    const onClick = vi.fn();
    renderBtn({ advisory: true, onClick });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

// ── (d) variant='square-action' ───────────────────────────────────────────────
// square-action uses `ariaLabel ?? actionLabel ?? 'Send message'` so we pass
// ariaLabel explicitly to keep the test assertions stable.

describe('AgentSendButton — variant square-action', () => {
  it('renders with actionLabel text visible', () => {
    renderBtn({ variant: 'square-action', actionLabel: 'Apply', ariaLabel: 'Send message' });
    expect(screen.getByText('Apply')).toBeTruthy();
  });

  it('renders button with aria-label "Send message" when ariaLabel is set', () => {
    renderBtn({ variant: 'square-action', actionLabel: 'Apply', ariaLabel: 'Send message' });
    expect(screen.getByRole('button', { name: /send message/i })).toBeTruthy();
  });

  it('is not disabled in idle state', () => {
    renderBtn({ variant: 'square-action', actionLabel: 'Apply', ariaLabel: 'Send message' });
    const btn = screen.getByRole('button', { name: /send message/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('shows stop state with aria-label "Stop generation" when isStreaming=true', () => {
    renderBtn({ variant: 'square-action', isStreaming: true, hasContent: false, onStop: vi.fn() });
    expect(screen.getByRole('button', { name: /stop generation/i })).toBeTruthy();
  });

  it('calls onClick when clicked in idle state', () => {
    const onClick = vi.fn();
    renderBtn({ variant: 'square-action', actionLabel: 'Apply', ariaLabel: 'Send message', onClick });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
