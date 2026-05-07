/**
 * Counts checkbox items in a tasks.md file. Indented sub-items count too —
 * the OpenSpec convention nests `- [ ] 1.1`, `- [ ] 1.2.1`, etc.
 *
 * Returns `{ total: 0, done: 0 }` when no checkboxes are present (e.g., the
 * file is empty or contains only headings).
 */

const CHECKBOX_REGEX = /^\s*-\s+\[([ xX])\]\s+/;

export function parseTaskProgress(raw: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const line of raw.split(/\r?\n/)) {
    const m = CHECKBOX_REGEX.exec(line);
    if (!m) continue;
    total++;
    const mark = m[1]!;
    if (mark === 'x' || mark === 'X') done++;
  }
  return { total, done };
}
