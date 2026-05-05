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

import { hasPlan, markApproved, readCurrentPlan, writeCurrentPlan } from './plan-store';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'plan-store-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('plan-store', () => {
  test('round-trip: write then read returns content + meta', async () => {
    await writeCurrentPlan({
      subChatId: 'sub-1',
      content: '# My Plan\n\nbody',
      source: 'claude:ExitPlanMode',
      title: 'My Plan'
    });

    const result = await readCurrentPlan('sub-1');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('# My Plan\n\nbody');
    expect(result!.meta.source).toBe('claude:ExitPlanMode');
    expect(result!.meta.title).toBe('My Plan');
    expect(typeof result!.meta.createdAt).toBe('string');
    expect(result!.meta.approvedAt).toBeUndefined();
  });

  test('readCurrentPlan returns null when no plan exists', async () => {
    expect(await readCurrentPlan('does-not-exist')).toBeNull();
  });

  test('hasPlan reflects existence', async () => {
    expect(await hasPlan('sub-2')).toBe(false);
    await writeCurrentPlan({ subChatId: 'sub-2', content: 'x', source: 's', title: 't' });
    expect(await hasPlan('sub-2')).toBe(true);
  });

  test('markApproved sets approvedAt without touching content', async () => {
    await writeCurrentPlan({ subChatId: 'sub-3', content: 'body', source: 's', title: 't' });
    await markApproved('sub-3');

    const result = await readCurrentPlan('sub-3');
    expect(result!.content).toBe('body');
    expect(result!.meta.approvedAt).toBeDefined();
    expect(typeof result!.meta.approvedAt).toBe('string');
  });

  test('markApproved silently no-ops when no plan exists', async () => {
    await expect(markApproved('no-plan')).resolves.toBeUndefined();
  });

  test('writing twice overwrites the previous plan (latest-only semantics)', async () => {
    await writeCurrentPlan({ subChatId: 'sub-4', content: 'first', source: 's1', title: 't1' });
    await writeCurrentPlan({ subChatId: 'sub-4', content: 'second', source: 's2', title: 't2' });

    const result = await readCurrentPlan('sub-4');
    expect(result!.content).toBe('second');
    expect(result!.meta.source).toBe('s2');
    expect(result!.meta.title).toBe('t2');
  });

  test('readCurrentPlan returns null when meta file is corrupted', async () => {
    await writeCurrentPlan({ subChatId: 'sub-5', content: 'body', source: 's', title: 't' });
    const metaPath = join(tmpRoot, 'sub-chats', 'sub-5', 'plans', 'current.meta.json');
    await writeFile(metaPath, '{ not json', 'utf8');

    expect(await readCurrentPlan('sub-5')).toBeNull();
  });

  test('isolates plans per sub-chat', async () => {
    await writeCurrentPlan({ subChatId: 'a', content: 'A', source: 's', title: 't' });
    await writeCurrentPlan({ subChatId: 'b', content: 'B', source: 's', title: 't' });

    expect((await readCurrentPlan('a'))!.content).toBe('A');
    expect((await readCurrentPlan('b'))!.content).toBe('B');
  });

  test('atomic-rename: no temp files leak after a successful write', async () => {
    await writeCurrentPlan({ subChatId: 'sub-6', content: 'body', source: 's', title: 't' });
    const planDir = join(tmpRoot, 'sub-chats', 'sub-6', 'plans');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(planDir);
    expect(files.sort()).toEqual(['current.md', 'current.meta.json']);
    // Sanity: meta file is valid JSON
    const meta = JSON.parse(await readFile(join(planDir, 'current.meta.json'), 'utf8'));
    expect(meta.title).toBe('t');
  });
});
