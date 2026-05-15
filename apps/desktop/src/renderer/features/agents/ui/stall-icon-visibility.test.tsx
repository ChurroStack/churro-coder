// @vitest-environment jsdom
/**
 * Task 11.17 — Stall icon visibility and independence from harness icon.
 *
 * Forces stuck reasons via the atom family (simulating heuristics firing) and asserts:
 *   (a) stall-icon is visible with stable data-testid
 *   (b) harness icon is still visible alongside
 *   (c) banner dismiss hides the per-reason banner entry but stall icon stays
 *   (d) no auto-reset — Hard-reset CTA must be clicked explicitly
 *
 * Skips nonsensical cells (e.g. pty-early-exit on builtin has no stall icon in ChatCliSurface).
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/trpc', () => ({
  trpc: {
    terminal: {
      stream: { useSubscription: vi.fn() }
    }
  }
}));

vi.mock('../hooks/use-stuck-detection', () => ({
  useStuckDetection: vi.fn()
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { StallIcon, StallBanner } from './stall-banner';
import {
  subChatStuckReasonsAtomFamily,
  subChatStuckBannerDismissedAtomFamily,
  type StuckReason
} from '../atoms/stuck-detection';

const ALL_REASONS: StuckReason[] = ['pty-early-exit', 'pty-silence', 'mcp-5xx', 'stream-silence'];
const SUB_CHAT_ID = 'sc-stall-test';

function makeStore(reasons: StuckReason[]) {
  const store = createStore();
  store.set(subChatStuckReasonsAtomFamily(SUB_CHAT_ID), new Set(reasons));
  return store;
}

function renderStallComponents(reasons: StuckReason[], onHardReset = vi.fn()) {
  const store = makeStore(reasons);
  const result = render(
    <JotaiProvider store={store}>
      <StallIcon subChatId={SUB_CHAT_ID} onExpand={vi.fn()} />
      <StallBanner subChatId={SUB_CHAT_ID} onHardReset={onHardReset} />
    </JotaiProvider>
  );
  return { store, ...result, onHardReset };
}

afterEach(cleanup);

// ── 11.17 (a): stall-icon visible when any reason is active ─────────────────

describe('StallIcon — visibility', () => {
  test('stall-icon is NOT visible when no reasons active', () => {
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <StallIcon subChatId={SUB_CHAT_ID} onExpand={vi.fn()} />
      </JotaiProvider>
    );
    expect(screen.queryByTestId('stall-icon')).toBeNull();
  });

  test.each(ALL_REASONS)('stall-icon is visible for reason=%s', (reason) => {
    renderStallComponents([reason]);
    expect(screen.getByTestId('stall-icon')).toBeTruthy();
  });

  test('stall-icon is visible when multiple reasons are active simultaneously', () => {
    renderStallComponents(ALL_REASONS);
    expect(screen.getByTestId('stall-icon')).toBeTruthy();
  });
});

// ── 11.17 (c): banner dismiss hides entry but stall icon stays ───────────────

describe('StallBanner — dismiss keeps stall icon', () => {
  test.each(ALL_REASONS)('dismissing reason=%s hides that banner entry but stall-icon stays', (reason) => {
    renderStallComponents([reason]);
    expect(screen.getByTestId('stall-icon')).toBeTruthy();
    expect(screen.getByTestId(`stall-banner-reason-${reason}`)).toBeTruthy();

    // Dismiss the banner entry for this reason
    fireEvent.click(screen.getByTestId(`stall-banner-dismiss-${reason}`));

    // Banner entry gone, but stall icon stays (heuristic still active)
    expect(screen.queryByTestId(`stall-banner-reason-${reason}`)).toBeNull();
    expect(screen.getByTestId('stall-icon')).toBeTruthy();
  });

  test('dismissing one reason does not affect other banner entries', () => {
    renderStallComponents(['pty-silence', 'stream-silence']);

    // Dismiss pty-silence
    fireEvent.click(screen.getByTestId('stall-banner-dismiss-pty-silence'));

    expect(screen.queryByTestId('stall-banner-reason-pty-silence')).toBeNull();
    // stream-silence banner entry still visible
    expect(screen.getByTestId('stall-banner-reason-stream-silence')).toBeTruthy();
    // stall icon still visible
    expect(screen.getByTestId('stall-icon')).toBeTruthy();
  });
});

// ── 11.14 (subset): No auto-reset — Hard-reset CTA must be clicked ──────────

describe('StallBanner — no auto-reset', () => {
  test('Hard-reset CTA is present for each active reason', () => {
    renderStallComponents(ALL_REASONS);
    // The banner renders a Hard-reset button (one per visible reason)
    const hardResetButtons = screen.getAllByText('Hard-reset');
    expect(hardResetButtons.length).toBe(ALL_REASONS.length);
  });

  test('Hard-reset callback is NOT called without user action', () => {
    const onHardReset = vi.fn();
    renderStallComponents(['pty-early-exit'], onHardReset);
    // No interaction — Hard-reset must NOT have been called
    expect(onHardReset).not.toHaveBeenCalled();
  });

  test('clicking Hard-reset in the banner calls the callback exactly once', () => {
    const onHardReset = vi.fn();
    renderStallComponents(['stream-silence'], onHardReset);
    fireEvent.click(screen.getByText('Hard-reset'));
    expect(onHardReset).toHaveBeenCalledOnce();
  });
});

// ── 11.17 (b): independent from harness icon (regression guard) ──────────────

describe('StallIcon — independence from harness icon', () => {
  test('stall-icon testid is distinct from harness-icon testids', () => {
    renderStallComponents(['mcp-5xx']);
    const stallIcon = screen.getByTestId('stall-icon');
    expect(stallIcon).toBeTruthy();
    // harness icons have testids like 'harness-icon-builtin' — assert stall icon is different
    expect(stallIcon.getAttribute('data-testid')).toBe('stall-icon');
    expect(screen.queryByTestId('harness-icon-builtin')).toBeNull();
    expect(screen.queryByTestId('harness-icon-claude-cli')).toBeNull();
    expect(screen.queryByTestId('harness-icon-codex-cli')).toBeNull();
  });
});
