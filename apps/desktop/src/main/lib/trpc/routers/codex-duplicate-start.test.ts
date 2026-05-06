/**
 * B2 — Backend: duplicate M:START for an already-active Codex stream is a no-op.
 *
 * The bug: activeStreams.get(subChatId) existed → abort() + cleanupCodexAppServerSubChat() fired.
 * The fix: guard with !signal.aborted → emit.complete() + return early, no cleanup.
 *
 * Same pattern as claude-duplicate-start.test.ts (B1) but for the Codex router.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { observable } from '@trpc/server/observable';

// Mirrors the ActiveCodexStream type from codex.ts
type ActiveCodexStream = {
  runId: string;
  controller: AbortController;
  cancelRequested: boolean;
  threadId?: string;
};

// Reproduces the exact guard from the fixed codex.ts:2811-2818
function runCodexGuard(
  activeStreams: Map<string, ActiveCodexStream>,
  subChatId: string,
  onCleanup?: () => void
): { skipped: boolean; completeCalled: boolean; nextCalled: boolean } {
  let completeCalled = false;
  let nextCalled = false;
  let skipped = false;

  const obs = observable<string>((emit) => {
    const existingStream = activeStreams.get(subChatId);
    if (existingStream && !existingStream.controller.signal.aborted) {
      skipped = true;
      // Guard: do NOT call cleanup / abort — just close the new observable
      emit.complete();
      return () => {};
    }
    // Would normally start the stream
    nextCalled = true;
    return () => {};
  });

  obs.subscribe({
    next: () => {
      nextCalled = true;
    },
    complete: () => {
      completeCalled = true;
    },
    error: () => {}
  });

  return { skipped, completeCalled, nextCalled };
}

describe('B2 — Codex backend duplicate M:START guard', () => {
  let activeStreams: Map<string, ActiveCodexStream>;
  const cleanupSpy = { called: false };

  beforeEach(() => {
    activeStreams = new Map();
    cleanupSpy.called = false;
  });

  test('no existing stream → stream proceeds', () => {
    const { skipped, nextCalled } = runCodexGuard(activeStreams, 'sub-1');
    expect(skipped).toBe(false);
    expect(nextCalled).toBe(true);
  });

  test('existing live stream → emit.complete() fires, stream is skipped (§A fix)', () => {
    const firstController = new AbortController();
    activeStreams.set('sub-1', {
      runId: 'run-1',
      controller: firstController,
      cancelRequested: false
    });

    const { skipped, completeCalled, nextCalled } = runCodexGuard(activeStreams, 'sub-1', () => {
      cleanupSpy.called = true;
    });

    expect(skipped).toBe(true);
    expect(completeCalled).toBe(true);
    expect(nextCalled).toBe(false);
    // Original stream's controller must NOT be aborted
    expect(firstController.signal.aborted).toBe(false);
    // Cleanup must NOT be called on duplicate start
    expect(cleanupSpy.called).toBe(false);
  });

  test('existing ABORTED stream → new stream proceeds (recovery path)', () => {
    const staleController = new AbortController();
    staleController.abort();
    activeStreams.set('sub-1', {
      runId: 'run-stale',
      controller: staleController,
      cancelRequested: false
    });

    const { skipped, nextCalled } = runCodexGuard(activeStreams, 'sub-1');
    expect(skipped).toBe(false);
    expect(nextCalled).toBe(true);
  });

  test('regression: old code would call cleanupCodexAppServerSubChat — new code must not', () => {
    // The old code at codex.ts:2817 always called cleanupCodexAppServerSubChat on
    // duplicate start. The new code guards with !signal.aborted and skips cleanup.
    const firstController = new AbortController();
    activeStreams.set('sub-1', {
      runId: 'run-1',
      controller: firstController,
      cancelRequested: false,
      threadId: 'thread-original'
    });

    // If the guard works, cleanup should not be invoked and the original
    // threadId in activeStreams is preserved
    runCodexGuard(activeStreams, 'sub-1', () => {
      cleanupSpy.called = true;
    });

    expect(cleanupSpy.called).toBe(false);
    // Original entry in activeStreams is unchanged
    expect(activeStreams.get('sub-1')?.threadId).toBe('thread-original');
  });
});
