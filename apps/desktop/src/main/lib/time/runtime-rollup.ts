/**
 * Crash recovery for the LIVE half of `work_intervals` (builtin turns).
 *
 * CLI / terminal runtime is reconstructed from the usage JSONLs (see
 * usage-runtime.ts); only the builtin harness records `origin='live'` intervals,
 * and those can be left open by a hard quit. recoverOpenIntervals() closes them
 * at startup, clamping `endedAt` to the sub-chat's last message timestamp.
 *
 * Invoked once at startup by the scheduler (see rollup.ts), BEFORE new turns can
 * open.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDatabase } from '../db';
import { workIntervals, messages } from '../db/schema';

const TRACE = '[time-runtime]';

function toMs(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  return v instanceof Date ? v.getTime() : Number(v);
}

/**
 * Close any live interval left open by a hard quit / crash. We can't know the
 * true end, so we clamp `endedAt` to the sub-chat's last message timestamp
 * (a good proxy for "last activity"), falling back to `startedAt` (0 duration)
 * when there are no messages. Run once at startup, BEFORE new turns open.
 */
export function recoverOpenIntervals(): void {
  try {
    const db = getDatabase();
    const open = db
      .select()
      .from(workIntervals)
      .where(and(isNull(workIntervals.endedAt), eq(workIntervals.origin, 'live')))
      .all();
    if (open.length === 0) return;

    for (const iv of open) {
      const last = db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.subChatId, iv.subChatId))
        .orderBy(desc(messages.idx))
        .limit(1)
        .get();
      // The true end of a crashed turn is unknowable. We clamp to the sub-chat's
      // last message timestamp when it's strictly after the start; otherwise we
      // fall back to startedAt (0 duration). This deliberately UNDER-counts a
      // turn that crashed before its assistant message was persisted (the safe
      // error for billing — never over-bill for time after a crash). `!= null`
      // (not a falsy check) so a legitimate epoch-0 timestamp isn't dropped.
      const lastMs = last ? toMs(last.createdAt) : null;
      const ended = lastMs != null && lastMs > iv.startedAt ? lastMs : iv.startedAt;
      db.update(workIntervals).set({ endedAt: ended, updatedAt: new Date() }).where(eq(workIntervals.id, iv.id)).run();
    }
    console.log(`${TRACE} recovered ${open.length} open interval(s)`);
  } catch (err) {
    console.warn(`${TRACE} recoverOpenIntervals failed`, err);
  }
}
