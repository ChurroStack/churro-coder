import { describe, it, expect } from 'vitest';
import { createEmptyGitChangesStatus, resolveHasUpstream, type GitChangesStatus } from './changes-types';

describe('createEmptyGitChangesStatus', () => {
  it('produces a placeholder with the empty-branch sentinel and the given defaultBranch', () => {
    const s = createEmptyGitChangesStatus('develop');
    expect(s.branch).toBe('');
    expect(s.defaultBranch).toBe('develop');
    expect(s.staged).toEqual([]);
    expect(s.unstaged).toEqual([]);
    expect(s.untracked).toEqual([]);
    expect(s.againstBase).toEqual([]);
    expect(s.commits).toEqual([]);
    expect(s.hasUpstream).toBe(false);
    expect(s.hasRemote).toBe(false);
  });
});

describe('resolveHasUpstream', () => {
  const realStatus = (hasUpstream: boolean): GitChangesStatus => ({
    branch: 'feature/x',
    defaultBranch: 'main',
    againstBase: [],
    commits: [],
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
    pushCount: 0,
    pullCount: 0,
    hasUpstream,
    hasRemote: true
  });

  it('uses the real value for a registered status (true and false both honored)', () => {
    expect(resolveHasUpstream(realStatus(true), false)).toBe(true);
    // The key case the regression broke: a real "no upstream" worktree returns false,
    // it must NOT fall back to the (possibly true) PR-based signal.
    expect(resolveHasUpstream(realStatus(false), true)).toBe(false);
  });

  it('falls back when the status is still loading (undefined/null)', () => {
    expect(resolveHasUpstream(undefined, true)).toBe(true);
    expect(resolveHasUpstream(null, true)).toBe(true);
    expect(resolveHasUpstream(undefined, false)).toBe(false);
  });

  it('falls back for the unregistered placeholder rather than trusting its defined false', () => {
    // Regression guard: the placeholder has hasUpstream:false but branch:''. A naive
    // `status?.hasUpstream ?? fallback` would return false here and suppress the fallback.
    const placeholder = createEmptyGitChangesStatus('main');
    expect(placeholder.hasUpstream).toBe(false);
    expect(resolveHasUpstream(placeholder, true)).toBe(true);
    expect(resolveHasUpstream(placeholder, false)).toBe(false);
  });
});
