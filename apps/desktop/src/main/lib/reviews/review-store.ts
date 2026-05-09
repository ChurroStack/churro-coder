/**
 * File-backed review storage for the churro-coder MCP system.
 *
 * Stores the latest review per sub-chat under:
 *   <userData>/sub-chats/<subChatId>/reviews/current.md
 *   <userData>/sub-chats/<subChatId>/reviews/current.meta.json
 */

import { app } from 'electron';
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ReviewMeta {
  source: string;
  title: string;
  createdAt: string;
  appliedAt?: string;
}

export interface ReviewData {
  content: string;
  meta: ReviewMeta;
}

function getReviewDir(subChatId: string): string {
  return join(app.getPath('userData'), 'sub-chats', subChatId, 'reviews');
}

export async function writeCurrentReview(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
}): Promise<void> {
  const dir = getReviewDir(opts.subChatId);
  await mkdir(dir, { recursive: true });

  const meta: ReviewMeta = {
    source: opts.source,
    title: opts.title,
    createdAt: new Date().toISOString()
  };

  const tmpId = randomUUID();
  const tmpMd = join(dir, `${tmpId}.tmp.md`);
  const tmpJson = join(dir, `${tmpId}.tmp.json`);

  await writeFile(tmpMd, opts.content, 'utf8');
  await writeFile(tmpJson, JSON.stringify(meta, null, 2), 'utf8');

  await rename(tmpMd, join(dir, 'current.md'));
  await rename(tmpJson, join(dir, 'current.meta.json'));
  console.log(
    `[churro-coder] review persisted sub=${opts.subChatId} source=${opts.source} bytes=${Buffer.byteLength(opts.content, 'utf8')}`
  );
}

export async function readCurrentReview(subChatId: string): Promise<ReviewData | null> {
  const dir = getReviewDir(subChatId);
  console.log(`[churro-coder] review read start sub=${subChatId} dir=${dir}`);
  try {
    const [content, metaRaw] = await Promise.all([
      readFile(join(dir, 'current.md'), 'utf8'),
      readFile(join(dir, 'current.meta.json'), 'utf8')
    ]);
    const meta = JSON.parse(metaRaw) as ReviewMeta;
    console.log(`[churro-coder] review read success sub=${subChatId} bytes=${Buffer.byteLength(content, 'utf8')}`);
    return { content, meta };
  } catch (err) {
    const code = typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : 'ERR';
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[churro-coder] review read miss sub=${subChatId} code=${code} message=${message}`);
    return null;
  }
}

export async function markApplied(subChatId: string): Promise<void> {
  const dir = getReviewDir(subChatId);
  const metaPath = join(dir, 'current.meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as ReviewMeta;
    meta.appliedAt = new Date().toISOString();
    await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  } catch {
    // No review to apply — silently ignore
  }
}

export async function hasReview(subChatId: string): Promise<boolean> {
  try {
    await access(join(getReviewDir(subChatId), 'current.md'), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Pull the first markdown `# heading` out of a review body, falling back to "Review". */
export function extractReviewTitleFromContent(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || 'Review';
}
