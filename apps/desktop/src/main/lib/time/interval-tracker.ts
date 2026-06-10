/**
 * Live work-interval capture for the BUILTIN harness.
 *
 * Builtin runtime cannot be reconstructed from message timestamps (those are
 * stamped at write time, not when the turn ran — see messages-table.ts), so we
 * record the real turn start/end as a `work_intervals` row with `origin='live'`.
 * CLI harnesses do NOT use this — their runtime is message-derived (see
 * runtime-rollup.ts).
 *
 * Called from the builtin stream lifecycle in trpc/routers/claude.ts:
 *   - openBuiltinTurn(subChatId)  at stream start
 *   - closeBuiltinTurn(subChatId) in the stream's finally
 *
 * All identity fields are denormalized snapshots so the row survives deletion
 * of its sub-chat / chat / project (FK-free ledger). Best-effort: any failure
 * is logged and swallowed so time tracking never breaks a user's turn.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDatabase } from '../db';
import { workIntervals, subChats, chats, projects } from '../db/schema';
import { createId } from '../db/utils';

const TRACE = '[time-interval]';

type Snapshot = {
  harness: string | null;
  subChatName: string | null;
  chatId: string | null;
  chatName: string | null;
  projectId: string | null;
  projectName: string | null;
};

function snapshotIdentity(subChatId: string): Snapshot | undefined {
  const db = getDatabase();
  return db
    .select({
      harness: subChats.harness,
      subChatName: subChats.name,
      chatId: chats.id,
      chatName: chats.name,
      projectId: projects.id,
      projectName: projects.name
    })
    .from(subChats)
    .leftJoin(chats, eq(subChats.chatId, chats.id))
    .leftJoin(projects, eq(chats.projectId, projects.id))
    .where(eq(subChats.id, subChatId))
    .get();
}

export function openBuiltinTurn(subChatId: string): void {
  try {
    const db = getDatabase();
    // Defensive: close any stale-open interval for this sub-chat first so a
    // missed close (e.g. an abort path) can't leave two overlapping rows.
    closeBuiltinTurn(subChatId);

    const snap = snapshotIdentity(subChatId);
    if (!snap) return; // unknown sub-chat — nothing to attribute

    const id = createId();
    const now = Date.now();
    db.insert(workIntervals)
      .values({
        id,
        subChatId,
        projectId: snap.projectId ?? null,
        projectName: snap.projectName ?? null,
        chatId: snap.chatId ?? null,
        chatName: snap.chatName ?? null,
        subChatName: snap.subChatName ?? null,
        harness: snap.harness ?? 'builtin',
        source: 'builtin',
        startedAt: now,
        endedAt: null,
        origin: 'live',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .run();
    console.log(`${TRACE} open builtin sub=${subChatId}`);
  } catch (err) {
    console.warn(`${TRACE} openBuiltinTurn failed sub=${subChatId}`, err);
  }
}

export function closeBuiltinTurn(subChatId: string): void {
  try {
    const db = getDatabase();
    const now = Date.now();
    db.update(workIntervals)
      .set({ endedAt: now, updatedAt: new Date() })
      .where(
        and(eq(workIntervals.subChatId, subChatId), isNull(workIntervals.endedAt), eq(workIntervals.origin, 'live'))
      )
      .run();
  } catch (err) {
    console.warn(`${TRACE} closeBuiltinTurn failed sub=${subChatId}`, err);
  }
}
