/**
 * tRPC router for CLI-session ingestion.
 *
 * Procedures:
 *   - getStatus({subChatId})        → current sessionFile / id / message count.
 *   - reingest({subChatId, full?})  → re-parse the session file (incremental
 *                                     or from byte 0). Used by the Refresh
 *                                     button in the status widget.
 *   - relocate({subChatId})         → re-run the locator (in case the CLI
 *                                     restarted while the panel was closed).
 *   - onMessages({subChatId})       → observable that fires after every
 *                                     successful ingest (caller refetches).
 *
 * The mutations are idempotent — calling them while a watcher event is being
 * processed is safe (the per-subchat mutex serializes both paths).
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { publicProcedure, router } from '../index';
import { getDatabase } from '../../db';
import { subChats, chats, projects } from '../../db/schema';
import type { CliHarness } from '../../cli-harness';
import { locateSessionFile } from '../../cli-session/locator';
import {
  attachIngester,
  detachIngester,
  getIngester,
  onCliSessionIngest,
  type IngestEvent
} from '../../cli-session/ingester';

const TRACE = '[cli-session-trpc]';

const subChatIdInput = z.object({ subChatId: z.string().min(1) });

interface CliSubChatRow {
  harness: CliHarness;
  cliSessionFile: string | null;
  cliSessionId: string | null;
  cliSessionDetectedAt: number | null;
  cwd: string | null;
}

function loadCliRow(subChatId: string): CliSubChatRow | null {
  const db = getDatabase();
  const row = db
    .select({
      harness: subChats.harness,
      cliSessionFile: subChats.cliSessionFile,
      cliSessionId: subChats.cliSessionId,
      cliSessionDetectedAt: subChats.cliSessionDetectedAt,
      worktreePath: chats.worktreePath,
      projectId: chats.projectId
    })
    .from(subChats)
    .innerJoin(chats, eq(subChats.chatId, chats.id))
    .where(eq(subChats.id, subChatId))
    .get();
  if (!row) return null;
  if (row.harness !== 'claude-cli' && row.harness !== 'codex-cli') return null;
  let cwd: string | null = row.worktreePath;
  if (!cwd && row.projectId) {
    const proj = db.select({ path: projects.path }).from(projects).where(eq(projects.id, row.projectId)).get();
    cwd = proj?.path ?? null;
  }
  return {
    harness: row.harness as CliHarness,
    cliSessionFile: row.cliSessionFile,
    cliSessionId: row.cliSessionId,
    cliSessionDetectedAt: row.cliSessionDetectedAt,
    cwd
  };
}

/**
 * Returns every `cliSessionFile` path bound to ANY OTHER subChat. Used to
 * prevent the locator from picking up a transcript already claimed by a
 * different sub-chat (defense-in-depth across same-instant races and external
 * CLI processes).
 *
 * Filters out paths that no longer exist on disk so an orphan record from a
 * deleted worktree doesn't poison future lookups.
 */
function claimedSessionFiles(excludingSubChatId: string): ReadonlySet<string> {
  const db = getDatabase();
  const rows = db
    .select({ file: subChats.cliSessionFile })
    .from(subChats)
    .where(and(isNotNull(subChats.cliSessionFile), ne(subChats.id, excludingSubChatId)))
    .all();
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.file) continue;
    if (!existsSync(r.file)) continue;
    out.add(r.file);
  }
  return out;
}

/**
 * Persists the located session inside a transaction that re-checks no other
 * sub-chat has already claimed this `cliSessionFile`. Returns `'collision'`
 * when the path is claimed elsewhere — the caller should retry the locator
 * with that path excluded.
 */
function persistLocatedSession(subChatId: string, sessionFile: string, sessionId: string): 'ok' | 'collision' {
  const db = getDatabase();
  return db.transaction((tx) => {
    const conflict = tx
      .select({ id: subChats.id })
      .from(subChats)
      .where(and(eq(subChats.cliSessionFile, sessionFile), ne(subChats.id, subChatId)))
      .get();
    if (conflict) {
      console.warn(`${TRACE} persist-collision sub=${subChatId} file=${sessionFile} owned-by=${conflict.id}`);
      return 'collision' as const;
    }
    tx.update(subChats)
      .set({
        cliSessionFile: sessionFile,
        cliSessionId: sessionId,
        cliSessionDetectedAt: Date.now()
      })
      .where(eq(subChats.id, subChatId))
      .run();
    return 'ok' as const;
  });
}

export const cliSessionRouter = router({
  getStatus: publicProcedure.input(subChatIdInput).query(({ input }) => {
    const row = loadCliRow(input.subChatId);
    if (!row) return { harness: null, sessionFile: null, sessionId: null, detectedAt: null, watching: false };
    return {
      harness: row.harness,
      sessionFile: row.cliSessionFile,
      sessionId: row.cliSessionId,
      detectedAt: row.cliSessionDetectedAt,
      watching: !!getIngester(input.subChatId)
    };
  }),

  /** Refresh button entry point. Re-runs the locator AND re-ingests. */
  relocate: publicProcedure.input(subChatIdInput).mutation(async ({ input }) => {
    const row = loadCliRow(input.subChatId);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'sub-chat not found or not a CLI harness' });
    if (!row.cwd) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'cwd unresolved for sub-chat' });

    // If the stored file still exists, we can just re-attach the watcher.
    // Otherwise re-run the locator with an old spawnedAt so historical files
    // are still considered.
    if (row.cliSessionFile && existsSync(row.cliSessionFile)) {
      await attachIngester(input.subChatId, row.harness, row.cliSessionFile);
      return { sessionFile: row.cliSessionFile, sessionId: row.cliSessionId };
    }

    // Use the sub-chat's detectedAt (or createdAt) as the lookback floor so
    // backfill works for sub-chats that existed before this feature.
    const spawnedAt = row.cliSessionDetectedAt ?? Date.now() - 7 * 86_400_000;
    const excludePaths = claimedSessionFiles(input.subChatId);
    const located = await locateSessionFile({
      harness: row.harness,
      cwd: row.cwd,
      spawnedAt,
      // Refresh always honors a pre-allocated id (set by buildCliBootstrap on
      // first claude-cli spawn). Existing rows with a detected id will use
      // the same field — the locator's path-pinning works either way.
      expectedSessionId: row.cliSessionId ?? undefined,
      excludePaths
    });
    if (!located) {
      console.warn(`${TRACE} relocate-miss sub=${input.subChatId} cwd=${row.cwd}`);
      return { sessionFile: null, sessionId: null };
    }
    const persistResult = persistLocatedSession(input.subChatId, located.sessionFile, located.sessionId);
    if (persistResult === 'collision') {
      console.warn(`${TRACE} relocate-collision sub=${input.subChatId} file=${located.sessionFile}`);
      return { sessionFile: null, sessionId: null };
    }
    await attachIngester(input.subChatId, row.harness, located.sessionFile);
    return { sessionFile: located.sessionFile, sessionId: located.sessionId };
  }),

  /** Re-parse the session file. `full: true` walks from byte 0. */
  reingest: publicProcedure
    .input(subChatIdInput.extend({ full: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const ing = getIngester(input.subChatId);
      if (!ing) {
        return { newMessageCount: 0, sideEffectsApplied: 0, attached: false };
      }
      const result = input.full ? await ing.reingestFull() : await ing.ingestPending();
      return { ...result, attached: true };
    }),

  /** Fire-and-forget detach (panel close). Idempotent. */
  detach: publicProcedure.input(subChatIdInput).mutation(async ({ input }) => {
    await detachIngester(input.subChatId);
  }),

  /** Observable — emits {subChatId, fromIdx} after every ingest batch. */
  onMessages: publicProcedure.input(subChatIdInput).subscription(({ input }) => {
    return observable<{ subChatId: string; newMessageCount: number; sideEffectsApplied: number }>((emit) => {
      const handler = (e: IngestEvent) => {
        if (e.subChatId === input.subChatId) emit.next(e);
      };
      const unsubscribe = onCliSessionIngest(handler);
      return () => unsubscribe();
    });
  })
});

/**
 * Hook called from terminal.createOrAttach right after PTY spawn. Resolves
 * cwd + harness from the sub-chat row, runs the locator with backoff, and
 * attaches the ingester on success. Fire-and-forget — terminal startup must
 * not block on this.
 *
 * Exported so terminal.ts can call it without going through tRPC.
 */
export async function postSpawnLocateAndAttach(
  subChatId: string,
  spawnedAt: number,
  overrideCwd?: string,
  codexExistingPaths?: ReadonlySet<string>
): Promise<void> {
  const row = loadCliRow(subChatId);
  if (!row) return;
  const cwd = overrideCwd ?? row.cwd;
  if (!cwd) {
    console.warn(`${TRACE} post-spawn cwd-missing sub=${subChatId}`);
    return;
  }

  // Optimistic re-attach: if we already have a watcher on a file that still
  // exists, that's enough. The watcher will pick up new lines.
  if (row.cliSessionFile && existsSync(row.cliSessionFile)) {
    await attachIngester(subChatId, row.harness, row.cliSessionFile).catch((err) => {
      console.warn(`${TRACE} pre-existing attach failed sub=${subChatId} err=${err}`);
    });
    return;
  }

  // Retry up to 3 times on persist-collision (same-instant race between two
  // brand-new codex sub-chats picking the same fresh rollout file). Each
  // retry adds the colliding path to excludePaths so the locator skips it.
  //
  // claimedSessionFiles is queried ONCE — the `persistLocatedSession` txn is
  // what gives us strict correctness against same-instant races; the
  // exclude set is liveness only. Growing it via dynamicExcludes on each
  // collision is what avoids re-locating the same colliding file.
  const baseClaimed = claimedSessionFiles(subChatId);
  const dynamicExcludes = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const excludePaths = new Set(baseClaimed);
    for (const p of dynamicExcludes) excludePaths.add(p);
    const located = await locateSessionFile({
      harness: row.harness,
      cwd,
      spawnedAt,
      // Claude: pinned by --session-id passed at spawn time. Codex: undefined.
      expectedSessionId: row.harness === 'claude-cli' ? (row.cliSessionId ?? undefined) : undefined,
      // Codex: rule out files that pre-existed our spawn.
      existingPaths: codexExistingPaths,
      excludePaths
    });
    if (!located) {
      if (attempt === 0) {
        console.warn(`${TRACE} post-spawn locate-miss sub=${subChatId} harness=${row.harness}`);
      } else {
        console.warn(`${TRACE} post-spawn locate-miss-after-collision sub=${subChatId} attempt=${attempt}`);
      }
      return;
    }
    const persistResult = persistLocatedSession(subChatId, located.sessionFile, located.sessionId);
    if (persistResult === 'ok') {
      await attachIngester(subChatId, row.harness, located.sessionFile).catch((err) => {
        console.warn(`${TRACE} post-spawn attach failed sub=${subChatId} err=${err}`);
      });
      return;
    }
    dynamicExcludes.add(located.sessionFile);
  }
  console.error(`${TRACE} post-spawn locate-collision-exhausted sub=${subChatId}`);
}

/**
 * App-start hook. Walks all sub-chats with a recorded cliSessionFile and
 * starts an ingester for each (so reopened panels show their transcript
 * immediately). Skips files that no longer exist on disk.
 */
export async function bootstrapIngestersOnAppStart(): Promise<void> {
  const db = getDatabase();
  const rows = db
    .select({ id: subChats.id, harness: subChats.harness, file: subChats.cliSessionFile })
    .from(subChats)
    .all();
  let attached = 0;
  for (const row of rows) {
    if (!row.file) continue;
    if (row.harness !== 'claude-cli' && row.harness !== 'codex-cli') continue;
    if (!existsSync(row.file)) continue;
    try {
      await attachIngester(row.id, row.harness as CliHarness, row.file);
      attached += 1;
    } catch (err) {
      console.warn(`${TRACE} bootstrap attach failed sub=${row.id} err=${err}`);
    }
  }
  if (attached > 0) console.log(`${TRACE} bootstrapped ${attached} ingester(s) on app start`);
}
