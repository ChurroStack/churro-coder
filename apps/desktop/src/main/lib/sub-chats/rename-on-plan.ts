/**
 * Renames a sub-chat (and optionally its parent chat) when the first plan
 * lands on a still-placeholder sub-chat. Mirrors `auto-rename.ts` on the
 * renderer side but runs server-side so the rename happens even when no
 * window is viewing the chat.
 *
 * The gate predicate is duplicated in the `UPDATE … WHERE` clause as well
 * as the read-check, so a concurrent first-message rename / GC sweep can't
 * slip past us — whichever statement commits first wins; the loser sees
 * `changes === 0` and gives up.
 *
 * The DB-touching ops are injectable via `RenameOnPlanDeps` for testability
 * (the production path opens better-sqlite3 via Electron's Node ABI, which
 * vitest in plain Node can't load — same constraint that drives the mock-
 * based tests for `auto-rename.ts`).
 */
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { chats, subChats } from '../db/schema';
import { getDatabase } from '../db';
import { isPlaceholderName, KNOWN_PLACEHOLDERS, sanitizePlanTitleForTab } from './placeholders';

export interface RenameOnPlanResult {
  subChatRenamed?: string;
  parentChatRenamed?: string;
}

export interface RenameOnPlanDeps {
  /** Returns null when the sub-chat row does not exist. */
  readSubChat(subChatId: string): { name: string | null; chatId: string } | null;
  /** Returns true when the UPDATE affected ≥1 row. Re-asserts the placeholder gate in WHERE. */
  renameSubChatIfPlaceholder(subChatId: string, newName: string): boolean;
  /** Returns sibling sub-chat ids for `chatId`, ordered by createdAt ASC. */
  listSubChatsByChat(chatId: string): { id: string }[];
  /** Returns null when the parent chat row does not exist. */
  readChat(chatId: string): { name: string | null } | null;
  /** Returns true when the UPDATE affected ≥1 row. Re-asserts the placeholder gate in WHERE. */
  renameChatIfPlaceholder(chatId: string, newName: string): boolean;
}

const KNOWN_PLACEHOLDERS_LIST = Array.from(KNOWN_PLACEHOLDERS);

function logDecision(
  subChatId: string,
  chatId: string | null,
  decision: string,
  oldName: string | null | undefined,
  newName: string | null
): void {
  console.log(
    `[plan-rename] sub=${subChatId} chat=${chatId ?? 'unknown'} decision=${decision} old=${oldName ?? 'NULL'} new=${newName ?? 'NULL'}`
  );
}

export function renameSubChatOnFirstPlan(
  subChatId: string,
  rawTitle: string,
  depsOverride?: RenameOnPlanDeps
): RenameOnPlanResult {
  const sanitized = sanitizePlanTitleForTab(rawTitle);
  if (!sanitized) {
    logDecision(subChatId, null, 'skipped-empty-title', undefined, null);
    return {};
  }

  // Lazy-resolve so the empty-title fast-path above never calls
  // `getDatabase()` or allocates the five closures inside `defaultDeps()`.
  const deps = depsOverride ?? defaultDeps();

  const subRow = deps.readSubChat(subChatId);
  if (!subRow) {
    logDecision(subChatId, null, 'skipped-no-row', undefined, sanitized);
    return {};
  }

  if (!isPlaceholderName(subRow.name)) {
    logDecision(subChatId, subRow.chatId, 'skipped-already-named', subRow.name, sanitized);
    return {};
  }

  const renamed = deps.renameSubChatIfPlaceholder(subChatId, sanitized);
  if (!renamed) {
    logDecision(subChatId, subRow.chatId, 'skipped-gate-race', subRow.name, sanitized);
    return {};
  }
  logDecision(subChatId, subRow.chatId, 'renamed', subRow.name, sanitized);

  // First-sub-chat semantics match `auto-rename.ts` — earliest createdAt is
  // "first", not lowest count. Earlier-created (but later-deleted) sub-chats
  // shouldn't promote this row to "first" for the parent-rename branch.
  const siblings = deps.listSubChatsByChat(subRow.chatId);
  if (siblings[0]?.id !== subChatId) {
    return { subChatRenamed: sanitized };
  }

  const parentRow = deps.readChat(subRow.chatId);
  if (!parentRow || !isPlaceholderName(parentRow.name)) {
    if (parentRow) {
      logDecision(subChatId, subRow.chatId, 'parent-skipped-already-named', parentRow.name, sanitized);
    }
    return { subChatRenamed: sanitized };
  }

  const parentRenamed = deps.renameChatIfPlaceholder(subRow.chatId, sanitized);
  if (!parentRenamed) {
    logDecision(subChatId, subRow.chatId, 'parent-skipped-gate-race', parentRow.name, sanitized);
    return { subChatRenamed: sanitized };
  }

  logDecision(subChatId, subRow.chatId, 'parent-renamed', parentRow.name, sanitized);
  return { subChatRenamed: sanitized, parentChatRenamed: sanitized };
}

function defaultDeps(): RenameOnPlanDeps {
  const db = getDatabase();
  return {
    readSubChat(subChatId) {
      const row = db
        .select({ name: subChats.name, chatId: subChats.chatId })
        .from(subChats)
        .where(eq(subChats.id, subChatId))
        .get();
      return row ?? null;
    },
    renameSubChatIfPlaceholder(subChatId, newName) {
      const result = db
        .update(subChats)
        .set({ name: newName, updatedAt: new Date() })
        .where(
          and(eq(subChats.id, subChatId), or(isNull(subChats.name), inArray(subChats.name, KNOWN_PLACEHOLDERS_LIST)))
        )
        .returning({ id: subChats.id })
        .all();
      return result.length > 0;
    },
    listSubChatsByChat(chatId) {
      return db
        .select({ id: subChats.id })
        .from(subChats)
        .where(eq(subChats.chatId, chatId))
        .orderBy(asc(subChats.createdAt))
        .all();
    },
    readChat(chatId) {
      const row = db.select({ name: chats.name }).from(chats).where(eq(chats.id, chatId)).get();
      return row ?? null;
    },
    renameChatIfPlaceholder(chatId, newName) {
      const result = db
        .update(chats)
        .set({ name: newName, updatedAt: new Date() })
        .where(and(eq(chats.id, chatId), or(isNull(chats.name), inArray(chats.name, KNOWN_PLACEHOLDERS_LIST))))
        .returning({ id: chats.id })
        .all();
      return result.length > 0;
    }
  };
}
