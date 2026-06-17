import { describe, expect, it } from 'vitest';
import { selectRemotelyDeletedBranches, type BranchTrack } from './orphan-branch-filter';

const NONE = new Set<string>();

describe('selectRemotelyDeletedBranches', () => {
  it('includes a branch whose upstream is [gone] (remote branch was deleted)', () => {
    const branches: BranchTrack[] = [{ branch: 'merged-pr', track: '[gone]' }];
    expect(selectRemotelyDeletedBranches({ branches, protectedBranches: NONE })).toEqual(['merged-pr']);
  });

  it('keeps a never-pushed branch (no upstream, never [gone])', () => {
    const branches: BranchTrack[] = [{ branch: 'local-only', track: '' }];
    expect(selectRemotelyDeletedBranches({ branches, protectedBranches: NONE })).toEqual([]);
  });

  it('keeps a branch that tracks a live upstream', () => {
    const branches: BranchTrack[] = [{ branch: 'feature', track: '[ahead 1]' }];
    expect(selectRemotelyDeletedBranches({ branches, protectedBranches: NONE })).toEqual([]);
  });

  it('never deletes a protected branch even when its upstream is gone', () => {
    const branches: BranchTrack[] = [{ branch: 'main', track: '[gone]' }];
    expect(selectRemotelyDeletedBranches({ branches, protectedBranches: new Set(['main']) })).toEqual([]);
  });

  it('selects only the [gone] branches from a mixed set', () => {
    const branches: BranchTrack[] = [
      { branch: 'main', track: '' },
      { branch: 'merged-pr', track: '[gone]' },
      { branch: 'active-ws', track: '[gone]' },
      { branch: 'never-pushed', track: '' },
      { branch: 'tracking', track: '[ahead 1]' }
    ];
    const result = selectRemotelyDeletedBranches({
      branches,
      protectedBranches: new Set(['main', 'active-ws'])
    });
    expect(result).toEqual(['merged-pr']);
  });
});
