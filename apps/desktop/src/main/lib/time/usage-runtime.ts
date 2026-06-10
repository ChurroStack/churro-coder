/**
 * Runtime (`work_intervals`, `origin='derived'`) reconstructed from the usage
 * JSONLs — the SAME files the spend rollup reads — so a project's time reflects
 * ALL Claude/Codex work on its paths, including the user's own terminal sessions
 * that never went through a churro sub-chat.
 *
 * Each session's per-response timestamps are gap-sessionized into billable
 * intervals and attributed to a project by cwd (see project-resolver.ts).
 * Builtin sub-chats are skipped here (their runtime is captured live in
 * interval-tracker.ts) to avoid double counting.
 *
 * Full rebuild (delete-all `derived` + reinsert) so deletions/edits converge,
 * mirroring the token rollup. Builtin `origin='live'` rows are untouched.
 */
import { eq } from 'drizzle-orm';
import { getDatabase } from '../db';
import { workIntervals } from '../db/schema';
import { createId } from '../db/utils';
import type { UsageEntry } from '../usage/types';
import {
  resolveSession,
  projectBasePath,
  recordDerivedBasePath,
  type ProjectIndex,
  type SessionMap
} from './project-resolver';
import { sessionizeTimestamps } from './sessionize';

const TRACE = '[time-usage-runtime]';

type SessionGroup = {
  sessionId: string | null;
  cwd: string | null;
  source: 'claude' | 'codex';
  timestamps: number[];
};

export function rollupUsageRuntime(
  entries: UsageEntry[],
  index: ProjectIndex,
  sessionMap: SessionMap,
  skipSessionIds: Set<string>
): void {
  try {
    const db = getDatabase();

    // Group activity timestamps per session (fallback to cwd when a record has
    // no session id, so the work still attributes to a project).
    const groups = new Map<string, SessionGroup>();
    for (const e of entries) {
      if (e.sessionId && skipSessionIds.has(e.sessionId)) continue; // builtin → live intervals
      const key = e.sessionId ?? `cwd:${e.cwd ?? 'unknown'}`;
      let g = groups.get(key);
      if (!g) {
        g = { sessionId: e.sessionId ?? null, cwd: e.cwd ?? null, source: e.source, timestamps: [] };
        groups.set(key, g);
      }
      g.timestamps.push(e.ts);
    }

    let inserted = 0;
    db.transaction((tx) => {
      tx.delete(workIntervals).where(eq(workIntervals.origin, 'derived')).run();
      for (const g of groups.values()) {
        const idn = resolveSession(g.sessionId, g.cwd, g.source, sessionMap, index);
        // Builtin runtime is captured LIVE (interval-tracker.ts). Skip any session
        // that resolves to a builtin sub-chat so we never double-count its turn as
        // both a live AND a derived interval — defense-in-depth beyond the session-id
        // skip set, which only covers ids currently stored on the sub-chat row.
        // (A builtin transcript whose id was resumed-away and is no longer stored
        // anywhere is undetectable here; builtin rarely writes such transcripts.)
        if (idn.harness === 'builtin') continue;
        // Remember a representative folder for non-churro projects so the Time
        // page can offer an "open folder" link for them too.
        if (idn.projectId === null) recordDerivedBasePath(idn.projectName, projectBasePath(g.cwd, index));
        for (const s of sessionizeTimestamps(g.timestamps)) {
          if (s.end <= s.start) continue; // single-point / zero-duration → no billable time
          tx.insert(workIntervals)
            .values({
              id: createId(),
              subChatId: idn.subChatId,
              projectId: idn.projectId,
              projectName: idn.projectName,
              chatId: idn.chatId,
              chatName: idn.chatName,
              subChatName: idn.subChatName,
              harness: g.source === 'codex' ? 'codex-cli' : 'claude-cli',
              source: g.source,
              startedAt: s.start,
              endedAt: s.end,
              origin: 'derived',
              createdAt: new Date(),
              updatedAt: new Date()
            })
            .run();
          inserted += 1;
        }
      }
    });
    console.log(`${TRACE} rebuilt ${inserted} derived interval(s) from ${groups.size} session(s)`);
  } catch (err) {
    console.warn(`${TRACE} rollupUsageRuntime failed`, err);
  }
}
