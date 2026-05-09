/**
 * Claude Code chat-stream recovery policy.
 *
 * Pure helpers used by the claude.chat tRPC subscription to decide whether a
 * failure is retryable, whether the session should be reset before the next
 * attempt, and how long to wait between attempts.
 *
 * Kept side-effect free so it can be unit-tested without touching the real
 * Claude process, file system, or network.
 */

export type ClaudeFailureCategory =
  | 'auth-transient' // OAuth refresh race on first 1-2 attempts — retry silently
  | 'auth-fatal' // Token revoked after retry budget — open login modal or error
  | 'retryable-transient' // network blip, 503/504, subprocess crash, stream wedge
  | 'no-internet' // ENOTFOUND / ENETUNREACH — retry without hard-reset
  | 'rate-limit' // 429 / quota exceeded
  | 'session-expired' // "No conversation found with session ID" — retry fresh
  | 'policy-retry' // false-positive usage-policy violation — retry with 3s/6s backoff
  | 'unsafe-partial' // error after user-visible output — no replay to avoid duplication
  | 'fatal' // binary missing, unrecoverable config error
  | 'user-cancel'; // user aborted the stream

export type ClaudeFailureClassification = {
  category: ClaudeFailureCategory;
  /** Whether the harness should retry this failure. */
  retry: boolean;
  /** True only for session-expired: next attempt must start a completely fresh session. */
  forceFreshSession: boolean;
  /** True when the terminal auth failure should open the OAuth login modal. */
  needsAuthModal: boolean;
  /** Human-readable message for the retry-notification toast. */
  userMessage: string;
  /** Milliseconds to wait before the next attempt. */
  delayMs: number;
};

export type ClaudeClassifyContext = {
  /**
   * Whether the failed turn already produced user-visible output (assistant
   * text, tool-input/output chunks, etc.). When true the only safe action is
   * to surface an error — replaying the prompt would duplicate output.
   */
  observedSideEffects: boolean;
  /**
   * 1-based attempt number that just failed. attempt=1 means the first try
   * failed and we are deciding whether to retry once.
   */
  attempt: number;
  /** True when abortController.signal.aborted (and NOT a wedge-triggered abort). */
  aborted?: boolean;
  /** Whether the connection is using OAuth (vs API-key). Affects auth-fatal modal routing. */
  isOAuthMode?: boolean;
  /** True when the stream's 90s wedge timer fired with no data received. */
  streamWedged?: boolean;
  /** True when stderr contains "No conversation found with session ID". */
  isSessionNotFound?: boolean;
};

export const CLAUDE_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 10000] as const;
/**
 * Max number of retries (failures *after* the initial attempt). The schedule
 * has 5 entries → 5 retries → 6 total attempts: every wait tier is reachable.
 */
export const CLAUDE_MAX_RETRIES = CLAUDE_RETRY_DELAYS_MS.length;
/** Total attempts the loop is allowed to make (initial + every retry). */
export const CLAUDE_MAX_ATTEMPTS = CLAUDE_MAX_RETRIES + 1;
/**
 * Max auth-specific attempts before escalating to the login modal.
 * Covers OAuth token-refresh races that self-heal on the first retry.
 */
export const CLAUDE_AUTH_RETRY_BUDGET = 2;

const AUTH_HINTS = [
  'authentication_failed',
  'authentication failed',
  'authentication required',
  'auth required',
  'not logged in',
  'not logged into claude code cli',
  'missing credentials',
  'no credentials',
  'unauthorized',
  'forbidden',
  '401',
  '403'
];

const NO_INTERNET_HINTS = [
  'enotfound',
  'eai_again',
  'enetunreach',
  'enetdown',
  'network is unreachable',
  'no internet',
  'dns lookup failed'
];

const TRANSIENT_HINTS = [
  'econnreset',
  'etimedout',
  'econnrefused',
  'epipe',
  'socket hang up',
  'fetch failed',
  'request timed out',
  'temporarily unavailable',
  '503',
  '504',
  'overloaded'
];

const RATE_LIMIT_HINTS = [
  'rate_limit_exceeded',
  'rate_limit',
  'rate limit',
  'too many requests',
  'quota exceeded',
  '429'
];

const PROCESS_CRASH_HINTS = ['exited with code', 'write epipe'];

const FATAL_HINTS = ['claude binary not found', 'bundled claude cli not found'];

const SESSION_HINTS = ['no conversation found with session id', 'session not found'];

const POLICY_HINTS = ['invalid_request', 'usage policy', 'violate'];

const MAX_POLICY_RETRIES = 2;

function describeError(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (error === null || error === undefined) return '';
  if (typeof error !== 'object') return String(error).toLowerCase();

  const obj = error as { code?: unknown; message?: unknown; data?: { code?: unknown; message?: unknown } };
  const fragments: unknown[] = [obj.code, obj.message, obj.data?.code, obj.data?.message];
  const text = fragments
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => String(v))
    .join(' ')
    .toLowerCase();
  return text || String(error).toLowerCase();
}

function matches(text: string, hints: readonly string[]): boolean {
  return hints.some((h) => text.includes(h));
}

export function classifyClaudeFailure(error: unknown, ctx: ClaudeClassifyContext): ClaudeFailureClassification {
  if (ctx.aborted) {
    return {
      category: 'user-cancel',
      retry: false,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Cancelled',
      delayMs: 0
    };
  }

  const text = describeError(error);
  const remaining = ctx.attempt <= CLAUDE_MAX_RETRIES;

  // Session-not-found: detected via isSessionNotFound flag or hint text.
  // Only retryable when no side effects have been observed (before any output).
  if (ctx.isSessionNotFound || matches(text, SESSION_HINTS)) {
    return {
      category: 'session-expired',
      retry: remaining && !ctx.observedSideEffects,
      forceFreshSession: true,
      needsAuthModal: false,
      userMessage: 'Reconnecting…',
      delayMs: 0 // session is gone — start fresh immediately, no backoff needed
    };
  }

  // Fatal errors bypass all other gates: they will never self-heal.
  if (matches(text, FATAL_HINTS)) {
    return {
      category: 'fatal',
      retry: false,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Claude binary not found — restart the app',
      delayMs: 0
    };
  }

  // Auth: retry first, modal last. The side-effect guard still applies — if
  // user-visible output has already streamed, replaying the prompt would
  // duplicate it, so escalate straight to auth-fatal in that case.
  if (matches(text, AUTH_HINTS)) {
    const authRetryable = ctx.attempt <= CLAUDE_AUTH_RETRY_BUDGET && remaining && !ctx.observedSideEffects;
    return {
      category: authRetryable ? 'auth-transient' : 'auth-fatal',
      retry: authRetryable,
      forceFreshSession: false,
      needsAuthModal: !authRetryable && !!ctx.isOAuthMode,
      userMessage: authRetryable
        ? 'Reconnecting Claude…'
        : ctx.isOAuthMode
          ? 'Authentication failed - not logged into Claude Code CLI'
          : 'Authentication failed - check your API key',
      delayMs: authRetryable ? getClaudeRetryDelay(ctx.attempt - 1) : 0
    };
  }

  // Once the turn has produced user-visible output, replaying the same prompt
  // would duplicate output. Treat anything else as unsafe-partial.
  if (ctx.observedSideEffects) {
    return {
      category: 'unsafe-partial',
      retry: false,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Claude stream interrupted after partial output',
      delayMs: 0
    };
  }

  // Policy retry (false-positive usage-policy violation) — 3s/6s schedule.
  if (matches(text, POLICY_HINTS)) {
    const canRetry = ctx.attempt <= MAX_POLICY_RETRIES;
    return {
      category: 'policy-retry',
      retry: canRetry,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Retrying…',
      delayMs: canRetry ? (ctx.attempt === 1 ? 3000 : 6000) : 0
    };
  }

  // Rate limit
  if (matches(text, RATE_LIMIT_HINTS)) {
    return {
      category: 'rate-limit',
      retry: remaining,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Claude rate-limited — retrying…',
      delayMs: getClaudeRetryDelay(ctx.attempt - 1)
    };
  }

  // No internet
  if (matches(text, NO_INTERNET_HINTS)) {
    return {
      category: 'no-internet',
      retry: remaining,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'No internet connection — retrying…',
      delayMs: getClaudeRetryDelay(ctx.attempt - 1)
    };
  }

  // Stream wedge (90s with no data) or process crash → restart with resume
  if (ctx.streamWedged || matches(text, PROCESS_CRASH_HINTS)) {
    return {
      category: 'retryable-transient',
      retry: remaining,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Reconnecting Claude…',
      delayMs: getClaudeRetryDelay(ctx.attempt - 1)
    };
  }

  // Network transient (ECONNRESET, 503/504, etc.)
  if (matches(text, TRANSIENT_HINTS)) {
    return {
      category: 'retryable-transient',
      retry: remaining,
      forceFreshSession: false,
      needsAuthModal: false,
      userMessage: 'Reconnecting to Claude…',
      delayMs: getClaudeRetryDelay(ctx.attempt - 1)
    };
  }

  // Unknown error — treat as transient so a single blip doesn't drop the user
  // into the Continue-button fallback. Still capped by attempt count.
  return {
    category: 'retryable-transient',
    retry: remaining,
    forceFreshSession: false,
    needsAuthModal: false,
    userMessage: 'Reconnecting to Claude…',
    delayMs: getClaudeRetryDelay(ctx.attempt - 1)
  };
}

/**
 * @param attemptIndex 0-based index of the *next* retry. attemptIndex=0 is the
 * delay before the first retry, =1 before the second, etc.
 */
export function getClaudeRetryDelay(attemptIndex: number): number {
  if (attemptIndex < 0) return CLAUDE_RETRY_DELAYS_MS[0];
  if (attemptIndex >= CLAUDE_RETRY_DELAYS_MS.length) {
    return CLAUDE_RETRY_DELAYS_MS[CLAUDE_RETRY_DELAYS_MS.length - 1];
  }
  return CLAUDE_RETRY_DELAYS_MS[attemptIndex];
}

// Re-export the provider-agnostic delay utility from codex/recovery so callers
// only need to import from one place.
export { delayWithAbort } from '../codex/recovery';
