/**
 * Snapshot-ordering test for `terminal.allCliStates` — guards against the
 * implementation regressing to "snapshot first, then attach listener", which
 * would drop any transition firing in the gap.
 *
 * The test mocks the terminalManager so it can record the order in which
 * `on('cli-state', …)` and `listActiveCliSessions()` are called by the
 * subscription's observable factory. If the listener attach comes AFTER the
 * snapshot read, the test fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callOrder: string[] = [];
const onCliStateListeners: Array<(evt: unknown) => void> = [];

const terminalManagerMock = {
  on: vi.fn((event: string, listener: (evt: unknown) => void) => {
    callOrder.push(`on:${event}`);
    if (event === 'cli-state') onCliStateListeners.push(listener);
  }),
  off: vi.fn((_event: string, listener: (evt: unknown) => void) => {
    const idx = onCliStateListeners.indexOf(listener);
    if (idx >= 0) onCliStateListeners.splice(idx, 1);
  }),
  listActiveCliSessions: vi.fn(() => {
    callOrder.push('listActiveCliSessions');
    return [{ subChatId: 'snapshot-sub', parentChatId: 'parent-1', state: 'running' as const }];
  }),
  getOutputState: vi.fn(() => null),
  emit: vi.fn()
};

vi.mock('../../terminal/manager', () => ({
  terminalManager: terminalManagerMock
}));

vi.mock('../index', () => ({
  publicProcedure: {
    input: () => ({
      mutation: (fn: unknown) => fn,
      query: (fn: unknown) => fn,
      subscription: (fn: unknown) => fn
    }),
    mutation: (fn: unknown) => fn,
    query: (fn: unknown) => fn,
    subscription: (fn: unknown) => fn
  },
  router: (routes: unknown) => routes
}));

describe('terminal.allCliStates — snapshot/listener ordering', () => {
  beforeEach(async () => {
    callOrder.length = 0;
    onCliStateListeners.length = 0;
    terminalManagerMock.on.mockClear();
    terminalManagerMock.off.mockClear();
    terminalManagerMock.listActiveCliSessions.mockClear();
  });

  it('attaches the `cli-state` listener BEFORE reading the initial snapshot', async () => {
    const { terminalRouter } = await import('./terminal');
    const sub = terminalRouter.allCliStates as unknown as () => {
      subscribe: (observer: { next: (v: unknown) => void; complete?: () => void; error?: (e: unknown) => void }) => {
        unsubscribe: () => void;
      };
    };

    const emitted: unknown[] = [];
    const observable = sub();
    const subscription = observable.subscribe({
      next: (v) => emitted.push(v),
      error: () => {},
      complete: () => {}
    });

    // Order must be: on('cli-state', …) first, then listActiveCliSessions().
    expect(callOrder).toEqual(['on:cli-state', 'listActiveCliSessions']);
    // Snapshot was delivered.
    expect(emitted).toContainEqual({
      subChatId: 'snapshot-sub',
      parentChatId: 'parent-1',
      state: 'running'
    });

    subscription.unsubscribe();
    expect(terminalManagerMock.off).toHaveBeenCalledWith('cli-state', expect.any(Function));
  });

  it('an event fired immediately after subscribe (before snapshot loop) is delivered', async () => {
    const { terminalRouter } = await import('./terminal');
    const sub = terminalRouter.allCliStates as unknown as () => {
      subscribe: (observer: { next: (v: unknown) => void; complete?: () => void; error?: (e: unknown) => void }) => {
        unsubscribe: () => void;
      };
    };

    // Hook listActiveCliSessions to fire a transition BEFORE returning — this
    // simulates the race the listener-first order is meant to protect against.
    terminalManagerMock.listActiveCliSessions.mockImplementationOnce(() => {
      callOrder.push('listActiveCliSessions');
      // Fire an in-flight transition through the listener that should already
      // be attached at this point. If the implementation attaches the listener
      // AFTER the snapshot loop, this transition would not reach the observer.
      for (const listener of onCliStateListeners) {
        listener({ subChatId: 'in-flight-sub', parentChatId: 'parent-2', state: 'running' });
      }
      return [];
    });

    const emitted: unknown[] = [];
    const observable = sub();
    const subscription = observable.subscribe({
      next: (v) => emitted.push(v),
      error: () => {},
      complete: () => {}
    });

    expect(emitted).toContainEqual({
      subChatId: 'in-flight-sub',
      parentChatId: 'parent-2',
      state: 'running'
    });

    subscription.unsubscribe();
  });
});
