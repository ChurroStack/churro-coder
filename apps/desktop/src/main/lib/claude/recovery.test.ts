import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  CLAUDE_AUTH_RETRY_BUDGET,
  CLAUDE_MAX_ATTEMPTS,
  CLAUDE_MAX_RETRIES,
  CLAUDE_RETRY_DELAYS_MS,
  classifyClaudeFailure,
  delayWithAbort,
  getClaudeRetryDelay
} from './recovery';
import { vi } from 'vitest';

describe('classifyClaudeFailure', () => {
  test('user cancellation always wins, regardless of error contents', () => {
    const result = classifyClaudeFailure(new Error('ECONNRESET'), {
      observedSideEffects: false,
      attempt: 1,
      aborted: true
    });
    expect(result.category).toBe('user-cancel');
    expect(result.retry).toBe(false);
  });

  test('session-not-found flag → session-expired with forceFreshSession', () => {
    const result = classifyClaudeFailure(new Error('stream error'), {
      observedSideEffects: false,
      attempt: 1,
      isSessionNotFound: true
    });
    expect(result.category).toBe('session-expired');
    expect(result.retry).toBe(true);
    expect(result.forceFreshSession).toBe(true);
    expect(result.delayMs).toBe(0);
  });

  test('session-expired hint in error text', () => {
    const result = classifyClaudeFailure('No conversation found with session ID abc123', {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('session-expired');
    expect(result.retry).toBe(true);
  });

  test('session-expired is not retried when side effects observed', () => {
    const result = classifyClaudeFailure(new Error('stream error'), {
      observedSideEffects: true,
      attempt: 1,
      isSessionNotFound: true
    });
    expect(result.category).toBe('session-expired');
    expect(result.retry).toBe(false);
  });

  test('missing CLI binary is fatal, never retried', () => {
    const result = classifyClaudeFailure(new Error('claude binary not found at /opt/claude'), {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('fatal');
    expect(result.retry).toBe(false);
  });

  test('auth error on first attempt → auth-transient, retry=true (OAuth mode)', () => {
    const result = classifyClaudeFailure(
      { code: 'authentication_failed', message: 'auth failed' },
      {
        observedSideEffects: false,
        attempt: 1,
        isOAuthMode: true
      }
    );
    expect(result.category).toBe('auth-transient');
    expect(result.retry).toBe(true);
    expect(result.needsAuthModal).toBe(false);
  });

  test('auth error after retry budget → auth-fatal with modal in OAuth mode', () => {
    const result = classifyClaudeFailure(new Error('authentication required'), {
      observedSideEffects: false,
      attempt: CLAUDE_AUTH_RETRY_BUDGET + 1,
      isOAuthMode: true
    });
    expect(result.category).toBe('auth-fatal');
    expect(result.retry).toBe(false);
    expect(result.needsAuthModal).toBe(true);
  });

  test('auth error after budget in API-key mode → auth-fatal without modal', () => {
    const result = classifyClaudeFailure(new Error('authentication required'), {
      observedSideEffects: false,
      attempt: CLAUDE_AUTH_RETRY_BUDGET + 1,
      isOAuthMode: false
    });
    expect(result.category).toBe('auth-fatal');
    expect(result.retry).toBe(false);
    expect(result.needsAuthModal).toBe(false);
  });

  test('auth error after partial output → auth-fatal (no replay-duplication)', () => {
    // Replaying the prompt after the user has seen output would duplicate it,
    // so the side-effect guard takes precedence over the auth retry budget.
    const result = classifyClaudeFailure(new Error('401 Unauthorized'), {
      observedSideEffects: true,
      attempt: 1,
      isOAuthMode: true
    });
    expect(result.category).toBe('auth-fatal');
    expect(result.retry).toBe(false);
    expect(result.needsAuthModal).toBe(true);
  });

  test('side effects observed downgrade transient errors to unsafe-partial', () => {
    const result = classifyClaudeFailure(new Error('ECONNRESET'), {
      observedSideEffects: true,
      attempt: 1
    });
    expect(result.category).toBe('unsafe-partial');
    expect(result.retry).toBe(false);
  });

  test('policy-retry on attempt 1 → 3s delay', () => {
    const result = classifyClaudeFailure(
      { code: 'invalid_request', message: 'Usage Policy violation' },
      {
        observedSideEffects: false,
        attempt: 1
      }
    );
    expect(result.category).toBe('policy-retry');
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(3000);
  });

  test('policy-retry on attempt 2 → 6s delay', () => {
    const result = classifyClaudeFailure('Usage Policy violation detected', {
      observedSideEffects: false,
      attempt: 2
    });
    expect(result.category).toBe('policy-retry');
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(6000);
  });

  test('policy-retry after budget → retry=false', () => {
    const result = classifyClaudeFailure('invalid_request usage policy violate', {
      observedSideEffects: false,
      attempt: 3
    });
    expect(result.category).toBe('policy-retry');
    expect(result.retry).toBe(false);
  });

  test('rate-limit responses are retried but do not force a fresh session', () => {
    const result = classifyClaudeFailure(
      { code: 'rate_limit_exceeded', message: 'Too Many Requests' },
      {
        observedSideEffects: false,
        attempt: 1
      }
    );
    expect(result.category).toBe('rate-limit');
    expect(result.retry).toBe(true);
    expect(result.forceFreshSession).toBe(false);
  });

  test('DNS / no-internet errors retry without forced fresh session', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' });
    const result = classifyClaudeFailure(err, {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('no-internet');
    expect(result.retry).toBe(true);
    expect(result.forceFreshSession).toBe(false);
  });

  test('stream wedge flag → retryable-transient', () => {
    const result = classifyClaudeFailure(new Error('aborted'), {
      observedSideEffects: false,
      attempt: 1,
      streamWedged: true
    });
    expect(result.category).toBe('retryable-transient');
    expect(result.retry).toBe(true);
  });

  test('subprocess crash (exited with code) → retryable-transient', () => {
    const result = classifyClaudeFailure(new Error('Process exited with code 1'), {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('retryable-transient');
    expect(result.retry).toBe(true);
  });

  test('503/504 transient → retryable-transient', () => {
    const result = classifyClaudeFailure('503 Service Unavailable', {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('retryable-transient');
    expect(result.retry).toBe(true);
  });

  test('the final retry slot (attempt === CLAUDE_MAX_RETRIES) is still allowed', () => {
    const result = classifyClaudeFailure(new Error('socket hang up'), {
      observedSideEffects: false,
      attempt: CLAUDE_MAX_RETRIES
    });
    expect(result.retry).toBe(true);
  });

  test('once attempt budget is exhausted (CLAUDE_MAX_ATTEMPTS), retry=false', () => {
    const result = classifyClaudeFailure(new Error('socket hang up'), {
      observedSideEffects: false,
      attempt: CLAUDE_MAX_ATTEMPTS
    });
    expect(result.retry).toBe(false);
  });

  test('unknown errors are treated as retryable-transient', () => {
    const result = classifyClaudeFailure(new Error('something totally unexpected'), {
      observedSideEffects: false,
      attempt: 1
    });
    expect(result.category).toBe('retryable-transient');
    expect(result.retry).toBe(true);
  });

  test('plain string errors are classified by content', () => {
    expect(
      classifyClaudeFailure('not logged in to Claude Code CLI', { observedSideEffects: false, attempt: 1 }).category
    ).toBe('auth-transient');
  });

  test('non-Error objects without code/message fall back to retryable-transient', () => {
    const result = classifyClaudeFailure({}, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('retryable-transient');
  });

  test('error code on data envelope is included in classification', () => {
    const err: any = { data: { code: '429', message: 'rate limited' } };
    const result = classifyClaudeFailure(err, { observedSideEffects: false, attempt: 1 });
    expect(result.category).toBe('rate-limit');
  });
});

describe('getClaudeRetryDelay', () => {
  test('returns the documented exponential schedule', () => {
    expect(CLAUDE_RETRY_DELAYS_MS).toEqual([1000, 2000, 3000, 5000, 10000]);
    for (let i = 0; i < CLAUDE_RETRY_DELAYS_MS.length; i += 1) {
      expect(getClaudeRetryDelay(i)).toBe(CLAUDE_RETRY_DELAYS_MS[i]);
    }
  });

  test('CLAUDE_MAX_RETRIES matches the schedule length so every wait tier is reachable', () => {
    expect(CLAUDE_MAX_RETRIES).toBe(CLAUDE_RETRY_DELAYS_MS.length);
    expect(CLAUDE_MAX_ATTEMPTS).toBe(CLAUDE_MAX_RETRIES + 1);
  });

  test('walking attempts 1..MAX_ATTEMPTS exercises every entry in the delay schedule', () => {
    const seen: number[] = [];
    for (let attempt = 1; attempt <= CLAUDE_MAX_ATTEMPTS; attempt += 1) {
      const result = classifyClaudeFailure(new Error('socket hang up'), {
        observedSideEffects: false,
        attempt
      });
      if (!result.retry) break;
      seen.push(getClaudeRetryDelay(attempt - 1));
    }
    expect(seen).toEqual([...CLAUDE_RETRY_DELAYS_MS]);
  });

  test('clamps below zero to the first delay', () => {
    expect(getClaudeRetryDelay(-1)).toBe(CLAUDE_RETRY_DELAYS_MS[0]);
  });

  test('clamps above the schedule to the last delay', () => {
    expect(getClaudeRetryDelay(99)).toBe(CLAUDE_RETRY_DELAYS_MS[CLAUDE_RETRY_DELAYS_MS.length - 1]);
  });
});

describe('delayWithAbort (re-exported from codex/recovery)', () => {
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
