/**
 * Task 11.10 — Atomic-write crash recovery.
 *
 * Three sub-cases:
 * (a) crash between .tmp write and rename — simulated by seeding a .tmp orphan;
 *     the orphan sweep removes it, the old body remains intact.
 * (b) crash between body rename and meta rename — simulated by writing the body
 *     file directly while leaving the old meta; reader returns body=new, meta=old.
 * (c) successful write — body and meta both reflect the new revision.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? tmpRoot : '/tmp') }
}));

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), `crash-test-${randomUUID()}`));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  vi.resetModules();
});

describe('11.10 — atomic write crash recovery', () => {
  test('(a) crash before rename: old body intact, .tmp orphan swept at next boot', async () => {
    const { writeCurrentPlan, readCurrentPlan } = await import('../plans/plan-store');
    const { sweepOrphanTmpFiles } = await import('./orphan-sweep');

    const subChatId = 'crash-a';

    // Write initial plan (body + meta)
    await writeCurrentPlan({ subChatId, content: 'Old body', source: 'source-old', title: 'Old' });

    // Simulate crash: an orphaned .tmp file left by a failed write
    const plansDir = join(tmpRoot, 'sub-chats', subChatId, 'plans');
    const orphanPath = join(plansDir, `${randomUUID()}.tmp`);
    await writeFile(orphanPath, 'Partial new body', 'utf8');

    // Old body must still be intact (not overwritten by the crash)
    const plan = await readCurrentPlan(subChatId);
    expect(plan?.content).toBe('Old body');

    // Orphan sweep removes the .tmp file
    await sweepOrphanTmpFiles();
    const entries = (await import('node:fs/promises')).readdir;
    const dirEntries = await entries(plansDir);
    expect(dirEntries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);

    // Body is still intact after sweep
    expect(await readCurrentPlan(subChatId)).toMatchObject({ content: 'Old body' });
  });

  test('(b) crash between body rename and meta rename: body is new, meta is old', async () => {
    const { writeCurrentPlan, readCurrentPlan } = await import('../plans/plan-store');

    const subChatId = 'crash-b';

    // Write initial plan
    await writeCurrentPlan({ subChatId, content: 'Old body', source: 'source-old', title: 'Old' });

    // Simulate crash: directly overwrite body file but leave meta untouched
    const plansDir = join(tmpRoot, 'sub-chats', subChatId, 'plans');
    const bodyPath = join(plansDir, 'current.md');
    await writeFile(bodyPath, 'New body after partial crash', 'utf8');

    // Reader: body reflects new content, meta reflects old state (stale but parseable)
    const plan = await readCurrentPlan(subChatId);
    expect(plan?.content).toBe('New body after partial crash');
    expect(plan?.meta.source).toBe('source-old');
  });

  test('(c) successful write: body and meta both reflect new revision', async () => {
    const { writeCurrentPlan, readCurrentPlan } = await import('../plans/plan-store');

    const subChatId = 'crash-c';

    await writeCurrentPlan({ subChatId, content: 'Initial', source: 'source-1', title: 'T1' });
    await writeCurrentPlan({ subChatId, content: 'Updated', source: 'source-2', title: 'T2' });

    const plan = await readCurrentPlan(subChatId);
    expect(plan?.content).toBe('Updated');
    expect(plan?.meta.source).toBe('source-2');
    expect(plan?.meta.title).toBe('T2');
  });
});
