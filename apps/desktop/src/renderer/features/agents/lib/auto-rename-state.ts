/**
 * Module-level state shared between the two CLI auto-rename writers:
 *   1. `cli-prompt-bar.tsx` — first-user-send path (Ollama-generated name).
 *   2. `details-rail.tsx`'s `artifactWrittenForChat` handler — first-plan-
 *      write path (sanitized plan heading, applied server-side and surfaced
 *      via the rename payload on `plan-written` events).
 *
 * Either path may fire first. Whichever does, adds the subChatId to this
 * Set; the other path then sees the marker and skips, so we don't fire two
 * renames that race to overwrite each other's value. Cleared only on full
 * reload — survives panel remount, mirroring `mcpInjectedSessions` in
 * `use-harness-send-dispatcher`.
 */
export const cliAutoRenameTriggered = new Set<string>();

/** Test-only: clears the module-level "already triggered" tracking set. */
export function _resetCliAutoRenameTriggered(): void {
  cliAutoRenameTriggered.clear();
}
