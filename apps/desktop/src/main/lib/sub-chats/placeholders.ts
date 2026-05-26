/**
 * Shared placeholder names for sub-chats and parent chats.
 *
 * `subChats.name` is left NULL at creation so the app-quit cleanup at
 * `apps/desktop/src/main/index.ts` (DELETE WHERE message_count=0 AND name IS NULL)
 * can GC unused sub-chats. The string values below are the user-visible
 * placeholder labels the renderer falls back to when name is NULL, plus the
 * casing variant that some optimistic-insert paths use. Any auto-rename gate
 * (first-message or first-plan) treats both NULL and these strings as "still
 * a placeholder, safe to overwrite".
 */
export const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(['New Chat', 'New chat']);

export function isPlaceholderName(name: string | null | undefined): boolean {
  if (name == null) return true;
  return KNOWN_PLACEHOLDERS.has(name);
}

const TITLE_MAX_LEN = 80;

/**
 * Plan headings can be long and markdown-flavored. Tab titles need to be
 * short, plain text. Strip leading "Plan:" / "Plan -" prefixes (redundant
 * inside a plan widget), strip markdown emphasis and backticks, collapse
 * whitespace, clamp to TITLE_MAX_LEN with an ellipsis. Empty input or input
 * that sanitizes to the bare `'Plan'` sentinel returns `''` so the rename
 * gate can skip it.
 */
export function sanitizePlanTitleForTab(raw: string): string {
  if (!raw) return '';

  let title = raw.trim();
  // Strip leading "Plan:" / "Plan -" / "Plan —" prefixes (case-insensitive).
  title = title.replace(/^plan\s*[:—–-]\s*/i, '').trim();
  // Strip markdown emphasis (**bold**, *italic*, __bold__, _italic_) and inline code (`x`).
  title = title.replace(/\*\*([^*]+)\*\*/g, '$1');
  title = title.replace(/__([^_]+)__/g, '$1');
  title = title.replace(/(^|\s)[*_]([^*_]+)[*_](\s|$)/g, '$1$2$3');
  title = title.replace(/`([^`]+)`/g, '$1');
  // Collapse runs of whitespace.
  title = title.replace(/\s+/g, ' ').trim();

  if (!title) return '';
  // The `extractPlanTitleFromContent` fallback is the literal string 'Plan' —
  // treat it as no-real-heading and let the gate skip.
  if (title === 'Plan') return '';

  if (title.length > TITLE_MAX_LEN) {
    title = `${title.slice(0, TITLE_MAX_LEN - 1).trimEnd()}…`;
  }
  return title;
}
