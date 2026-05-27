/**
 * CLI session ingester.
 *
 * Watches a single Claude / Codex JSONL transcript for a given sub-chat, parses
 * new appended lines, and:
 *   1) persists ingested messages into the `messages` table (idx monotonic);
 *   2) fans out side-effects (file changes, plan, tasks, review) into the
 *      existing per-sub-chat stores with fill-gaps semantics (MCP wins on
 *      conflict — we only fill what the MCP server missed).
 *
 * One ingester instance per (subChatId, sessionFile). The module-level
 * registry maps subChatId -> active ingester so callers can dispose or
 * re-bind on session changes.
 *
 * Thread safety:
 *   - Per-subchat async-mutex around the read-modify-write of the ingest-state
 *     file AND the side-effect fan-out (E1: races with MCP writes; E2: races
 *     with manual Refresh).
 *   - The file-changes-store and task-store have their own internal write
 *     queues, so concurrent calls from different code paths are already
 *     serialized at the artifact level.
 *
 * Multi-window (E5) is intentionally NOT covered in v1 — if two desktop
 * windows have the same sub-chat panel open they will both spawn ingesters
 * that double-write idx via the unique index conflict-clause. This is
 * inefficient but correct; a future enhancement could add a flock(2) on the
 * ingest-state file. Documented in cli-session-mapping.md.
 */

import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import chokidar, { type FSWatcher } from 'chokidar';
import { Mutex } from 'async-mutex';
import type { CliHarness } from '../cli-harness';
import { getDatabase } from '../db';
import { appendIngestedMessage, nextMessageIdx, refreshSubChatCountersAfterIngest } from '../db/messages-table';
import { notifyFilesChanged } from '../file-changes/file-changes-store';
import { ensurePlanWritten } from '../plans/plan-store';
import { writeTasks } from '../tasks/task-store';
import {
  createMapperState,
  mapClaudeLine,
  mapCodexLine,
  type IngestedMessage,
  type IngestedSideEffect,
  type MapperState
} from './jsonl-mapper';
import {
  emptyIngestState,
  mutateIngestState,
  readIngestState,
  type IngestState
} from './ingest-state-store';

const TRACE = '[cli-ingest]';

export interface IngestEvent {
  subChatId: string;
  newMessageCount: number;
  sideEffectsApplied: number;
}

const ingestEmitter = new EventEmitter();
ingestEmitter.setMaxListeners(100);

export function onCliSessionIngest(handler: (event: IngestEvent) => void): () => void {
  ingestEmitter.on('ingest', handler);
  return () => ingestEmitter.off('ingest', handler);
}

// ── per-subchat mutex registry ───────────────────────────────────────────────
const mutexes = new Map<string, Mutex>();
function lockFor(subChatId: string): Mutex {
  let m = mutexes.get(subChatId);
  if (!m) {
    m = new Mutex();
    mutexes.set(subChatId, m);
  }
  return m;
}

// ── ingester instance ────────────────────────────────────────────────────────

export class CliSessionIngester {
  private watcher: FSWatcher | null = null;
  private mapperState: MapperState = createMapperState();
  private stopped = false;

  constructor(
    public readonly subChatId: string,
    public readonly harness: CliHarness,
    public sessionFile: string
  ) {}

  /** Begin watching the session file. Idempotent. */
  async start(): Promise<void> {
    if (this.watcher) return;
    // Catch up on anything already in the file (covers app restart with state
    // pointing into the middle of a file that has grown since).
    await this.ingestPending().catch((err) => {
      console.warn(`${TRACE} initial catch-up failed sub=${this.subChatId} err=${err}`);
    });

    this.watcher = chokidar.watch(this.sessionFile, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 }
    });
    this.watcher.on('change', () => {
      if (this.stopped) return;
      this.ingestPending().catch((err) => {
        console.warn(`${TRACE} change-handler failed sub=${this.subChatId} err=${err}`);
      });
    });
    this.watcher.on('error', (err) => {
      console.warn(`${TRACE} watcher error sub=${this.subChatId} file=${this.sessionFile} err=${err}`);
    });
    console.log(`${TRACE} started sub=${this.subChatId} file=${this.sessionFile}`);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watcher) {
      await this.watcher.close().catch(() => {});
      this.watcher = null;
    }
  }

  /** Re-bind to a new session file (e.g. after Claude --resume created a fresh
   *  JSONL). Persists a session-break marker into the messages table to keep
   *  the visual transcript continuous, then re-starts from byte 0 of the new
   *  file. */
  async rebind(newSessionFile: string, prevSessionId?: string, newSessionId?: string): Promise<void> {
    await this.stop();
    this.sessionFile = newSessionFile;
    this.mapperState = createMapperState();
    await lockFor(this.subChatId).runExclusive(async () => {
      const db = getDatabase();
      const idx = nextMessageIdx(db, this.subChatId);
      appendIngestedMessage(db, this.subChatId, idx, {
        id: `session-break-${Date.now()}`,
        role: 'assistant',
        parts: [
          {
            type: 'session-break',
            harness: this.harness,
            ...(prevSessionId ? { prevSessionId } : {}),
            ...(newSessionId ? { newSessionId } : {})
          }
        ],
        createdAt: Date.now()
      });
      refreshSubChatCountersAfterIngest(db, this.subChatId);
      // Reset ingest state to point at the new file from byte 0; bump nextIdx
      // past the session-break we just wrote.
      await mutateIngestState(
        this.subChatId,
        () => emptyIngestState(newSessionFile, idx + 1),
        () => emptyIngestState(newSessionFile)
      );
      ingestEmitter.emit('ingest', { subChatId: this.subChatId, newMessageCount: 1, sideEffectsApplied: 0 });
    });
    this.stopped = false;
    await this.start();
  }

  /** Re-walk the session file from byte 0. Wipes ingest-state UUIDs and resets
   *  byteOffset; nextIdx is restored from the DB so already-persisted rows
   *  aren't duplicated (the unique (subChatId, id) index also catches dups). */
  async reingestFull(): Promise<{ newMessageCount: number; sideEffectsApplied: number }> {
    return lockFor(this.subChatId).runExclusive(async () => {
      const db = getDatabase();
      const nextIdx = nextMessageIdx(db, this.subChatId);
      await mutateIngestState(
        this.subChatId,
        () => ({ sessionFile: this.sessionFile, byteOffset: 0, messageUuids: [], nextIdx }),
        () => emptyIngestState(this.sessionFile, nextIdx)
      );
      this.mapperState = createMapperState();
      return this.ingestPendingLocked();
    });
  }

  /** Stream-parse from lastOffset → EOF, ingest new messages, apply
   *  side-effects, persist ingest-state. */
  async ingestPending(): Promise<{ newMessageCount: number; sideEffectsApplied: number }> {
    return lockFor(this.subChatId).runExclusive(() => this.ingestPendingLocked());
  }

  private async ingestPendingLocked(): Promise<{ newMessageCount: number; sideEffectsApplied: number }> {
    const db = getDatabase();
    const dbIdx = nextMessageIdx(db, this.subChatId);
    const state =
      (await readIngestState(this.subChatId)) ??
      emptyIngestState(this.sessionFile, dbIdx);

    // A7 reconciliation: take max of DB nextIdx and state.nextIdx. After a
    // crash one side may be ahead of the other.
    let nextIdx = Math.max(state.nextIdx, dbIdx);
    let byteOffset = state.byteOffset;
    const seen = new Set(state.messageUuids);

    // If the underlying file got smaller (shouldn't happen — append-only — but
    // be defensive in case of truncation/rotate), rewind.
    try {
      const s = await stat(this.sessionFile);
      if (s.size < byteOffset) {
        console.warn(`${TRACE} file shrank sub=${this.subChatId} prevOffset=${byteOffset} size=${s.size} — rewinding`);
        byteOffset = 0;
        seen.clear();
      }
    } catch (err) {
      console.warn(`${TRACE} stat failed sub=${this.subChatId} err=${err}`);
      return { newMessageCount: 0, sideEffectsApplied: 0 };
    }

    let bytesConsumed = byteOffset;
    let messagesIngested = 0;
    let sideEffectsApplied = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(this.sessionFile, {
        encoding: 'utf8',
        start: byteOffset
      });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', async (line) => {
        bytesConsumed += Buffer.byteLength(line, 'utf8') + 1; // +1 for the newline
        if (!line.trim()) return;

        const result =
          this.harness === 'claude-cli' ? mapClaudeLine(line, this.mapperState) : mapCodexLine(line, this.mapperState);

        for (const msg of result.messages) {
          if (seen.has(msg.uuid)) continue;
          const inserted = appendIngestedMessage(db, this.subChatId, nextIdx, {
            id: msg.uuid,
            role: msg.role,
            parts: msg.parts,
            ...(msg.metadata ? { metadata: msg.metadata } : {}),
            createdAt: msg.createdAt
          });
          seen.add(msg.uuid);
          if (inserted !== null) {
            nextIdx = inserted + 1;
            messagesIngested += 1;
          }
        }

        // Apply side-effects with fill-gaps semantics.
        for (const se of result.sideEffects) {
          const applied = await applySideEffect(this.subChatId, se);
          if (applied) sideEffectsApplied += 1;
        }
      });
      rl.on('close', resolve);
      rl.on('error', reject);
      stream.on('error', reject);
    }).catch((err) => {
      console.warn(`${TRACE} read stream error sub=${this.subChatId} err=${err}`);
    });

    if (messagesIngested > 0) refreshSubChatCountersAfterIngest(db, this.subChatId);

    // Persist new watermark.
    await mutateIngestState(
      this.subChatId,
      (s) => ({
        sessionFile: this.sessionFile,
        byteOffset: bytesConsumed,
        messageUuids: [...s.messageUuids, ...Array.from(seen).filter((u) => !s.messageUuids.includes(u))],
        nextIdx
      }),
      () => ({ sessionFile: this.sessionFile, byteOffset: bytesConsumed, messageUuids: Array.from(seen), nextIdx })
    );

    if (messagesIngested > 0 || sideEffectsApplied > 0) {
      ingestEmitter.emit('ingest', {
        subChatId: this.subChatId,
        newMessageCount: messagesIngested,
        sideEffectsApplied
      });
      console.log(
        `${TRACE} ingested sub=${this.subChatId} messages=${messagesIngested} side-effects=${sideEffectsApplied} bytes=${bytesConsumed}`
      );
    }

    return { newMessageCount: messagesIngested, sideEffectsApplied };
  }
}

// ── side-effect fan-out ─────────────────────────────────────────────────────

async function applySideEffect(subChatId: string, se: IngestedSideEffect): Promise<boolean> {
  try {
    switch (se.kind) {
      case 'file-change':
        // Union-merge: notifyFilesChanged dedups by path internally (last
        // action wins), so calling it here only adds entries the MCP server
        // missed. We label the source so the Changes widget can show
        // provenance if it ever wants to.
        await notifyFilesChanged({
          subChatId,
          files: [{ path: se.path, action: se.action }],
          source: 'cli-ingest'
        });
        return true;
      case 'plan': {
        // ensurePlanWritten = fill-gaps: writes only if no current.md yet.
        const res = await ensurePlanWritten({
          subChatId,
          content: se.markdown,
          source: 'cli-ingest',
          title: se.title ?? 'Plan'
        });
        return res.written;
      }
      case 'tasks': {
        // Tasks: fill-gaps. Write only if no existing task list. Codex's
        // update_plan ships plan items as an array of objects; we
        // best-effort normalize into the {id,title,status} shape used by
        // task-store. If items don't have a stable id, generate one.
        if (await hasTasksList(subChatId)) return false;
        const normalized = normalizeTasks(se.tasks);
        if (normalized.length === 0) return false;
        await writeTasks({ subChatId, tasks: normalized, source: 'cli-ingest' });
        return true;
      }
      case 'review':
        // Reviews follow a similar file-backed pattern but we don't have a
        // small ensureReview helper yet; fall back to no-op for v1 and
        // surface this in a follow-up.
        return false;
    }
  } catch (err) {
    console.warn(`${TRACE} side-effect failed sub=${subChatId} kind=${se.kind} err=${err}`);
    return false;
  }
}

async function hasTasksList(subChatId: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises');
    const { constants } = await import('node:fs');
    const { join } = await import('node:path');
    const { app } = await import('electron');
    await access(
      join(app.getPath('userData'), 'sub-chats', subChatId, 'tasks', 'current.json'),
      constants.R_OK
    );
    return true;
  } catch {
    return false;
  }
}

function normalizeTasks(raw: unknown): Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }> = [];
  let i = 0;
  for (const item of raw) {
    i += 1;
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title : typeof obj.step === 'string' ? obj.step : null;
    if (!title) continue;
    const rawStatus = typeof obj.status === 'string' ? obj.status : 'pending';
    const status: 'pending' | 'in_progress' | 'completed' =
      rawStatus === 'completed' ? 'completed' : rawStatus === 'in_progress' ? 'in_progress' : 'pending';
    const id = typeof obj.id === 'string' && obj.id ? obj.id : `t-${i}`;
    out.push({ id, title, status });
  }
  return out;
}

// ── registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, CliSessionIngester>();

export function getIngester(subChatId: string): CliSessionIngester | undefined {
  return registry.get(subChatId);
}

/** Attach (or re-attach) an ingester for a sub-chat. If one already exists
 *  for the same session file, no-op. If for a different file, rebinds. */
export async function attachIngester(
  subChatId: string,
  harness: CliHarness,
  sessionFile: string
): Promise<CliSessionIngester> {
  const existing = registry.get(subChatId);
  if (existing) {
    if (existing.sessionFile === sessionFile) return existing;
    const prevSessionId = pathBaseName(existing.sessionFile);
    const newSessionId = pathBaseName(sessionFile);
    await existing.rebind(sessionFile, prevSessionId, newSessionId);
    return existing;
  }
  const ing = new CliSessionIngester(subChatId, harness, sessionFile);
  registry.set(subChatId, ing);
  await ing.start();
  return ing;
}

export async function detachIngester(subChatId: string): Promise<void> {
  const ing = registry.get(subChatId);
  if (!ing) return;
  await ing.stop();
  registry.delete(subChatId);
}

function pathBaseName(p: string): string {
  const i = p.lastIndexOf('/');
  return (i === -1 ? p : p.slice(i + 1)).replace(/\.jsonl$/, '');
}
