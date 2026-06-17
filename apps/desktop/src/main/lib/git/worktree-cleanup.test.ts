import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Chainable drizzle stub: every chat lookup misses (no worktreePath row), so
// every scanned dir is an "orphan" candidate and only the self-cwd guard can
// spare it.
vi.mock('../db', () => ({
  chats: { worktreePath: 'worktree_path', id: 'id' },
  getDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) })
  })
}));

vi.mock('./worktree', () => ({ isPathInsideWorktreeRoot: () => true }));

const root = join(homedir(), '.churrostack', 'worktrees');
const liveWt = join(root, 'proj', 'livewt');
const orphanWt = join(root, 'proj', 'orphanwt');

const rm = vi.fn(async (..._args: unknown[]) => {});
vi.mock('node:fs/promises', () => ({
  // withFileTypes form (listSubdirs) vs plain form (empty-slug check).
  readdir: vi.fn(async (dir: string, opts?: { withFileTypes?: boolean }) => {
    const d = resolve(dir);
    const dirent = (name: string) => ({ name, isDirectory: () => true });
    if (opts?.withFileTypes) {
      if (d === resolve(root)) return [dirent('proj')];
      if (d === resolve(join(root, 'proj'))) return [dirent('livewt'), dirent('orphanwt')];
      return [];
    }
    // Plain readdir on the slug dir → still has the live worktree, so non-empty.
    return ['livewt'];
  }),
  stat: vi.fn(async () => ({ mtimeMs: Date.now() - 10 * 60_000 })), // old enough
  rm: (...args: unknown[]) => rm(...args)
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('scanWorktreeOrphans — self-worktree protection', () => {
  it('never removes the worktree the app is running from, but reaps siblings', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(liveWt);
    const { scanWorktreeOrphans } = await import('./worktree-cleanup');

    await scanWorktreeOrphans();

    const removed = rm.mock.calls.map((c) => resolve(String(c[0])));
    expect(removed).not.toContain(resolve(liveWt));
    expect(removed.some((p) => p === resolve(liveWt) || resolve(liveWt).startsWith(p + sep))).toBe(false);
    // The genuine orphan sibling is still reaped.
    expect(removed).toContain(resolve(orphanWt));
  });
});
