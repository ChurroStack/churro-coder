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
  extractReviewTitleFromContent,
  hasReview,
  markApplied,
  readCurrentReview,
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
    expect(result!.meta.appliedAt).toBeUndefined();
  });

  test('readCurrentReview returns null when no review exists', async () => {
    expect(await readCurrentReview('does-not-exist')).toBeNull();
  });

  test('hasReview reflects existence', async () => {
    expect(await hasReview('sub-2')).toBe(false);
    await writeCurrentReview({ subChatId: 'sub-2', content: 'x', source: 's', title: 't' });
    expect(await hasReview('sub-2')).toBe(true);
  });

  test('markApplied sets appliedAt without touching content', async () => {
    await writeCurrentReview({ subChatId: 'sub-3', content: 'body', source: 's', title: 't' });
    await markApplied('sub-3');

    const result = await readCurrentReview('sub-3');
    expect(result!.content).toBe('body');
    expect(result!.meta.appliedAt).toBeDefined();
    expect(typeof result!.meta.appliedAt).toBe('string');
  });

  test('markApplied silently no-ops when no review exists', async () => {
    await expect(markApplied('no-review')).resolves.toBeUndefined();
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
