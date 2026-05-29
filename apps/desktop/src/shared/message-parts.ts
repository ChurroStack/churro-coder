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
