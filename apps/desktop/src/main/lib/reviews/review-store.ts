/**
 * File-backed review storage for the churro-coder MCP system.
 *
 * Stores the latest review per sub-chat under:
 *   <userData>/sub-chats/<subChatId>/reviews/current.md
 *   <userData>/sub-chats/<subChatId>/reviews/current.meta.json
 */

import { app } from 'electron';
import { readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import EventEmitter from 'node:events';
import { Mutex } from 'async-mutex';
import { atomicWriteArtifact } from '../sub-chat-artifacts/atomic-write';

const reviewEmitter = new EventEmitter();
reviewEmitter.setMaxListeners(50);

export interface ReviewWrittenEvent {
  subChatId: string;
}

export function onReviewWritten(handler: (event: ReviewWrittenEvent) => void): () => void {
  reviewEmitter.on('written', handler);
  return () => reviewEmitter.off('written', handler);
}

export interface ReviewMeta {
  source: string;
  title: string;
  createdAt: string;
  acceptedAt?: string;
  nativeReview?: {
    eventId: string;
    completedAt: string;
    usedFallback: boolean;
  };
}

export interface ReviewData {
  content: string;
  meta: ReviewMeta;
}

function getReviewDir(subChatId: string): string {
  return join(app.getPath('userData'), 'sub-chats', subChatId, 'reviews');
}

const reviewWriteLocks = new Map<string, Mutex>();

function writeLockFor(subChatId: string): Mutex {
  let lock = reviewWriteLocks.get(subChatId);
  if (!lock) {
    lock = new Mutex();
    reviewWriteLocks.set(subChatId, lock);
  }
  return lock;
}

export async function writeCurrentReview(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
}): Promise<void> {
  await writeLockFor(opts.subChatId).runExclusive(() => writeCurrentReviewUnlocked(opts));
}

async function writeCurrentReviewUnlocked(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
  nativeReview?: ReviewMeta['nativeReview'];
}): Promise<void> {
  const dir = getReviewDir(opts.subChatId);

  const meta: ReviewMeta = {
    source: opts.source,
    title: opts.title,
    createdAt: new Date().toISOString(),
    ...(opts.nativeReview ? { nativeReview: opts.nativeReview } : {})
  };

  await atomicWriteArtifact(join(dir, 'current.md'), opts.content);
  await atomicWriteArtifact(join(dir, 'current.meta.json'), JSON.stringify(meta, null, 2));
  console.log(
    `[churro-coder] review persisted sub=${opts.subChatId} source=${opts.source} bytes=${Buffer.byteLength(opts.content, 'utf8')}`
  );
  reviewEmitter.emit('written', { subChatId: opts.subChatId });
}

export type NativeReviewWriteReason = 'written' | 'replay' | 'stale' | 'newer-explicit';

/**
 * Persist a completed native review only when it is newer than the current
 * artifact. The per-sub-chat lock makes the check-and-write atomic relative to
 * explicit MCP writes, so replay cannot clobber a review saved in the race.
 */
export async function writeNativeReviewIfCurrent(opts: {
  subChatId: string;
  content: string;
  source: 'cli-ingest' | 'builtin-stream';
  title: string;
  eventId: string;
  completedAt: string;
  usedFallback: boolean;
}): Promise<{ written: boolean; reason: NativeReviewWriteReason }> {
  return writeLockFor(opts.subChatId).runExclusive(async () => {
    const current = await readCurrentReview(opts.subChatId);
    if (current?.meta.nativeReview?.eventId === opts.eventId) {
      return traceNativeReviewResult(opts, { written: false, reason: 'replay' });
    }

    const incomingAt = Date.parse(opts.completedAt);
    const currentAt = Date.parse(current?.meta.nativeReview?.completedAt ?? current?.meta.createdAt ?? '');
    const isNewer = Number.isFinite(incomingAt) && (!Number.isFinite(currentAt) || incomingAt > currentAt);

    if (current?.meta.source === 'mcp' && !isNewer) {
      return traceNativeReviewResult(opts, { written: false, reason: 'newer-explicit' });
    }
    if (current && !isNewer) {
      return traceNativeReviewResult(opts, { written: false, reason: 'stale' });
    }

    await writeCurrentReviewUnlocked({
      subChatId: opts.subChatId,
      content: opts.content,
      source: opts.source,
      title: opts.title,
      nativeReview: {
        eventId: opts.eventId,
        completedAt: opts.completedAt,
        usedFallback: opts.usedFallback
      }
    });
    return traceNativeReviewResult(opts, { written: true, reason: 'written' });
  });
}

function traceNativeReviewResult(
  opts: Pick<Parameters<typeof writeNativeReviewIfCurrent>[0], 'subChatId' | 'eventId' | 'usedFallback'>,
  result: { written: boolean; reason: NativeReviewWriteReason }
): { written: boolean; reason: NativeReviewWriteReason } {
  console.log(
    `[review-native] sub=${opts.subChatId} outcome=${result.reason} fallback=${opts.usedFallback} event=${opts.eventId}`
  );
  return result;
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

export async function markAccepted(subChatId: string): Promise<void> {
  const dir = getReviewDir(subChatId);
  const metaPath = join(dir, 'current.meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as ReviewMeta;
    meta.acceptedAt = new Date().toISOString();
    await atomicWriteArtifact(metaPath, JSON.stringify(meta, null, 2));
    console.log(`[churro-coder] review accepted sub=${subChatId} acceptedAt=${meta.acceptedAt}`);
  } catch {
    // No review to accept — silently ignore
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

/**
 * Fill-gaps write: persists a review only if one doesn't already exist for
 * this sub-chat. Used by CLI-ingest recovery (native `/code-review` /
 * `/review` output) and the builtin stream path so an explicit MCP
 * `write_review` call always wins over anything auto-captured.
 */
export async function ensureReviewWritten(opts: {
  subChatId: string;
  content: string;
  source: string;
  title: string;
}): Promise<{ written: boolean }> {
  if (await hasReview(opts.subChatId)) {
    return { written: false };
  }

  await writeCurrentReview(opts);
  return { written: true };
}
