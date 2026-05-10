import { eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema';
import { messages, subChats } from './schema';
import { writePartIfLargeSync } from './part-spill';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Populate the messages table for all sub_chats that haven't been migrated yet.
 * Runs async to avoid blocking the main-process event loop: a setImmediate yield
 * between sub_chats lets IPC messages through while the backfill proceeds.
 *
 * Per-sub_chat failures are logged and skipped — the sub_chat keeps reading from
 * the legacy blob until the next startup retries it.
 */
export async function backfillMessages(db: DB): Promise<void> {
  const pending = db
    .select({ id: subChats.id, messages: subChats.messages, updatedAt: subChats.updatedAt })
    .from(subChats)
    .where(isNull(subChats.messagesMigratedAt))
    .all();

  if (pending.length === 0) return;

  console.log(`[backfill] Migrating ${pending.length} sub_chat(s) to messages table`);

  for (const row of pending) {
    // Yield between sub_chats so IPC handlers can run
    await new Promise<void>((resolve) => setImmediate(resolve));

    try {
      migrateOneSubChat(db, row);
    } catch (err) {
      console.error('[backfill] sub_chat failed, will retry on next launch', { id: row.id, err });
    }
  }

  console.log('[backfill] Message backfill complete');
}

function migrateOneSubChat(
  db: DB,
  row: { id: string; messages: string; updatedAt: Date | null }
): void {
  let arr: any[];
  try {
    arr = JSON.parse(row.messages || '[]');
  } catch {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];

  const fallbackTs = row.updatedAt ?? new Date();

  for (let i = 0; i < arr.length; i++) {
    const msg = arr[i];
    if (!msg?.id || !msg?.role) continue;

    const processedParts = Array.isArray(msg.parts)
      ? msg.parts.map((p: unknown, pi: number) => {
          try {
            return writePartIfLargeSync(row.id, msg.id, pi, p);
          } catch (err) {
            console.warn('[backfill] Part spill failed, keeping inline', { sub: row.id, msg: msg.id, part: pi, err });
            return p;
          }
        })
      : [];

    db.insert(messages)
      .values({
        subChatId: row.id,
        idx: i,
        id: msg.id,
        role: msg.role,
        parts: JSON.stringify(processedParts),
        metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
        createdAt: fallbackTs
      })
      .onConflictDoNothing()
      .run();
  }

  db.update(subChats)
    .set({
      messageCount: arr.length,
      lastMessageIdx: arr.length > 0 ? arr.length - 1 : null,
      messagesMigratedAt: new Date()
    })
    .where(eq(subChats.id, row.id))
    .run();
}

/**
 * Sync the messages table to match allMessages (the current blob contents).
 * Only inserts rows for positions not already present — safe to call repeatedly.
 * Sets messages_migrated_at so the renderer can use the new table immediately.
 */
export function syncSubChatMessages(db: DB, subChatId: string, allMessages: any[]): void {
  try {
    const existingRows = db
      .select({ idx: messages.idx })
      .from(messages)
      .where(eq(messages.subChatId, subChatId))
      .all();

    const existingIdxSet = new Set(existingRows.map((r) => r.idx));

    for (let i = 0; i < allMessages.length; i++) {
      if (existingIdxSet.has(i)) continue;

      const msg = allMessages[i];
      if (!msg?.id || !msg?.role) continue;

      const processedParts = Array.isArray(msg.parts)
        ? msg.parts.map((p: unknown, pi: number) => {
            try {
              return writePartIfLargeSync(subChatId, msg.id, pi, p);
            } catch {
              return p;
            }
          })
        : [];

      try {
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
      } catch (err) {
        console.warn(`[messages-sync] insert failed sub=${subChatId} idx=${i}`, err);
      }
    }

    db.update(subChats)
      .set({
        messageCount: allMessages.length,
        lastMessageIdx: allMessages.length > 0 ? allMessages.length - 1 : null,
        messagesMigratedAt: new Date()
      })
      .where(eq(subChats.id, subChatId))
      .run();
  } catch (err) {
    // Non-fatal: blob is still the source of truth in R1
    console.warn(`[messages-sync] sync failed for sub=${subChatId}`, err);
  }
}

/**
 * Delete all messages rows for a sub_chat and clear the migrated flag.
 * Use before a truncation or full replace (rollback, updateSubChatMessages)
 * so the backfill re-processes the sub_chat on next launch.
 * Callers may follow with syncSubChatMessages to re-populate immediately.
 */
export function invalidateSubChatMessages(db: DB, subChatId: string): void {
  try {
    db.delete(messages).where(eq(messages.subChatId, subChatId)).run();
    db.update(subChats)
      .set({ messagesMigratedAt: null, messageCount: 0, lastMessageIdx: null })
      .where(eq(subChats.id, subChatId))
      .run();
  } catch (err) {
    console.warn(`[messages-sync] invalidate failed for sub=${subChatId}`, err);
  }
}
