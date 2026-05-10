import { afterEach, describe, expect, test, vi } from 'vitest';
import { waitForAppServerTurn } from './wait-for-app-server-turn';

describe('waitForAppServerTurn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('does not reject while transport activity stays fresh even if the thread is queued', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const accumulator = {
      completed: false,
      lastEventAt: startedAt
    };
    let transportLastActivityAt = startedAt;
    const promise = waitForAppServerTurn({
      accumulator,
      getTransportLastActivityAt: () => transportLastActivityAt,
      signal: new AbortController().signal,
      idleTimeoutMs: 60_000,
      maxRuntimeMs: 5 * 60_000
    });

    await vi.advanceTimersByTimeAsync(30_000);
    transportLastActivityAt = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    transportLastActivityAt = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    accumulator.completed = true;
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBeUndefined();
  });

  test('does not reject while thread activity stays fresh even if the transport heartbeat is stale', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const accumulator = {
      completed: false,
      lastEventAt: startedAt
    };
    const promise = waitForAppServerTurn({
      accumulator,
      getTransportLastActivityAt: () => startedAt,
      signal: new AbortController().signal,
      idleTimeoutMs: 60_000,
      maxRuntimeMs: 5 * 60_000
    });

    await vi.advanceTimersByTimeAsync(30_000);
    accumulator.lastEventAt = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    accumulator.lastEventAt = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    accumulator.completed = true;
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects when both thread and transport activity go stale', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const promise = waitForAppServerTurn({
      accumulator: {
        completed: false,
        lastEventAt: startedAt
      },
      getTransportLastActivityAt: () => startedAt,
      signal: new AbortController().signal,
      idleTimeoutMs: 60_000,
      maxRuntimeMs: 5 * 60_000
    });
    const assertion = expect(promise).rejects.toThrow('Codex app-server stream idle for 60s');

    await vi.advanceTimersByTimeAsync(60_250);

    await assertion;
  });

  test('still honors the max runtime even if activity stays fresh', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    let transportLastActivityAt = startedAt;
    const promise = waitForAppServerTurn({
      accumulator: {
        completed: false,
        lastEventAt: startedAt
      },
      getTransportLastActivityAt: () => transportLastActivityAt,
      signal: new AbortController().signal,
      idleTimeoutMs: 60_000,
      maxRuntimeMs: 1_000
    });
    const assertion = expect(promise).rejects.toThrow('Codex app-server turn timed out');

    await vi.advanceTimersByTimeAsync(500);
    transportLastActivityAt = Date.now();
    await vi.advanceTimersByTimeAsync(500);
    transportLastActivityAt = Date.now();
    await vi.advanceTimersByTimeAsync(500);

    await assertion;
  });

  test('resolves cleanly when aborted mid-wait', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = waitForAppServerTurn({
      accumulator: {
        completed: false,
        lastEventAt: Date.now()
      },
      getTransportLastActivityAt: () => Date.now(),
      signal: controller.signal,
      idleTimeoutMs: 60_000,
      maxRuntimeMs: 5 * 60_000
    });

    controller.abort();
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBeUndefined();
  });
});
