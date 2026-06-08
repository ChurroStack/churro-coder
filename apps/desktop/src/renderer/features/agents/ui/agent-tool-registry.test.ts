/**
 * Contract for getToolStatus — the single chokepoint that decides whether a tool
 * renders as pending (running), interrupted, error, or success.
 *
 * The CLI conversation pane feeds non-last messages a dedicated 'turn-active'
 * status while the sub-chat's CLI turn is running. 'turn-active' must:
 *   - mark a still-pending tool as `isPending` (so a running subagent shows
 *     "Running …", not "interrupted"),
 *   - but NOT be treated as `isActivelyStreaming` — that lives in each tool's own
 *     `chatStatus === 'streaming' || 'submitted'` check, which gates shimmer,
 *     live-thinking, and plan/review action buttons and must stay OFF for older
 *     messages.
 * Completed tools (output-available) must be unaffected by status entirely.
 */
import { describe, expect, test } from 'vitest';
import { getToolStatus } from './agent-tool-registry';

const pending = { state: 'input-available' as const };
const completed = { state: 'output-available' as const };
const errored = { state: 'output-error' as const };

describe('getToolStatus — pending tool across chat statuses', () => {
  test('undefined status: neither pending nor interrupted (no status known)', () => {
    const s = getToolStatus(pending, undefined);
    expect(s.isPending).toBe(false);
    expect(s.isInterrupted).toBe(false);
  });

  test("'ready' (idle): interrupted, not pending", () => {
    const s = getToolStatus(pending, 'ready');
    expect(s.isPending).toBe(false);
    expect(s.isInterrupted).toBe(true);
  });

  test("'streaming': pending, not interrupted", () => {
    const s = getToolStatus(pending, 'streaming');
    expect(s.isPending).toBe(true);
    expect(s.isInterrupted).toBe(false);
  });

  test("'submitted': pending, not interrupted", () => {
    const s = getToolStatus(pending, 'submitted');
    expect(s.isPending).toBe(true);
    expect(s.isInterrupted).toBe(false);
  });

  test("'turn-active': pending (running), NOT interrupted — the CLI subagent fix", () => {
    const s = getToolStatus(pending, 'turn-active');
    expect(s.isPending).toBe(true);
    expect(s.isInterrupted).toBe(false);
  });
});

describe('getToolStatus — completed/errored tools are unaffected by status', () => {
  // Guards the regression where 'turn-active'/'streaming' on a non-last message
  // wrongly disturbed already-completed cards (e.g. plan/review action buttons).
  for (const status of ['ready', 'streaming', 'submitted', 'turn-active', undefined] as const) {
    test(`completed tool with status=${String(status)} is success, never pending/interrupted`, () => {
      const s = getToolStatus(completed, status);
      expect(s.isPending).toBe(false);
      expect(s.isInterrupted).toBe(false);
      expect(s.isSuccess).toBe(true);
      expect(s.isError).toBe(false);
    });
  }

  test('errored tool is error, never pending/interrupted', () => {
    const s = getToolStatus(errored, 'turn-active');
    expect(s.isError).toBe(true);
    expect(s.isPending).toBe(false);
    expect(s.isInterrupted).toBe(false);
  });

  test('output-available with success:false is an error', () => {
    const s = getToolStatus({ state: 'output-available', output: { success: false } }, 'ready');
    expect(s.isError).toBe(true);
    expect(s.isSuccess).toBe(false);
  });
});
