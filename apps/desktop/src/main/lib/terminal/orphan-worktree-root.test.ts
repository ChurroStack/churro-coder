import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ownWorktreeRoot } from './orphan-process-cleanup';

const roots = [join(homedir(), '.churrostack', 'worktrees'), join(homedir(), '.21st', 'worktrees')].map(
  (r) => resolve(r) + sep
);
// Generic sample worktree (<root>/<slug>/<folder>) — the name is irrelevant; the
// helper derives it from whatever path it's given, never a fixed string.
const wt = join(homedir(), '.churrostack', 'worktrees', 'some-project', 'some-worktree');

describe('ownWorktreeRoot', () => {
  it('resolves the worktree subtree from a cwd inside a subdir (apps/desktop)', () => {
    // The exact dev case: electron main cwd is the apps/desktop subdir, but the
    // sibling nx/bun processes live at the worktree root — both must resolve to
    // the same protected worktree directory.
    expect(ownWorktreeRoot(join(wt, 'apps', 'desktop'), roots)).toBe(wt);
    expect(ownWorktreeRoot(wt, roots)).toBe(wt);
  });

  it('returns null when cwd is not under a worktree root (production)', () => {
    expect(ownWorktreeRoot('/Applications/Churro Coder.app/Contents', roots)).toBeNull();
    expect(ownWorktreeRoot(join(homedir(), 'Projects', 'anything'), roots)).toBeNull();
  });

  it('returns null when cwd is too shallow to be a worktree (root/slug only)', () => {
    expect(ownWorktreeRoot(join(homedir(), '.churrostack', 'worktrees', 'some-project'), roots)).toBeNull();
  });

  it('protects sibling processes: the resolved root matches the worktree-root cwd', () => {
    const root = ownWorktreeRoot(join(wt, 'apps', 'desktop'), roots)!;
    const siblingCwd = resolve(wt); // a process whose cwd is the worktree root
    // Mirror isReferenced(): at-or-under the protected root.
    expect(siblingCwd === root || siblingCwd.startsWith(root + sep)).toBe(true);
  });
});
