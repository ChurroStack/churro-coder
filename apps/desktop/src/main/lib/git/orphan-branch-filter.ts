/**
 * Pure selection logic for the "Clean orphaned branches" action — kept separate
 * from the tRPC router so it can be unit-tested without pulling in electron/db.
 */

export interface BranchTrack {
  /** Local branch short name (e.g. "clever-fox-a1b2"). */
  branch: string;
  /** Raw value of `%(upstream:track)` for the branch, e.g. "[gone]", "[ahead 1]", "". */
  track: string;
}

/**
 * Decide which local branches had a remote branch that has since been deleted —
 * the classic "merged PR, remote branch removed" case — and are therefore safe
 * to delete locally.
 *
 * Detection is deterministic: after `git fetch --prune`, git reports
 * `%(upstream:track) === "[gone]"` for exactly the branches that have a
 * configured upstream whose remote ref no longer exists. Never-pushed local
 * branches (no upstream) and branches still tracking a live remote are kept.
 *
 * Protected branches (current, default, and every workspace/chat branch) are
 * always excluded so in-progress and archived-but-restorable work is never lost.
 */
export function selectRemotelyDeletedBranches(args: {
  branches: BranchTrack[];
  protectedBranches: Set<string>;
}): string[] {
  const { branches, protectedBranches } = args;
  return branches.filter((b) => !protectedBranches.has(b.branch) && b.track.includes('gone')).map((b) => b.branch);
}
