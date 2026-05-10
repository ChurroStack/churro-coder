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
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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

export async function writeCurrentPlan(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
  approvedAt?: string;
}): Promise<void> {
  const dir = getPlanDir(opts.subChatId);
  await mkdir(dir, { recursive: true });

  const meta: PlanMeta = {
    source: opts.source,
    title: opts.title,
    createdAt: new Date().toISOString(),
    ...(opts.approvedAt ? { approvedAt: opts.approvedAt } : {})
  };

  // Each rename is atomic; the pair isn't. A crash between the two renames leaves
  // metadata stale relative to content, but readers tolerate this (read returns null
  // if either file is missing, and the worst case is a slightly stale title).
  const tmpId = randomUUID();
  const tmpMd = join(dir, `${tmpId}.tmp.md`);
  const tmpJson = join(dir, `${tmpId}.tmp.json`);

  await writeFile(tmpMd, opts.content, 'utf8');
  await writeFile(tmpJson, JSON.stringify(meta, null, 2), 'utf8');

  await rename(tmpMd, join(dir, 'current.md'));
  await rename(tmpJson, join(dir, 'current.meta.json'));
  console.log(
    `[churro-coder] plan persisted sub=${opts.subChatId} source=${opts.source} bytes=${Buffer.byteLength(opts.content, 'utf8')}`
  );
}

export async function readCurrentPlan(subChatId: string): Promise<PlanData | null> {
  const dir = getPlanDir(subChatId);
  console.log(`[churro-coder] plan read start sub=${subChatId} dir=${dir}`);
  try {
    const [content, metaRaw] = await Promise.all([
      readFile(join(dir, 'current.md'), 'utf8'),
      readFile(join(dir, 'current.meta.json'), 'utf8')
    ]);
    const meta = JSON.parse(metaRaw) as PlanMeta;
    console.log(
      `[churro-coder] plan read success sub=${subChatId} bytes=${Buffer.byteLength(content, 'utf8')} metaBytes=${Buffer.byteLength(metaRaw, 'utf8')}`
    );
    return { content, meta };
  } catch (err) {
    const code = typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : 'ERR';
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[churro-coder] plan read miss sub=${subChatId} code=${code} message=${message}`);
    return null;
  }
}

export async function markApproved(subChatId: string): Promise<void> {
  const dir = getPlanDir(subChatId);
  const metaPath = join(dir, 'current.meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as PlanMeta;
    meta.approvedAt = new Date().toISOString();
    await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  } catch {
    // No plan to approve — silently ignore
  }
}

export async function hasPlan(subChatId: string): Promise<boolean> {
  try {
    await access(join(getPlanDir(subChatId), 'current.md'), fsConstants.R_OK);
    return true;
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
