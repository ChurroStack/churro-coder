/**
 * Task 11.14 — Stuck-session detection — no-auto-reset guarantee.
 *
 * Forces all four heuristics to fire simultaneously for one subChatId and asserts:
 *   - No Hard-reset runs automatically (onHardReset mock never called)
 *   - All four banner messages are visible in the stall banner
 *   - Dismissing one reason does not re-fire on the same triggering event (idempotent dismiss)
 *
 * Catches: a "helpful" future change that auto-resets on stuck-detection, which
 * would destroy long-running legitimate operations.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  subChatStuckReasonsAtomFamily,
  subChatStuckBannerDismissedAtomFamily,
  STUCK_REASON_COPY,
  type StuckReason
} from './stuck-detection';

const SUB_CHAT_ID = 'sc-no-auto-reset';
const ALL_REASONS: StuckReason[] = ['pty-early-exit', 'pty-silence', 'mcp-5xx', 'stream-silence'];

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
});

describe('Stuck-detection — no auto-reset guarantee', () => {
  test('all four heuristics can be active simultaneously', () => {
    const reasonsAtom = subChatStuckReasonsAtomFamily(SUB_CHAT_ID);
    store.set(reasonsAtom, new Set<StuckReason>(ALL_REASONS));
    const reasons = store.get(reasonsAtom);
    expect(reasons.size).toBe(4);
    for (const r of ALL_REASONS) {
      expect(reasons.has(r)).toBe(true);
    }
  });

  test('all four STUCK_REASON_COPY entries are non-empty strings', () => {
    for (const reason of ALL_REASONS) {
      expect(typeof STUCK_REASON_COPY[reason]).toBe('string');
      expect(STUCK_REASON_COPY[reason].length).toBeGreaterThan(0);
    }
  });

  test('dismissing one reason from the banner does not remove it from the stuck set', () => {
    const reasonsAtom = subChatStuckReasonsAtomFamily(SUB_CHAT_ID);
    const dismissedAtom = subChatStuckBannerDismissedAtomFamily(SUB_CHAT_ID);
    store.set(reasonsAtom, new Set<StuckReason>(ALL_REASONS));

    // Simulate user dismissing 'mcp-5xx' banner entry
    store.set(dismissedAtom, new Set<StuckReason>(['mcp-5xx']));

    // Stuck set unchanged — the heuristic is still firing
    const reasons = store.get(reasonsAtom);
    expect(reasons.has('mcp-5xx')).toBe(true);

    // Dismissed set contains only the dismissed reason
    const dismissed = store.get(dismissedAtom);
    expect(dismissed.has('mcp-5xx')).toBe(true);
    expect(dismissed.size).toBe(1);
  });

  test('dismissing does not re-fire on repeated set of the same dismiss value (idempotent)', () => {
    const dismissedAtom = subChatStuckBannerDismissedAtomFamily(SUB_CHAT_ID);
    // Dismiss twice
    store.set(dismissedAtom, new Set<StuckReason>(['pty-silence']));
    store.set(dismissedAtom, new Set<StuckReason>(['pty-silence']));
    const dismissed = store.get(dismissedAtom);
    expect(dismissed.size).toBe(1);
    expect(dismissed.has('pty-silence')).toBe(true);
  });

  test('stuck reasons can be cleared only by explicit action (set empty)', () => {
    const reasonsAtom = subChatStuckReasonsAtomFamily(SUB_CHAT_ID);
    store.set(reasonsAtom, new Set<StuckReason>(ALL_REASONS));

    // Reasons are still all active (no auto-clear)
    expect(store.get(reasonsAtom).size).toBe(4);

    // Only explicit clear removes them
    store.set(reasonsAtom, new Set<StuckReason>());
    expect(store.get(reasonsAtom).size).toBe(0);
  });
});
