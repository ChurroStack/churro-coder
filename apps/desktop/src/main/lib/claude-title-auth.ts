/**
 * Auth resolver for the two *background* cloud-Claude REST helpers — chat-title
 * generation (`generateChatNameWithClaude`) and commit-message generation
 * (`generateCommitMessageWithClaude`).
 *
 * These helpers make raw `POST /v1/messages` calls and must use an **explicit
 * API key only** — either the shell-env `ANTHROPIC_API_KEY` or the in-app
 * onboarding key (`customClaudeConfig`, threaded in from the renderer). They
 * must NEVER fall back to the user's Claude *subscription* OAuth token: that
 * token is for running Claude Code itself (CLAUDE_CODE_OAUTH_TOKEN), not for
 * arbitrary API calls, and reusing it for title/commit generation produced the
 * "unwanted claude task that runs and errors" during CLI sessions.
 *
 * Pure (only reads `process.env` + its argument) and Electron-free so it can be
 * unit-tested in plain Node.
 */

const OFFICIAL_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
/** Cheap/fast model for the shell-env key path (no model is configured there). */
const TITLE_MODEL = 'claude-haiku-4-5-20251001';

export type ClaudeRestAuth = {
  /** Full messages endpoint, e.g. `https://api.anthropic.com/v1/messages`. */
  url: string;
  /** Auth header — chosen by token type (see `authHeaderForToken`). */
  headers: Record<string, string>;
  /** Model id to request. */
  model: string;
};

/**
 * Pick the HTTP auth header by **token type**, matching how the builtin Claude
 * SDK authenticates the same in-app key (it applies the token as
 * `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`, see `trpc/routers/claude.ts`).
 *
 * A standard Anthropic API key (`sk-ant-…`) authenticates via `x-api-key` only
 * — sending it as a Bearer token 401s (Bearer is the OAuth scheme and would
 * need the `anthropic-beta: oauth-2025-04-20` header we don't send). Any other
 * token (proxy / gateway / OAuth-style, accepted from custom-model onboarding
 * and the Settings → Models tab) authenticates as `Authorization: Bearer`.
 *
 * Selecting by token type rather than by base URL means title/commit generation
 * authenticates the in-app key the same way the user's chats already do.
 */
function authHeaderForToken(token: string): Record<string, string> {
  return token.startsWith('sk-ant-') ? { 'x-api-key': token } : { Authorization: `Bearer ${token}` };
}

/**
 * Resolve the REST auth for a background Claude generator.
 *
 * Precedence:
 *   1. `custom` — the in-app onboarding key (`customClaudeConfig`). Honors its
 *      `baseUrl` and `model`; header chosen by token type (mirrors the SDK).
 *   2. `process.env.ANTHROPIC_API_KEY` — shell-env key ⇒ official API +
 *      `x-api-key` + cheap haiku (preserves prior behavior).
 *   3. Otherwise `null` — NEVER the subscription OAuth token.
 */
export function resolveClaudeRestAuth(custom?: {
  model: string;
  token: string;
  baseUrl: string;
}): ClaudeRestAuth | null {
  if (custom?.token && custom.baseUrl && custom.model) {
    const base = custom.baseUrl.replace(/\/+$/, '');
    return {
      url: `${base}/v1/messages`,
      headers: authHeaderForToken(custom.token),
      model: custom.model
    };
  }

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return {
      url: `${OFFICIAL_ANTHROPIC_BASE_URL}/v1/messages`,
      headers: { 'x-api-key': envKey },
      model: TITLE_MODEL
    };
  }

  return null;
}
