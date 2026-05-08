import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CODEX_FORCE_RESTART_AFTER,
  CODEX_MAX_ATTEMPTS,
  CODEX_MAX_RETRIES,
  CODEX_RETRY_DELAYS_MS,
  classifyCodexFailure,
  delayWithAbort,
  getCodexRetryDelay
} from './recovery';

describe('classifyCodexFailure', () => {
  test('user cancellation always wins, regardless of error contents', () => {
    const result = classifyCodexFailure(new Error('ECONNRESET'), {
      observedSideEffects: false,
      attempt: 1,
      aborted: true
    });
    expect(result.category).toBe('user-cancel');
    expect(result.retry).toBe(false);
  });

  test('auth-flavored errors are not retried', () => {
    const result = classifyCodexFailure(new Error('Unauthorized: missing credentials'), {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('auth');
    expect(result.retry).toBe(false);
    expect(result.forceRestart).toBe(false);
  });

  test('missing CLI binary is fatal, never retried', () => {
    const result = classifyCodexFailure(new Error('Bundled Codex CLI not found at /opt/codex'), {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('fatal');
    expect(result.retry).toBe(false);
  });

  test('side effects observed downgrade transient errors to unsafe-partial', () => {
    const result = classifyCodexFailure(new Error('ECONNRESET'), {
      observedSideEffects: true,
      attempt: 1
    });
    expect(result.category).toBe('unsafe-partial');
    expect(result.retry).toBe(false);
  });

  test('but auth errors after partial output still classify as auth', () => {
    const result = classifyCodexFailure(new Error('401 Unauthorized'), {
      observedSideEffects: true,
      attempt: 1
    });
    expect(result.category).toBe('auth');
  });

  test('app-server-closed error → restartable + forceRestart=true', () => {
    const err: any = new Error('Codex app-server disposed');
    const result = classifyCodexFailure(err, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('restartable');
    expect(result.forceRestart).toBe(true);
    expect(result.retry).toBe(true);
  });

  test('idle timeout from waitForAppServerTurn is retryable transient', () => {
    const err = new Error('Codex app-server stream idle for 60s');
    const result = classifyCodexFailure(err, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('retryable-transient');
    expect(result.retry).toBe(true);
  });

  test('rate-limit responses are retried but do not force a restart', () => {
    const err: any = new Error('429 Too Many Requests');
    const result = classifyCodexFailure(err, { observedSideEffects: false, attempt: 2 });
    expect(result.category).toBe('rate-limit');
    expect(result.retry).toBe(true);
    expect(result.forceRestart).toBe(false);
  });

  test('DNS / no-internet errors retry without restart', () => {
    const err: any = Object.assign(new Error('getaddrinfo ENOTFOUND api.openai.com'), {
      code: 'ENOTFOUND'
    });
    const result = classifyCodexFailure(err, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('no-internet');
    expect(result.retry).toBe(true);
    expect(result.forceRestart).toBe(false);
  });

  test('after CODEX_FORCE_RESTART_AFTER failures, transient retries force a restart', () => {
    const err = new Error('socket hang up');
    const result = classifyCodexFailure(err, {
      observedSideEffects: false,
      attempt: CODEX_FORCE_RESTART_AFTER
    });
    expect(result.category).toBe('retryable-transient');
    expect(result.forceRestart).toBe(true);
  });

  test('the final retry slot (attempt === CODEX_MAX_RETRIES) is still allowed', () => {
    const err = new Error('socket hang up');
    const result = classifyCodexFailure(err, {
      observedSideEffects: false,
      attempt: CODEX_MAX_RETRIES
    });
    expect(result.retry).toBe(true);
  });

  test('once attempts have all been used (CODEX_MAX_ATTEMPTS), retry=false', () => {
    const err = new Error('socket hang up');
    const result = classifyCodexFailure(err, {
      observedSideEffects: false,
      attempt: CODEX_MAX_ATTEMPTS
    });
    expect(result.retry).toBe(false);
  });

  test('plain string errors are classified by their content (auth match)', () => {
    const result = classifyCodexFailure('not logged in to Codex', {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('auth');
  });

  test('plain string errors hit no-internet hints', () => {
    const result = classifyCodexFailure('getaddrinfo ENOTFOUND api.openai.com', {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('no-internet');
  });

  test('non-Error objects without code/message still fall back to retryable-transient', () => {
    const result = classifyCodexFailure(
      {},
      {
        observedSideEffects: false,
        attempt: 1
      }
    );
    expect(result.category).toBe('retryable-transient');
  });

  test('unknown errors are treated as retryable-transient', () => {
    const err = new Error('something weird happened');
    const result = classifyCodexFailure(err, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('retryable-transient');
    expect(result.retry).toBe(true);
  });

  test('error code on the data envelope is included in classification', () => {
    const err: any = { data: { code: '429', message: 'rate limited' } };
    const result = classifyCodexFailure(err, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('rate-limit');
  });
});

describe('getCodexRetryDelay', () => {
  test('returns the documented exponential schedule', () => {
    expect(CODEX_RETRY_DELAYS_MS).toEqual([1000, 2000, 3000, 5000, 10000]);
    for (let i = 0; i < CODEX_RETRY_DELAYS_MS.length; i += 1) {
      expect(getCodexRetryDelay(i)).toBe(CODEX_RETRY_DELAYS_MS[i]);
    }
  });

  test('CODEX_MAX_RETRIES matches the schedule length so every wait tier is reachable', () => {
    expect(CODEX_MAX_RETRIES).toBe(CODEX_RETRY_DELAYS_MS.length);
    expect(CODEX_MAX_ATTEMPTS).toBe(CODEX_MAX_RETRIES + 1);
  });

  test('walking attempts 1..MAX_ATTEMPTS exercises every entry in the delay schedule', () => {
    const seen: number[] = [];
    for (let attempt = 1; attempt <= CODEX_MAX_ATTEMPTS; attempt += 1) {
      const result = classifyCodexFailure(new Error('socket hang up'), {
        observedSideEffects: false,
        attempt
      });
      if (!result.retry) break;
      seen.push(getCodexRetryDelay(attempt - 1));
    }
    expect(seen).toEqual([...CODEX_RETRY_DELAYS_MS]);
  });

  test('clamps below zero to the first delay', () => {
    expect(getCodexRetryDelay(-1)).toBe(CODEX_RETRY_DELAYS_MS[0]);
  });

  test('clamps above the schedule to the last delay', () => {
    expect(getCodexRetryDelay(99)).toBe(CODEX_RETRY_DELAYS_MS[CODEX_RETRY_DELAYS_MS.length - 1]);
  });
});

describe('delayWithAbort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves after the delay when no signal aborts', async () => {
    let resolved = false;
    const promise = delayWithAbort(500).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toBe(true);
  });

  test('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let resolved = false;
    await delayWithAbort(10_000, controller.signal).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true);
  });

  test('resolves early when the signal aborts mid-wait', async () => {
    const controller = new AbortController();
    let resolved = false;
    const promise = delayWithAbort(5_000, controller.signal).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);
    controller.abort();
    await promise;
    expect(resolved).toBe(true);
  });
});
