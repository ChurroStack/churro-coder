import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

import {
  ensureReviewWritten,
  extractReviewTitleFromContent,
  hasReview,
  markAccepted,
  readCurrentReview,
  writeNativeReviewIfCurrent,
  writeCurrentReview
} from './review-store';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'review-store-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('review-store', () => {
  test('round-trip: write then read returns content + meta', async () => {
    await writeCurrentReview({
      subChatId: 'sub-1',
      content: '# My Review\n\nLooks fine',
      source: 'claude-sdk',
      title: 'My Review'
    });

    const result = await readCurrentReview('sub-1');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('# My Review\n\nLooks fine');
    expect(result!.meta.source).toBe('claude-sdk');
    expect(result!.meta.title).toBe('My Review');
    expect(typeof result!.meta.createdAt).toBe('string');
    expect(result!.meta.acceptedAt).toBeUndefined();
  });

  test('readCurrentReview returns null when no review exists', async () => {
    expect(await readCurrentReview('does-not-exist')).toBeNull();
  });

  test('hasReview reflects existence', async () => {
    expect(await hasReview('sub-2')).toBe(false);
    await writeCurrentReview({ subChatId: 'sub-2', content: 'x', source: 's', title: 't' });
    expect(await hasReview('sub-2')).toBe(true);
  });

  test('markAccepted sets acceptedAt without touching content', async () => {
    await writeCurrentReview({ subChatId: 'sub-3', content: 'body', source: 's', title: 't' });
    await markAccepted('sub-3');

    const result = await readCurrentReview('sub-3');
    expect(result!.content).toBe('body');
    expect(result!.meta.acceptedAt).toBeDefined();
    expect(typeof result!.meta.acceptedAt).toBe('string');
  });

  test('markAccepted silently no-ops when no review exists', async () => {
    await expect(markAccepted('no-review')).resolves.toBeUndefined();
  });

  test('writing twice overwrites the previous review (latest-only semantics)', async () => {
    await writeCurrentReview({ subChatId: 'sub-4', content: 'first', source: 's1', title: 't1' });
    await writeCurrentReview({ subChatId: 'sub-4', content: 'second', source: 's2', title: 't2' });

    const result = await readCurrentReview('sub-4');
    expect(result!.content).toBe('second');
    expect(result!.meta.source).toBe('s2');
    expect(result!.meta.title).toBe('t2');
  });

  test('readCurrentReview returns null when meta file is corrupted', async () => {
    await writeCurrentReview({ subChatId: 'sub-5', content: 'body', source: 's', title: 't' });
    const metaPath = join(tmpRoot, 'sub-chats', 'sub-5', 'reviews', 'current.meta.json');
    await writeFile(metaPath, '{ not json', 'utf8');

    expect(await readCurrentReview('sub-5')).toBeNull();
  });

  test('isolates reviews per sub-chat', async () => {
    await writeCurrentReview({ subChatId: 'a', content: 'A', source: 's', title: 't' });
    await writeCurrentReview({ subChatId: 'b', content: 'B', source: 's', title: 't' });

    expect((await readCurrentReview('a'))!.content).toBe('A');
    expect((await readCurrentReview('b'))!.content).toBe('B');
  });

  test('atomic-rename: no temp files leak after a successful write', async () => {
    await writeCurrentReview({ subChatId: 'sub-6', content: 'body', source: 's', title: 't' });
    const reviewDir = join(tmpRoot, 'sub-chats', 'sub-6', 'reviews');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(reviewDir);
    expect(files.sort()).toEqual(['current.md', 'current.meta.json']);
    const meta = JSON.parse(await readFile(join(reviewDir, 'current.meta.json'), 'utf8'));
    expect(meta.title).toBe('t');
  });
});

describe('ensureReviewWritten (fill-gaps, CLI-ingest recovery)', () => {
  test('writes when no review exists yet', async () => {
    const res = await ensureReviewWritten({
      subChatId: 'fg-1',
      content: '# Code Review\n\nfindings here',
      source: 'cli-ingest',
      title: 'Code Review'
    });
    expect(res.written).toBe(true);
    const result = await readCurrentReview('fg-1');
    expect(result!.content).toBe('# Code Review\n\nfindings here');
    expect(result!.meta.source).toBe('cli-ingest');
  });

  test('no-ops when a review already exists (explicit write_review always wins)', async () => {
    await writeCurrentReview({ subChatId: 'fg-2', content: 'explicit review', source: 'mcp', title: 'Review' });
    const res = await ensureReviewWritten({
      subChatId: 'fg-2',
      content: 'auto-captured from CLI-ingest',
      source: 'cli-ingest',
      title: 'Code Review'
    });
    expect(res.written).toBe(false);
    const result = await readCurrentReview('fg-2');
    expect(result!.content).toBe('explicit review');
    expect(result!.meta.source).toBe('mcp');
  });
});

describe('writeNativeReviewIfCurrent', () => {
  test('replaces an older completed native review and ignores a replay', async () => {
    await writeNativeReviewIfCurrent({
      subChatId: 'native-1',
      content: '# Code Review\n\nfirst',
      source: 'cli-ingest',
      title: 'Code Review',
      eventId: 'review-1',
      completedAt: '2026-01-01T00:00:00.000Z',
      usedFallback: false
    });

    const newer = await writeNativeReviewIfCurrent({
      subChatId: 'native-1',
      content: '# Code Review\n\nsecond',
      source: 'cli-ingest',
      title: 'Code Review',
      eventId: 'review-2',
      completedAt: '2026-01-02T00:00:00.000Z',
      usedFallback: false
    });
    const replay = await writeNativeReviewIfCurrent({
      subChatId: 'native-1',
      content: '# Code Review\n\nsecond',
      source: 'cli-ingest',
      title: 'Code Review',
      eventId: 'review-2',
      completedAt: '2026-01-02T00:00:00.000Z',
      usedFallback: false
    });

    expect(newer).toEqual({ written: true, reason: 'written' });
    expect(replay).toEqual({ written: false, reason: 'replay' });
    expect((await readCurrentReview('native-1'))?.content).toContain('second');
  });

  test('does not replace a newer explicit MCP review during replay', async () => {
    await writeCurrentReview({ subChatId: 'native-2', content: '# Explicit', source: 'mcp', title: 'Explicit' });

    const result = await writeNativeReviewIfCurrent({
      subChatId: 'native-2',
      content: '# Code Review\n\nold native result',
      source: 'cli-ingest',
      title: 'Code Review',
      eventId: 'review-old',
      completedAt: '2020-01-01T00:00:00.000Z',
      usedFallback: true
    });

    expect(result).toEqual({ written: false, reason: 'newer-explicit' });
    expect((await readCurrentReview('native-2'))?.content).toBe('# Explicit');
  });
});

describe('extractReviewTitleFromContent', () => {
  test('returns the first markdown heading', () => {
    expect(extractReviewTitleFromContent('# Hello\n\nbody')).toBe('Hello');
  });

  test('falls back to "Review" when no heading exists', () => {
    expect(extractReviewTitleFromContent('no heading here')).toBe('Review');
  });

  test('finds heading even when not at the top', () => {
    expect(extractReviewTitleFromContent('preamble\n# Real Title\nrest')).toBe('Real Title');
  });
});
