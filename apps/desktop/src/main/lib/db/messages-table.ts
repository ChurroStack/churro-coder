import { asc, and, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema';
import { messages, subChats } from './schema';
import { writePartIfLargeSync } from './part-spill';
import { computeFileStatsFromMessages } from '../file-stats';

type DB = BetterSQLite3Database<typeof schema>;

function processPartsForStorage(subChatId: string, messageId: string, parts: unknown[]): unknown[] {
  if (!Array.isArray(parts)) return [];
  return parts.map((p, i) => {
    try {
      return writePartIfLargeSync(subChatId, messageId, i, p);
    } catch {
      return p;
    }
  });
}

function rowToMessage(row: typeof messages.$inferSelect): any {
  let parts: unknown[] = [];
  let metadata: unknown = undefined;
  try {
    parts = JSON.parse(row.parts);
  } catch {}
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {}
  }
  return { id: row.id, role: row.role, parts, ...(metadata !== undefined ? { metadata } : {}) };
}

/**
 * Remove a single key from a message's metadata JSON without touching any other rows.
 * Avoids a full delete+reinsert when clearing a one-shot flag (e.g. shouldForkResume).
 */
export function clearMessageMetadataFlag(db: DB, subChatId: string, messageId: string, flag: string): void {
  try {
    const row = db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(and(eq(messages.subChatId, subChatId), eq(messages.id, messageId)))
      .get();
    if (!row) return;
    let meta: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        meta = JSON.parse(row.metadata);
      } catch {}
    }
    if (!(flag in meta)) return;
    delete meta[flag];
    db.update(messages)
      .set({ metadata: JSON.stringify(meta) })
      .where(and(eq(messages.subChatId, subChatId), eq(messages.id, messageId)))
      .run();
  } catch (err) {
    console.warn(`[messages-table] clearMessageMetadataFlag failed sub=${subChatId} msg=${messageId}`, err);
  }
}

/** Read all messages for a sub_chat in chronological order. */
export function readMessagesFromTable(db: DB, subChatId: string): any[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.subChatId, subChatId))
    .orderBy(asc(messages.idx))
    .all()
    .map(rowToMessage);
}

/**
 * Read messages for multiple sub_chats in one query.
 * Returns a Map from subChatId → message array (chronological order).
 */
export function readMessagesForSubChats(db: DB, subChatIds: string[]): Map<string, any[]> {
  if (subChatIds.length === 0) return new Map();
  const rows = db
    .select()
    .from(messages)
    .where(inArray(messages.subChatId, subChatIds))
    .orderBy(asc(messages.subChatId), asc(messages.idx))
    .all();

  const result = new Map<string, any[]>();
  for (const row of rows) {
    if (!result.has(row.subChatId)) result.set(row.subChatId, []);
    result.get(row.subChatId)!.push(rowToMessage(row));
  }
  return result;
}

/**
 * Append new messages to the messages table (only messages not yet persisted).
 * Uses MAX(idx) to skip already-persisted messages — O(new messages), not O(all).
 * Also updates the file-stats columns on sub_chats.
 */
export function writeMessagesToTable(db: DB, subChatId: string, allMessages: any[]): void {
  try {
    const lastRow = db
      .select({ lastIdx: sql<number | null>`MAX(${messages.idx})` })
      .from(messages)
      .where(eq(messages.subChatId, subChatId))
      .get();
    const startFrom = (lastRow?.lastIdx ?? -1) + 1;

    for (let i = startFrom; i < allMessages.length; i++) {
      const msg = allMessages[i];
      if (!msg?.id || !msg?.role) continue;
      const processedParts = processPartsForStorage(subChatId, msg.id, msg.parts ?? []);
      db.insert(messages)
        .values({
          subChatId,
          idx: i,
          id: msg.id,
          role: msg.role,
          parts: JSON.stringify(processedParts),
          metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
          createdAt: new Date()
        })
        .onConflictDoNothing()
        .run();
    }

    const statsJson = JSON.stringify(allMessages);
    db.update(subChats)
      .set({
        messageCount: allMessages.length,
        // idx === array position (invariant: we always assign idx = i), so length - 1 is correct.
        lastMessageIdx: allMessages.length > 0 ? allMessages.length - 1 : null,
        ...computeFileStatsFromMessages(statsJson)
      })
      .where(eq(subChats.id, subChatId))
      .run();
  } catch (err) {
    console.warn(`[messages-table] writeMessagesToTable failed sub=${subChatId}`, err);
  }
}

/**
 * Delete all messages for a sub_chat then re-insert from the given array.
 * Use for full replaces: rollback, fork, updateSubChatMessages.
 * Also updates the file-stats columns on sub_chats.
 */
export function replaceMessagesInTable(db: DB, subChatId: string, allMessages: any[]): void {
  try {
    db.delete(messages).where(eq(messages.subChatId, subChatId)).run();

    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      if (!msg?.id || !msg?.role) continue;
      const processedParts = processPartsForStorage(subChatId, msg.id, msg.parts ?? []);
      db.insert(messages)
        .values({
          subChatId,
          idx: i,
          id: msg.id,
          role: msg.role,
          parts: JSON.stringify(processedParts),
          metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
          createdAt: new Date()
        })
        .run();
    }

    const statsJson = JSON.stringify(allMessages);
    db.update(subChats)
      .set({
        messageCount: allMessages.length,
        // idx === array position (invariant: we always assign idx = i), so length - 1 is correct.
        lastMessageIdx: allMessages.length > 0 ? allMessages.length - 1 : null,
        ...computeFileStatsFromMessages(statsJson)
      })
      .where(eq(subChats.id, subChatId))
      .run();
  } catch (err) {
    console.warn(`[messages-table] replaceMessagesInTable failed sub=${subChatId}`, err);
  }
}
