import { asc, and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema';
import { messages, subChats } from './schema';
import { writePartIfLargeSync } from './part-spill';
import { computeFileStatsFromMessages } from '../file-stats';
import { firstTextOfParts } from '../../../shared/message-parts';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Escape SQL LIKE metacharacters (`\ % _`) in a value so it can be embedded in a
 * `... LIKE '%' || value || '%' ESCAPE '\'` pattern as a literal substring.
 * Tool-call ids contain `_`, which is otherwise a single-char wildcard.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

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
 * Append a single ingested message (CLI-session ingestion path).
 *
 * Differs from {@link writeMessagesToTable}:
 *   - Caller assigns idx explicitly (the ingester tracks it monotonically).
 *   - Inserts one row, not a batch reconciled from a full message list.
 *   - Returns the actual inserted idx (or null if the unique index rejected
 *     the row — happens when the same message UUID is ingested twice; the
 *     caller treats this as a no-op).
 *
 * The unique (sub_chat_id, id) index on messages is the safety net against
 * double-inserts when the ingester's UUID dedup misses (e.g. after a
 * partial-write crash).
 *
 * Claim-merge: when ingesting a user message AND the row at idx-1 is an
 * optimistic pre-bootstrap user write (id matches `msg-<timestamp>`) AND
 * its trimmed text equals the new message's trimmed text, the existing row's
 * id is upgraded to the JSONL UUID instead of inserting a duplicate. The
 * optimistic row's idx and content are preserved so the UI's instant-feedback
 * bubble doesn't flicker; the UUID upgrade keeps fork/rollback/parent-uuid
 * chains aligned with what the CLI itself uses. Returns null in that case so
 * the caller leaves nextIdx unchanged.
 */
export function appendIngestedMessage(
  db: DB,
  subChatId: string,
  idx: number,
  msg: { id: string; role: 'user' | 'assistant'; parts: unknown[]; metadata?: unknown; createdAt: number }
): number | null {
  try {
    // SELECT(prior) + UPDATE(claim) + INSERT(new) are wrapped in a single
    // SQLite transaction so a hypothetical future caller running outside the
    // per-subchat ingester mutex (`cli-session/ingester.ts:69-77`) still sees
    // atomic read-then-write semantics. Today that mutex already serializes
    // the path; the transaction is defense-in-depth.
    return db.transaction((tx) => {
      if (idx > 0 && msg.role === 'user') {
        const prior = tx
          .select({ id: messages.id, parts: messages.parts, role: messages.role })
          .from(messages)
          .where(and(eq(messages.subChatId, subChatId), eq(messages.idx, idx - 1)))
          .get();
        if (prior && prior.role === 'user' && /^msg-\d+$/.test(prior.id)) {
          const priorText = extractFirstTrimmedText(prior.parts, subChatId, idx - 1);
          const newText = firstTextOfParts(msg.parts);
          if (priorText !== null && newText !== null && priorText === newText) {
            // Only `id` is upgraded — `parts`, `metadata`, and `created_at` are
            // intentionally preserved from the optimistic write. The optimistic
            // row's idx (0), rendered content, and chat-creation timestamp are
            // invariants downstream consumers depend on; the id-upgrade is
            // strictly about aligning fork / rollback / parent-uuid lookups
            // with the canonical UUID the CLI uses in its own JSONL.
            tx.update(messages)
              .set({ id: msg.id })
              .where(and(eq(messages.subChatId, subChatId), eq(messages.idx, idx - 1)))
              .run();
            console.log(
              `[cli-ingest] claim-merge sub=${subChatId} optimisticIdx=${idx - 1} optimisticId=${prior.id} newUuid=${msg.id}`
            );
            return null;
          }
        }
      }

      const processedParts = processPartsForStorage(subChatId, msg.id, msg.parts);
      const res = tx
        .insert(messages)
        .values({
          subChatId,
          idx,
          id: msg.id,
          role: msg.role,
          parts: JSON.stringify(processedParts),
          metadata: msg.metadata !== undefined ? JSON.stringify(msg.metadata) : null,
          createdAt: new Date(msg.createdAt)
        })
        .onConflictDoNothing()
        .run();
      return res.changes > 0 ? idx : null;
    });
  } catch (err) {
    console.warn(`[messages-table] appendIngestedMessage failed sub=${subChatId} idx=${idx}`, err);
    return null;
  }
}

function extractFirstTrimmedText(partsJson: string, subChatId: string, idx: number): string | null {
  try {
    const arr = JSON.parse(partsJson);
    return firstTextOfParts(arr);
  } catch (err) {
    console.warn(`[messages-table] claim-merge: malformed prior parts JSON sub=${subChatId} idx=${idx}`, err);
    return null;
  }
}

/**
 * Re-persist the parts of an already-ingested message (CLI-session path).
 *
 * Used when a `tool_result` arrives on a JSONL record *after* the `tool_use`
 * record was already inserted: the in-memory part was merged with its output,
 * but the immutable INSERT can't see that mutation, so the persisted row stays
 * at state 'input-available' and renders as "interrupted". This UPDATE lands the
 * merged parts. Re-runs `processPartsForStorage` so large parts still spill; the
 * caller passes the full in-memory parts array (un-spilled originals), so spill
 * is reconstructed correctly. `idx`/`createdAt` are intentionally untouched.
 * Idempotent. Returns true when a row was updated.
 */
export function updateIngestedMessageParts(db: DB, subChatId: string, messageId: string, parts: unknown[]): boolean {
  try {
    const processedParts = processPartsForStorage(subChatId, messageId, parts);
    const res = db
      .update(messages)
      .set({ parts: JSON.stringify(processedParts) })
      .where(and(eq(messages.subChatId, subChatId), eq(messages.id, messageId)))
      .run();
    return res.changes > 0;
  } catch (err) {
    console.warn(`[messages-table] updateIngestedMessageParts failed sub=${subChatId} msg=${messageId}`, err);
    return false;
  }
}

/**
 * Patch a single tool part's output/state, located by `toolCallId`, in whichever
 * persisted message contains it. Fallback for the restart-mid-tool case where the
 * `tool_use` was persisted in a prior app session (so the in-memory pending ref is
 * gone) but its `tool_result` is read live. Bounded to the most recent `limit`
 * assistant rows — tool results follow their use within a turn — to keep the scan
 * cheap; the on-attach repair walk is the comprehensive backstop. Returns true on
 * a successful patch.
 *
 * Note: only finds parts stored inline (the common case). A part whose JSON
 * exceeded the 256 KB spill threshold loses `toolCallId` in its on-disk stub and
 * won't match here; such parts are healed by the repair walk, which rebuilds from
 * the transcript. (The stub does retain `state`, so `hasOrphanedToolPart` still
 * gates the repair walk on a spilled orphan — see part-spill.ts.)
 */
export function updateMessagePartByToolCallId(
  db: DB,
  subChatId: string,
  toolCallId: string,
  output: unknown,
  state: 'output-available' | 'output-error',
  limit = 20
): boolean {
  try {
    // toolCallId contains `_` (e.g. `toolu_…`, `call_…`) which is a LIKE
    // wildcard. Escape `\ % _` and add an ESCAPE clause so the substring match
    // is literal — otherwise the pattern is broadened and, combined with the
    // LIMIT below, could evict the true owner row from the scanned window.
    const pattern = `%${escapeLikePattern(toolCallId)}%`;
    const rows = db
      .select({ id: messages.id, parts: messages.parts })
      .from(messages)
      .where(and(eq(messages.subChatId, subChatId), sql`${messages.parts} LIKE ${pattern} ESCAPE '\\'`))
      .orderBy(desc(messages.idx))
      .limit(limit)
      .all();
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.parts);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const i = parsed.findIndex(
        (p) => p && typeof p === 'object' && (p as { toolCallId?: unknown }).toolCallId === toolCallId
      );
      if (i === -1) continue;
      parsed[i] = { ...(parsed[i] as Record<string, unknown>), output, state };
      return updateIngestedMessageParts(db, subChatId, row.id, parsed);
    }
    console.warn(
      `[messages-table] updateMessagePartByToolCallId no inline match sub=${subChatId} toolCallId=${toolCallId}`
    );
    return false;
  } catch (err) {
    console.warn(
      `[messages-table] updateMessagePartByToolCallId failed sub=${subChatId} toolCallId=${toolCallId}`,
      err
    );
    return false;
  }
}

/**
 * Cheap gate for the on-attach tool-result repair: does this sub_chat have any
 * persisted part still at state 'input-available'? Such a part is either an
 * orphaned tool call (result dropped before the persistence fix / across a
 * restart) or a genuinely interrupted one. Only when this is true does the
 * ingester pay for a repair walk.
 */
export function hasOrphanedToolPart(db: DB, subChatId: string): boolean {
  try {
    const row = db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.subChatId, subChatId), like(messages.parts, '%"state":"input-available"%')))
      .limit(1)
      .get();
    return !!row;
  } catch (err) {
    console.warn(`[messages-table] hasOrphanedToolPart failed sub=${subChatId}`, err);
    return false;
  }
}

/** Query MAX(idx)+1 for a sub_chat; 0 if no rows. */
export function nextMessageIdx(db: DB, subChatId: string): number {
  const row = db
    .select({ lastIdx: sql<number | null>`MAX(${messages.idx})` })
    .from(messages)
    .where(eq(messages.subChatId, subChatId))
    .get();
  return (row?.lastIdx ?? -1) + 1;
}

/** Update the denormalized counters on sub_chats after a batch of ingested
 *  messages. Mirrors the bookkeeping at the end of writeMessagesToTable. */
export function refreshSubChatCountersAfterIngest(db: DB, subChatId: string): void {
  try {
    const row = db
      .select({
        count: sql<number>`COUNT(*)`,
        lastIdx: sql<number | null>`MAX(${messages.idx})`
      })
      .from(messages)
      .where(eq(messages.subChatId, subChatId))
      .get();
    if (!row) return;
    db.update(subChats)
      .set({
        messageCount: row.count,
        lastMessageIdx: row.count > 0 ? row.lastIdx : null
      })
      .where(eq(subChats.id, subChatId))
      .run();
  } catch (err) {
    console.warn(`[messages-table] refreshSubChatCountersAfterIngest failed sub=${subChatId}`, err);
  }
}

/**
 * Delete every message row for a sub_chat, leaving the sub_chat itself intact.
 * Used by the CLI-session rebuild path (codex heal): the caller re-ingests from
 * the JSONL afterwards, so this wipes the stale render-cache rows first. Does
 * NOT touch the sub_chats counters — the re-ingest's
 * `refreshSubChatCountersAfterIngest` recomputes them.
 */
export function deleteMessagesForSubChat(db: DB, subChatId: string): void {
  try {
    db.delete(messages).where(eq(messages.subChatId, subChatId)).run();
  } catch (err) {
    console.warn(`[messages-table] deleteMessagesForSubChat failed sub=${subChatId}`, err);
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
