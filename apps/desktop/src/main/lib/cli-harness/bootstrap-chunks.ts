/**
 * Pure assembly of the CLI's `initialInputChunks` — the ordered PTY writes that
 * bootstrap a freshly-spawned (or restarted) CLI session with the user's first
 * message. Kept free of electron/drizzle so it can be unit-tested; the caller
 * (chats.buildCliBootstrap) supplies the already-encoded body chunk plus the
 * mode/model/advisor context read from the DB and the request.
 *
 * Each array element is written to the PTY as an independent read (with a small
 * inter-chunk delay), so a trailing `\r` submits the line rather than being
 * treated as a newline inside a multi-line paste.
 *
 * Claude CLI sequence:
 *   1. " \r"                — space + Enter, dismisses the CLI's first-run
 *                             "press Enter to continue" screen (all starts)
 *   2. "/model <cmd>\r"     — e.g. `opusplan`, when Plan=Opus & Execute=Sonnet
 *   3. "/plan\r"            — plan mode only (re-enters plan mode; a fresh spawn
 *                             starts in execute mode)
 *   4. "/advisor <model>\r" — when the Advisor default mode is enabled
 *   5. bodyChunk + "\r"     — the first user message
 *
 * Codex keeps its original layout — `/model`, `/advisor` and `opusplan` are
 * Claude-only concepts.
 */
export function buildCliInitialInputChunks(params: {
  harness: 'claude-cli' | 'codex-cli';
  isPlanMode: boolean;
  bodyChunk: string;
  /** Claude only. e.g. 'opusplan'. Ignored for codex-cli. */
  claudeModelCommand?: string;
  /** Claude only. e.g. 'opus' | 'sonnet'. Ignored for codex-cli. */
  advisorModel?: string;
}): string[] {
  const { harness, isPlanMode, bodyChunk, claudeModelCommand, advisorModel } = params;

  if (harness === 'claude-cli') {
    const pre: string[] = [' \r'];
    if (claudeModelCommand) pre.push(`/model ${claudeModelCommand}\r`);
    if (isPlanMode) pre.push('/plan\r');
    if (advisorModel) pre.push(`/advisor ${advisorModel}\r`);
    return [...pre, bodyChunk, '\r'];
  }

  // Codex: plan mode re-enters /plan first; otherwise just the body + submit.
  return isPlanMode ? ['/plan\r', bodyChunk, '\r'] : [bodyChunk, '\r'];
}
