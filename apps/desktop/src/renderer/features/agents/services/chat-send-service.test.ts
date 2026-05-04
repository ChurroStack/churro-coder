import { describe, test, expect, vi, beforeEach } from 'vitest';
import { drainFirstPending, sendPendingMessage, type PendingMessage, type SendDeps } from './chat-send-service';

/**
 * L2 tests for chat-send-service.
 *
 * Locks in the cross-component-prompt pattern: clear-before-await,
 * idle-only, subchat-scoped. Six effects in active-chat.tsx rely on
 * exactly this behavior.
 */

function makeDeps(overrides: Partial<SendDeps> = {}): {
  deps: SendDeps;
  sendCalls: { role: string; parts: unknown[] }[];
  isStreamingRef: { current: boolean };
} {
  const sendCalls: { role: string; parts: unknown[] }[] = [];
  const isStreamingRef = { current: false };
  const deps: SendDeps = {
    sendMessage: vi.fn(async (msg) => {
      sendCalls.push(msg as any);
    }),
    isStreaming: () => isStreamingRef.current,
    log: () => {},
    ...overrides
  };
  return { deps, sendCalls, isStreamingRef };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendPendingMessage — gates', () => {
  test('returns no-pending when pending is null', async () => {
    const { deps } = makeDeps();
    const clear = vi.fn();
    const result = await sendPendingMessage('sub-1', null, clear, deps);
    expect(result).toEqual({ sent: false, reason: 'no-pending' });
    expect(clear).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  test('returns wrong-sub-chat when pending targets a different subChatId', async () => {
    const { deps } = makeDeps();
    const clear = vi.fn();
    const pending: PendingMessage = { subChatId: 'sub-2', text: 'hi' };
    const result = await sendPendingMessage('sub-1', pending, clear, deps);
    expect(result).toEqual({ sent: false, reason: 'wrong-sub-chat' });
    expect(clear).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  test('returns busy when isStreaming() is true', async () => {
    const { deps, isStreamingRef } = makeDeps();
    isStreamingRef.current = true;
    const clear = vi.fn();
    const pending: PendingMessage = { subChatId: 'sub-1', text: 'hi' };
    const result = await sendPendingMessage('sub-1', pending, clear, deps);
    expect(result).toEqual({ sent: false, reason: 'busy' });
    expect(clear).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});

describe('sendPendingMessage — clear-before-await invariant', () => {
  test('clearPending runs BEFORE sendMessage', async () => {
    const events: string[] = [];
    const clear = vi.fn(() => {
      events.push('clear');
    });
    const deps: SendDeps = {
      sendMessage: vi.fn(async () => {
        events.push('send');
      }),
      isStreaming: () => false
    };
    await sendPendingMessage('sub-1', { subChatId: 'sub-1', text: 'hi' }, clear, deps);
    expect(events).toEqual(['clear', 'send']);
  });

  test('clearPending runs even before sendMessage starts (synchronous)', async () => {
    const order: string[] = [];
    const clear = vi.fn(() => order.push('clear'));
    // Container ref so the assignment inside the async Promise callback is
    // observable by TS at the call site (a bare `let` would be narrowed to
    // `null` because TS can't see across the async boundary).
    const resolver: { fn: (() => void) | null } = { fn: null };
    const deps: SendDeps = {
      sendMessage: vi.fn(
        () =>
          new Promise<void>((res) => {
            order.push('send-start');
            resolver.fn = () => {
              order.push('send-end');
              res();
            };
          })
      ),
      isStreaming: () => false
    };
    const flow = sendPendingMessage('sub-1', { subChatId: 'sub-1', text: 'x' }, clear, deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['clear', 'send-start']);
    resolver.fn?.();
    await flow;
    expect(order).toEqual(['clear', 'send-start', 'send-end']);
  });

  test('simulating a re-render with stale pending after clear: second call is no-op', async () => {
    const { deps, sendCalls } = makeDeps();
    let pendingRef: PendingMessage | null = { subChatId: 'sub-1', text: 'hi' };
    const clear = () => {
      pendingRef = null;
    };

    // First call (fresh pending): sends.
    await sendPendingMessage('sub-1', pendingRef, clear, deps);
    expect(sendCalls).toHaveLength(1);

    // Simulate the React re-render: the effect runs again with the cleared pending.
    const result = await sendPendingMessage('sub-1', pendingRef, clear, deps);
    expect(result).toEqual({ sent: false, reason: 'no-pending' });
    expect(sendCalls).toHaveLength(1);
  });
});

describe('sendPendingMessage — payload shapes', () => {
  test('default to text part when only text is provided', async () => {
    const { deps, sendCalls } = makeDeps();
    await sendPendingMessage('sub-1', { subChatId: 'sub-1', text: 'implement plan' }, vi.fn(), deps);
    expect(sendCalls[0]).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'implement plan' }]
    });
  });

  test('uses parts when provided (e.g., handleApprovePlan deferred send)', async () => {
    const { deps, sendCalls } = makeDeps();
    const customParts = [
      { type: 'text', text: 'Implementing this plan.' },
      { type: 'file', url: 'data:text/markdown;base64,...' }
    ];
    await sendPendingMessage('sub-1', { subChatId: 'sub-1', parts: customParts }, vi.fn(), deps);
    expect(sendCalls[0]).toEqual({ role: 'user', parts: customParts });
  });

  test('missing text and parts → empty text part', async () => {
    const { deps, sendCalls } = makeDeps();
    await sendPendingMessage('sub-1', { subChatId: 'sub-1' }, vi.fn(), deps);
    expect(sendCalls[0]).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: '' }]
    });
  });
});

describe('sendPendingMessage — sendMessage failure', () => {
  test('propagates the error and does NOT restore pending', async () => {
    const clear = vi.fn();
    const deps: SendDeps = {
      sendMessage: vi.fn(async () => {
        throw new Error('transport down');
      }),
      isStreaming: () => false
    };
    await expect(sendPendingMessage('sub-1', { subChatId: 'sub-1', text: 'hi' }, clear, deps)).rejects.toThrow(
      'transport down'
    );
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe('drainFirstPending — multiple pending atoms', () => {
  test('sends only the first matching atom; later ones are untouched', async () => {
    const { deps, sendCalls } = makeDeps();
    const clears = [vi.fn(), vi.fn(), vi.fn()];
    const pendings = [
      { subChatId: 'sub-2', text: 'wrong' }, // wrong-sub
      { subChatId: 'sub-1', text: 'first' }, // hit
      { subChatId: 'sub-1', text: 'second' } // would hit but skipped
    ];
    const result = await drainFirstPending(
      'sub-1',
      pendings.map((p, i) => ({ pending: p, clearPending: clears[i] })),
      deps
    );
    expect(result).toEqual({ sent: true });
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].parts).toEqual([{ type: 'text', text: 'first' }]);
    expect(clears[0]).not.toHaveBeenCalled();
    expect(clears[1]).toHaveBeenCalledTimes(1);
    expect(clears[2]).not.toHaveBeenCalled();
  });

  test('returns busy when streaming, no clears called', async () => {
    const { deps, isStreamingRef } = makeDeps();
    isStreamingRef.current = true;
    const clear = vi.fn();
    const result = await drainFirstPending(
      'sub-1',
      [{ pending: { subChatId: 'sub-1', text: 'x' }, clearPending: clear }],
      deps
    );
    expect(result).toEqual({ sent: false, reason: 'busy' });
    expect(clear).not.toHaveBeenCalled();
  });

  test('returns no-pending when nothing matches', async () => {
    const { deps } = makeDeps();
    const result = await drainFirstPending('sub-1', [], deps);
    expect(result).toEqual({ sent: false, reason: 'no-pending' });
  });
});
