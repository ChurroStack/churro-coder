/**
 * Render-time dedup helper for the CLI conversation pane.
 *
 * `isAdjacentUserDup` drops a user message whose first-text equals that of the
 * **immediately preceding *rendered* row** when that row is also a user message
 * — i.e. true adjacency. This collapses the optimistic-row + JSONL-ingested
 * duplicate that older CLI sub-chats already have persisted in the DB (the two
 * identical user rows end up adjacent once envelope-only rows are stripped),
 * while NOT dropping a legitimately-repeated short input (e.g. "yes" → assistant
 * turns → "yes"): an intervening assistant row breaks the adjacency. New
 * ingestions are deduped at the `appendIngestedMessage` layer (claim-merge), so
 * this is only load-bearing for historical rows.
 *
 * The text-extraction primitive (`firstTextOfParts`) lives in
 * `src/shared/message-parts.ts` so the main-process claim-merge logic and
 * the renderer use the same notion of "first text".
 */

import { firstTextOfParts } from '../../../../shared/message-parts';

export { firstTextOfParts };

export interface DedupCandidate {
  role: 'user' | 'assistant' | string;
  parts: unknown[];
}

/** The immediately preceding *rendered* row's role + first-text. */
export interface PrevRendered {
  role: 'user' | 'assistant' | string;
  text: string | null;
}

/**
 * Decide whether `msg` is an adjacent-duplicate user row that should be dropped.
 * Only drops when both this row and the previous rendered row are user rows with
 * identical (trimmed) first-text. The caller is responsible for advancing the
 * "previous rendered" marker with every row it KEEPS (user or assistant).
 */
export function isAdjacentUserDup(msg: DedupCandidate, prev: PrevRendered | null): { dropped: boolean } {
  if (msg.role !== 'user') return { dropped: false };
  if (!prev || prev.role !== 'user' || prev.text === null) return { dropped: false };
  const text = firstTextOfParts(msg.parts);
  return { dropped: text !== null && text === prev.text };
}
