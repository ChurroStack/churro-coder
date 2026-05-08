/**
 * Codex chat-stream recovery policy.
 *
 * Pure helpers used by the codex.chat tRPC subscription to decide whether a
 * failure is retryable, whether the Codex app-server process needs to be
 * restarted before the next attempt, and how long to wait between attempts.
 *
 * Kept side-effect free so it can be unit-tested without touching the real
 * app-server, file system, or network.
 */

export type CodexFailureCategory =
  | 'retryable-transient'
  | 'restartable'
  | 'auth'
  | 'user-cancel'
  | 'unsafe-partial'
  | 'rate-limit'
  | 'no-internet'
  | 'fatal';

export type CodexFailureClassification = {
  category: CodexFailureCategory;
  retry: boolean;
  forceRestart: boolean;
  userMessage: string;
};

export type ClassifyContext = {
  /**
   * Whether the failed turn already produced user-visible output (assistant
   * text, tool-input/output chunks, etc.). When true, the only retryable
   * scenarios are restartable app-server failures while resuming the same
   * thread - never an automatic prompt replay.
   */
  observedSideEffects: boolean;
  /**
   * 1-based attempt number that just failed. attempt=1 means the first try
   * failed and we are deciding whether to retry once.
   */
  attempt: number;
  aborted?: boolean;
};

export const CODEX_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 10000] as const;
/**
 * Max number of retries (failures *after* the initial attempt). The schedule
 * has 5 entries → 5 retries → 6 total attempts: every wait tier is reachable.
 */
export const CODEX_MAX_RETRIES = CODEX_RETRY_DELAYS_MS.length;
/** Total attempts the loop is allowed to make (initial + every retry). */
export const CODEX_MAX_ATTEMPTS = CODEX_MAX_RETRIES + 1;
/**
 * After this many consecutive failed retries we forcibly dispose the cached
 * Codex app-server so the next attempt spawns a fresh process.
 */
export const CODEX_FORCE_RESTART_AFTER = 3;

const AUTH_HINTS = [
  'not logged in',
  'authentication required',
  'auth required',
  'login required',
  'missing credentials',
  'no credentials',
  'unauthorized',
  'forbidden',
  'codex login',
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
  'request timed out',
  'idle for',
  'turn timed out',
  'temporarily unavailable',
  '503',
  '504'
];

const RESTARTABLE_HINTS = [
  'app-server is not running',
  'app-server disposed',
  'app-server exited',
  'app-server closed',
  'epipe',
  'write epipe'
];

const RATE_LIMIT_HINTS = ['rate limit', 'too many requests', 'quota exceeded', '429'];

const FATAL_HINTS = ['bundled codex cli not found', 'sub-chat not found'];

function describeError(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (error === null || error === undefined) return '';
  if (typeof error !== 'object') return String(error).toLowerCase();

  const obj = error as { code?: unknown; message?: unknown; data?: { code?: unknown; message?: unknown } };
  const fragments: unknown[] = [obj.code, obj.message, obj.data?.code, obj.data?.message];
  const text = fragments
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value))
    .join(' ')
    .toLowerCase();
  // Fall back to the stringified value so non-Error objects (and custom
  // throwables without code/message) still get their hint text inspected.
  return text || String(error).toLowerCase();
}

function matches(text: string, hints: readonly string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

export function classifyCodexFailure(error: unknown, ctx: ClassifyContext): CodexFailureClassification {
  if (ctx.aborted) {
    return {
      category: 'user-cancel',
      retry: false,
      forceRestart: false,
      userMessage: 'Cancelled'
    };
  }

  const text = describeError(error);

  // Auth and fatal bypass side-effect / attempt-limit gates because they will
  // never recover by retrying.
  if (matches(text, AUTH_HINTS)) {
    return {
      category: 'auth',
      retry: false,
      forceRestart: false,
      userMessage: 'Codex authentication required'
    };
  }
  if (matches(text, FATAL_HINTS)) {
    return {
      category: 'fatal',
      retry: false,
      forceRestart: false,
      userMessage: 'Codex is not configured correctly'
    };
  }

  // Once the turn has produced user-visible output, replaying the same prompt
  // would duplicate output. Treat anything else as unsafe-partial.
  if (ctx.observedSideEffects) {
    return {
      category: 'unsafe-partial',
      retry: false,
      forceRestart: false,
      userMessage: 'Codex stream interrupted after partial output'
    };
  }

  // attempt=N means N tries have failed; we've used N-1 retries so far. We can
  // still retry whenever (attempt - 1) < CODEX_MAX_RETRIES, i.e. attempt <= MAX.
  const remaining = ctx.attempt <= CODEX_MAX_RETRIES;
  const forceRestartByAttempt = ctx.attempt >= CODEX_FORCE_RESTART_AFTER;

  if (matches(text, NO_INTERNET_HINTS)) {
    return {
      category: 'no-internet',
      retry: remaining,
      forceRestart: false,
      userMessage: 'No internet connection — retrying Codex…'
    };
  }
  if (matches(text, RATE_LIMIT_HINTS)) {
    return {
      category: 'rate-limit',
      retry: remaining,
      forceRestart: false,
      userMessage: 'Codex rate-limited — retrying…'
    };
  }
  // Check transient hints before restartable so an idle/turn-timeout error
  // (whose message contains "Codex app-server") is not mis-classified as a
  // dead process.
  if (matches(text, TRANSIENT_HINTS)) {
    return {
      category: 'retryable-transient',
      retry: remaining,
      forceRestart: forceRestartByAttempt,
      userMessage: 'Reconnecting to Codex…'
    };
  }
  if (matches(text, RESTARTABLE_HINTS)) {
    return {
      category: 'restartable',
      retry: remaining,
      forceRestart: true,
      userMessage: 'Restarting Codex app-server…'
    };
  }

  // Unknown error — treat as transient so a single network blip doesn't drop
  // the user into the Continue-button fallback. We still cap by attempt count
  // and force-restart after CODEX_FORCE_RESTART_AFTER consecutive failures.
  return {
    category: 'retryable-transient',
    retry: remaining,
    forceRestart: forceRestartByAttempt,
    userMessage: 'Reconnecting to Codex…'
  };
}

/**
 * @param attemptIndex 0-based index of the *next* retry. attemptIndex=0 is the
 * delay before the first retry, =1 before the second, etc.
 */
export function getCodexRetryDelay(attemptIndex: number): number {
  if (attemptIndex < 0) return CODEX_RETRY_DELAYS_MS[0];
  if (attemptIndex >= CODEX_RETRY_DELAYS_MS.length) {
    return CODEX_RETRY_DELAYS_MS[CODEX_RETRY_DELAYS_MS.length - 1];
  }
  return CODEX_RETRY_DELAYS_MS[attemptIndex];
}

/**
 * Resolves either when the delay elapses or when the abort signal fires. Never
 * rejects - callers should re-check signal.aborted afterwards.
 */
export async function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) return;

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
