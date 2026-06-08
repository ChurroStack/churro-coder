/**
 * File-backed plan storage for the churro-coder MCP system.
 *
 * Stores the latest approved plan per sub-chat under:
 *   <userData>/Churro Coder/sub-chats/<subChatId>/plans/current.md
 *   <userData>/Churro Coder/sub-chats/<subChatId>/plans/current.meta.json
 *
 * API shape mirrors what a future `memory-store.ts` would expose, so both can
 * be used interchangeably by handlers in `src/main/lib/mcp/handlers/`.
 */

import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteArtifact } from '../sub-chat-artifacts/atomic-write';
import type { RenameOnPlanResult } from '../sub-chats/rename-on-plan';

export interface PlanWrittenEvent {
  subChatId: string;
  filePath: string;
  /**
   * Populated by the `write_plan` MCP handler when the plan write also
   * triggered an auto-rename of the sub-chat (and optionally its parent
   * chat). The renderer's `artifactWrittenForChat` subscriber uses this to
   * sync its in-memory store and patch the tRPC cache so the dockview tab
   * title flips immediately, in parallel with the DB-authoritative write
   * that already happened in the main process.
   */
  renamed?: RenameOnPlanResult;
}

const planWrittenEmitter = new EventEmitter();

export function onPlanWritten(handler: (event: PlanWrittenEvent) => void): () => void {
  planWrittenEmitter.on('plan-written', handler);
  return () => planWrittenEmitter.off('plan-written', handler);
}

export interface PlanMeta {
  source: string;
  title: string;
  createdAt: string;
  approvedAt?: string;
}

export interface PlanData {
  content: string;
  meta: PlanMeta;
}

function getPlanDir(subChatId: string): string {
  return join(app.getPath('userData'), 'sub-chats', subChatId, 'plans');
}

export function getPlanFilePath(subChatId: string): string {
  return join(getPlanDir(subChatId), 'current.md');
}

export async function writeCurrentPlan(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
  approvedAt?: string;
  /**
   * Extra data to attach to the `plan-written` event. Used by the
   * `write_plan` handler to forward a sub-chat auto-rename result so the
   * renderer can sync its caches off the same event the rest of the sidebar
   * already subscribes to (avoids a second emit + double cache invalidation).
   *
   * NOTE: callers that need the rename to happen *after* the file write must
   * use {@link persistCurrentPlan} + {@link emitPlanWritten} so the rename
   * can run between the disk write and the emit (the `write_plan` handler
   * does exactly this).
   */
  extras?: { renamed?: RenameOnPlanResult };
}): Promise<void> {
  const filePath = await persistCurrentPlan(opts);
  emitPlanWritten({
    subChatId: opts.subChatId,
    filePath,
    ...(opts.extras?.renamed ? { renamed: opts.extras.renamed } : {})
  });
}

/**
 * Writes the plan body + meta to disk WITHOUT emitting the `plan-written`
 * event. Use this when the caller needs to run more work (e.g. a sub-chat
 * rename) between the disk write and the emit so that the single
 * `plan-written` event can carry the combined result.
 */
export async function persistCurrentPlan(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
  approvedAt?: string;
}): Promise<string> {
  const dir = getPlanDir(opts.subChatId);

  const meta: PlanMeta = {
    source: opts.source,
    title: opts.title,
    createdAt: new Date().toISOString(),
    ...(opts.approvedAt ? { approvedAt: opts.approvedAt } : {})
  };

  // Body then meta — a crash between the two renames leaves meta stale but body
  // intact. Readers tolerate this (missing meta → null return).
  const planFilePath = join(dir, 'current.md');
  await atomicWriteArtifact(planFilePath, opts.content);
  await atomicWriteArtifact(join(dir, 'current.meta.json'), JSON.stringify(meta, null, 2));
  console.log(
    `[churro-coder] plan persisted sub=${opts.subChatId} source=${opts.source} bytes=${Buffer.byteLength(opts.content, 'utf8')}`
  );
  return planFilePath;
}

/** Emits the `plan-written` event without touching disk. Pair with {@link persistCurrentPlan}. */
export function emitPlanWritten(event: PlanWrittenEvent): void {
  planWrittenEmitter.emit('plan-written', event);
}

export async function readCurrentPlan(subChatId: string): Promise<PlanData | null> {
  const dir = getPlanDir(subChatId);
  console.log(`[churro-coder] plan read start sub=${subChatId} dir=${dir}`);

  // The body is authoritative — read it first. A missing or empty body means
  // "no plan".
  let content: string;
  try {
    content = await readFile(join(dir, 'current.md'), 'utf8');
  } catch (err) {
    const code = typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : 'ERR';
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[churro-coder] plan read miss sub=${subChatId} code=${code} message=${message}`);
    return null;
  }
  if (!content.trim()) {
    console.warn(`[churro-coder] plan read empty-body sub=${subChatId}`);
    return null;
  }

  // A missing/corrupt meta sidecar must NOT make the plan invisible. This can
  // happen on a crash between the two atomic writes in persistCurrentPlan, or
  // when CLI-ingest recovered a plan body whose meta never landed. Synthesize a
  // default meta so getCurrentPlan still reports exists:true and the widget
  // renders. No approvedAt ⇒ treated as unapproved, which is correct here.
  let meta: PlanMeta;
  try {
    meta = JSON.parse(await readFile(join(dir, 'current.meta.json'), 'utf8')) as PlanMeta;
  } catch (err) {
    const code = typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : 'ERR';
    console.warn(`[churro-coder] plan meta miss sub=${subChatId} code=${code} — synthesizing default meta`);
    meta = {
      source: 'recovered',
      title: extractPlanTitleFromContent(content),
      createdAt: new Date().toISOString()
    };
  }
  console.log(`[churro-coder] plan read success sub=${subChatId} bytes=${Buffer.byteLength(content, 'utf8')}`);
  return { content, meta };
}

export async function markApproved(subChatId: string): Promise<void> {
  const dir = getPlanDir(subChatId);
  const metaPath = join(dir, 'current.meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as PlanMeta;
    meta.approvedAt = new Date().toISOString();
    await atomicWriteArtifact(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // No plan to approve — silently ignore
  }
}

export async function hasPlan(subChatId: string): Promise<boolean> {
  try {
    // Mirror readCurrentPlan's body gate EXACTLY so the invariant
    // `hasPlan(id) === (readCurrentPlan(id) !== null)` holds: read the body
    // (which also re-checks read permission) and treat a missing, unreadable,
    // or whitespace-only file as "no plan". Anything weaker — e.g. stat().size>0
    // — lets a blank-but-nonzero body report present here while readCurrentPlan
    // reports absent, which re-blocks the CLI-ingest fill-gaps recovery.
    const content = await readFile(join(getPlanDir(subChatId), 'current.md'), 'utf8');
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

export async function ensurePlanWritten(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
  approvedAt?: string;
}): Promise<{ written: boolean }> {
  if (await hasPlan(opts.subChatId)) {
    return { written: false };
  }

  await writeCurrentPlan(opts);
  return { written: true };
}

/** Pull the first markdown `# heading` out of a plan body, falling back to "Plan". */
export function extractPlanTitleFromContent(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || 'Plan';
}
