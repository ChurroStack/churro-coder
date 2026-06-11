/**
 * Shared constants for the "Ask Questions" (elicitation) mechanism.
 *
 * Used by all three harnesses so the question lifetime + messaging stay in sync:
 *   - builtin Claude SDK   → src/main/lib/trpc/routers/claude.ts
 *   - Codex CLI            → src/main/lib/trpc/routers/codex.ts
 *   - Claude CLI (MCP)     → src/main/lib/mcp/handlers/request-user-input.ts
 *
 * This file is intentionally dependency-free so both the Node main process and
 * the browser renderer can import it.
 */

/**
 * How long a question stays answerable before the host expires it cleanly.
 *
 * Humans need time to think (and may be in another workspace), so this is
 * deliberately generous. The host owns this timeout — it is NOT imposed by
 * Claude/Codex. Each harness arms its own backstop at this value:
 *   - builtin / Codex: an in-process `setTimeout`.
 *   - Claude CLI (MCP over HTTP): a backstop timer in the tool handler PLUS the
 *     per-server `timeout` written into the CLI's `--mcp-config` file (so
 *     claude-code's own logical tool timeout matches), PLUS periodic SSE
 *     keepalive bytes so claude-code's transport body-idle timeout never trips
 *     while the user thinks. Keepalive keeps the transport alive; it does NOT
 *     extend the logical timeout — the per-server `timeout` does that.
 */
export const ASK_USER_QUESTION_TIMEOUT_MS = 300_000; // 5 minutes

/** Tool-result text when the user did not answer in time. The agent may ask again. */
export const QUESTIONS_TIMED_OUT_MESSAGE = 'Timed out';

/** Tool-result text when the user explicitly skipped. */
export const QUESTIONS_SKIPPED_MESSAGE = 'User skipped questions - proceed with defaults';
