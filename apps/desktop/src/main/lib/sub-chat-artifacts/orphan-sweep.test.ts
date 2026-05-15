/**
 * Task 10.8 — orphan .tmp sweep at app boot.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

let fakeUserData = '';

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? fakeUserData : '/tmp')
  }
}));

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  fakeUserData = await mkdtemp(join(tmpdir(), `sweep-test-${randomUUID()}`));
});

afterEach(async () => {
  await rm(fakeUserData, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('sweepOrphanTmpFiles', () => {
  test('removes .tmp orphans under plans/ and reviews/', async () => {
    const { sweepOrphanTmpFiles } = await import('./orphan-sweep');

    const plansDir = join(fakeUserData, 'sub-chats', 'sc-1', 'plans');
    const reviewsDir = join(fakeUserData, 'sub-chats', 'sc-1', 'reviews');
    await mkdir(plansDir, { recursive: true });
    await mkdir(reviewsDir, { recursive: true });

    const orphanPlan = join(plansDir, `${randomUUID()}.tmp`);
    const orphanReview = join(reviewsDir, `${randomUUID()}.tmp`);
    const legit = join(plansDir, 'current.md');

    await writeFile(orphanPlan, 'orphan', 'utf8');
    await writeFile(orphanReview, 'orphan', 'utf8');
    await writeFile(legit, '# Plan', 'utf8');

    await sweepOrphanTmpFiles();

    expect(await exists(orphanPlan)).toBe(false);
    expect(await exists(orphanReview)).toBe(false);
    expect(await exists(legit)).toBe(true);
  });

  test('logs [artifact-sweep] removed orphan for each removed file', async () => {
    const { sweepOrphanTmpFiles } = await import('./orphan-sweep');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const plansDir = join(fakeUserData, 'sub-chats', 'sc-log', 'plans');
    await mkdir(plansDir, { recursive: true });
    const orphan = join(plansDir, `${randomUUID()}.tmp`);
    await writeFile(orphan, 'x', 'utf8');

    await sweepOrphanTmpFiles();

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();
    expect(lines.some((l) => l.includes('[artifact-sweep] removed orphan') && l.includes('.tmp'))).toBe(true);
  });

  test('no-ops when sub-chats directory does not exist', async () => {
    const { sweepOrphanTmpFiles } = await import('./orphan-sweep');
    await expect(sweepOrphanTmpFiles()).resolves.toBeUndefined();
  });

  test('sweeps multiple sub-chats', async () => {
    const { sweepOrphanTmpFiles } = await import('./orphan-sweep');

    const ids = ['sc-a', 'sc-b'];
    const orphans: string[] = [];
    for (const id of ids) {
      const dir = join(fakeUserData, 'sub-chats', id, 'plans');
      await mkdir(dir, { recursive: true });
      const p = join(dir, `${randomUUID()}.tmp`);
      await writeFile(p, 'x', 'utf8');
      orphans.push(p);
    }

    await sweepOrphanTmpFiles();

    for (const p of orphans) {
      expect(await exists(p)).toBe(false);
    }
  });
});
