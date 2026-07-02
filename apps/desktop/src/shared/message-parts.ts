/**
 * Shared helpers for inspecting message `parts` arrays.
 *
 * Both the main process (ingester / messages-table claim-merge) and the
 * renderer (cli-conversation-pane dedup) need to extract a comparable text
 * representation of a user message. Keeping the logic in a single shared
 * module avoids drift if the part shape evolves.
 */

/**
 * Return the trimmed text of the first `{ type: 'text', text }` part in the
 * array, or null if no such part exists (or its text is whitespace-only).
 *
 * Used by both:
 *   - `appendIngestedMessage` claim-merge (main process)
 *   - `isAdjacentUserDup` render-time dedup (renderer)
 */
export function firstTextOfParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    if (p && typeof p === 'object' && (p as { type?: unknown }).type === 'text') {
      const text = (p as { text?: unknown }).text;
      if (typeof text === 'string') {
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    }
  }
  return null;
}

/**
 * True when a user row's first text is a harness-injected notice, not
 * something the user actually typed: a background sub-agent's
 * `<task-notification>` (Claude Code writes Task-tool completion pings into
 * the JSONL as plain `role='user'` records), a `<system-reminder>`, or an
 * interrupt marker. These are real transcript content and are rendered
 * unchanged in the CLI conversation pane — this predicate exists only for
 * consumers that need the user's *actual last input* (the Session widget's
 * "Last input" via `getSessionPrompts`), where a machine notice must never be
 * picked over a genuine prompt.
 */
export function isMachineInjectedUserText(firstText: string): boolean {
  const t = firstText.trimStart();
  return (
    t.startsWith('<task-notification') ||
    t.startsWith('<task-id>') || // defensive: some rows lead with the inner tag
    t.startsWith('<system-reminder') ||
    /^\[Request interrupted by user/.test(t)
  );
}
