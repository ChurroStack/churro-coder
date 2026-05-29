/**
 * Render-time dedup helper for the CLI conversation pane.
 *
 * `isAdjacentUserDup` drops a user message whose first-text content equals
 * the *immediately preceding rendered user message's* first-text — this
 * hides the optimistic-row + JSONL-ingested duplicate that older CLI sub-chats
 * already have persisted in the DB. New ingestions are deduped at the
 * `appendIngestedMessage` layer (claim-merge), so this is only load-bearing
 * for historical rows.
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

export function isAdjacentUserDup(
  msg: DedupCandidate,
  lastRenderedUserText: string | null
): { dropped: boolean; userText: string | null } {
  if (msg.role !== 'user') return { dropped: false, userText: lastRenderedUserText };
  const text = firstTextOfParts(msg.parts);
  if (text !== null && text === lastRenderedUserText) return { dropped: true, userText: lastRenderedUserText };
  return { dropped: false, userText: text };
}
