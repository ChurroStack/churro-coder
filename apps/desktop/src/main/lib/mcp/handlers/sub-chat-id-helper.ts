import { eq } from 'drizzle-orm';
import { getDatabase, subChats } from '../../db';

/**
 * Standard recovery hint appended to error messages so the model knows where
 * to find subChatId.
 */
const RECOVERY_HINT =
  'Look for "Sub-chat id: <value>" in the system prompt (or the first user message) and pass that exact value as the subChatId argument.';

/**
 * Standard error payload returned when the LLM calls a tool without
 * subChatId (zod schema-level missing) or with an empty string. Shape
 * matches the SDK's `CallToolResult`.
 */
export const SUB_CHAT_ID_MISSING_ERROR = {
  content: [
    {
      type: 'text' as const,
      text: `Error: subChatId is required. ${RECOVERY_HINT}`
    }
  ],
  isError: true as const
};

type SubChatIdCheck =
  | { ok: true }
  | {
      ok: false;
      errorContent: {
        content: Array<{ type: 'text'; text: string }>;
        isError: true;
      };
    };

/**
 * Verify the given id corresponds to a known sub-chat in the database.
 *
 * - Returns `{ ok: true }` when the row exists.
 * - Returns `{ ok: false, errorContent }` when the row is missing.
 * - Returns `{ ok: true }` when the database query throws (test env without
 *   a real SQLite, transient init, etc.) — this preserves the existing
 *   graceful-degradation pattern. Production always has a live DB so this
 *   path only matters for unit tests.
 */
export function requireKnownSubChatId(id: string): SubChatIdCheck {
  try {
    const db = getDatabase();
    const row = db.select({ id: subChats.id }).from(subChats).where(eq(subChats.id, id)).get();
    if (row) return { ok: true };
    return {
      ok: false,
      errorContent: {
        content: [
          {
            type: 'text' as const,
            text: `Error: no sub-chat found for id "${id}". ${RECOVERY_HINT} Do not pass the OpenSpec changeId as subChatId — they are different identifiers.`
          }
        ],
        isError: true as const
      }
    };
  } catch {
    return { ok: true };
  }
}
