/**
 * Tests the disk-state guard that prevents re-injection of the initial prompt
 * when a CLI terminal panel is restored and the chat has already progressed
 * (plan, review, or tasks exist on disk).
 *
 * Tests the condition functions in isolation (hasPlan, hasReview, readTasks)
 * rather than the full tRPC router, which pulls in electron/drizzle/sentry.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

import { hasPlan, writeCurrentPlan } from '../../plans/plan-store';
import { hasReview, writeCurrentReview } from '../../reviews/review-store';
import { readTasks } from '../../tasks/task-store';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cli-bootstrap-guard-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Mirrors the guard in chats.ts: any of plan/review/tasks → skip injection. */
async function shouldSkipInjection(subChatId: string): Promise<boolean> {
  const [planExists, reviewExists, tasksData] = await Promise.all([
    hasPlan(subChatId),
    hasReview(subChatId),
    readTasks(subChatId)
  ]);
  return planExists || reviewExists || tasksData !== null;
}

describe('buildCliBootstrap skip-injection guard [cli-bootstrap/guard]', () => {
  test('skips injection when plan exists on disk', async () => {
    await writeCurrentPlan({
      subChatId: 'sub-plan',
      content: '# Plan\n\nDo the thing.',
      source: 'claude-sdk',
      title: 'Plan'
    });
    expect(await shouldSkipInjection('sub-plan')).toBe(true);
  });

  test('skips injection when review exists on disk', async () => {
    await writeCurrentReview({
      subChatId: 'sub-review',
      content: '# Review\n\nLooks good.',
      source: 'claude-sdk',
      title: 'Review'
    });
    expect(await shouldSkipInjection('sub-review')).toBe(true);
  });

  test('skips injection when tasks exist on disk', async () => {
    const dir = join(tmpRoot, 'sub-chats', 'sub-tasks', 'tasks');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'current.json'),
      JSON.stringify({
        tasks: [{ id: '1', title: 'Do it', status: 'pending' }],
        meta: { source: 'claude-sdk', updatedAt: new Date().toISOString() }
      })
    );
    expect(await shouldSkipInjection('sub-tasks')).toBe(true);
  });

  test('does NOT skip injection for a fresh chat with no artifacts', async () => {
    expect(await shouldSkipInjection('sub-fresh')).toBe(false);
  });
});
