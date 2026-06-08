/**
 * Types for the git changes/diff viewer feature
 */

/** File status from git, matching short format codes */
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';

/** Change categories for organizing the sidebar */
export type ChangeCategory = 'against-base' | 'committed' | 'staged' | 'unstaged';

/** A changed file entry */
export interface ChangedFile {
  path: string; // Relative path from repo root
  oldPath?: string; // Original path for renames/copies
  status: FileStatus;
  additions: number;
  deletions: number;
}

/** A commit summary for the committed changes section */
export interface CommitInfo {
  hash: string;
  shortHash: string; // Short hash (7 chars)
  message: string; // Commit message (first line)
  description?: string; // Commit description (body, optional)
  author: string;
  date: Date;
  files: ChangedFile[];
}

/** Full git changes status for a worktree */
export interface GitChangesStatus {
  branch: string;
  defaultBranch: string; // Default branch (main/master)
  againstBase: ChangedFile[]; // All files changed vs base branch
  commits: CommitInfo[]; // Individual commits on branch (not on default)
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  untracked: ChangedFile[];
  ahead: number; // Commits ahead of default branch
  behind: number; // Commits behind default branch
  // Tracking branch status (for push/pull)
  pushCount: number; // Commits to push to tracking branch
  pullCount: number; // Commits to pull from tracking branch
  hasUpstream: boolean; // Whether branch has an upstream tracking branch
  hasRemote: boolean; // Whether the repo has any remote configured (e.g. origin)
}

/** Diff view mode toggle */
export type DiffViewMode = 'side-by-side' | 'inline';

/** Input for getting file diff */
export interface FileDiffInput {
  worktreePath: string;
  filePath: string;
  category: ChangeCategory;
  commitHash?: string; // For committed category: which commit to show
}

/** File contents for Monaco diff editor */
export interface FileContents {
  original: string; // Original content (before changes)
  modified: string; // Modified content (after changes)
  language: string; // Detected language for syntax highlighting
}

/** Parsed diff file for the diff viewer */
export interface ParsedDiffFile {
  key: string;
  oldPath: string;
  newPath: string;
  diffText: string;
  isBinary: boolean;
  additions: number;
  deletions: number;
  isValid: boolean;
  fileLang: string | null;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

/** Response from getParsedDiff endpoint */
export interface ParsedDiffResponse {
  files: ParsedDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  fileContents: Record<string, string>;
}

/**
 * Placeholder status returned by the main-process `getStatus` query when a worktree path is no
 * longer registered (stale/deleted). `branch: ''` is the sentinel that distinguishes a placeholder
 * from a real result: `parseGitStatus` always sets a genuine status's branch to
 * `status.current || 'HEAD'`, so a real status never has an empty branch. Consumers must treat a
 * placeholder as "git status unknown", not as an authoritative "clean / no upstream" answer —
 * see resolveHasUpstream.
 */
export function createEmptyGitChangesStatus(defaultBranch: string): GitChangesStatus {
  return {
    branch: '',
    defaultBranch,
    againstBase: [],
    commits: [],
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
    pushCount: 0,
    pullCount: 0,
    hasUpstream: false,
    hasRemote: false
  };
}

/**
 * Resolve `hasUpstream` from a getStatus result, falling back to `fallback` when the status is
 * unknown — i.e. still loading (`undefined`) OR the unregistered-worktree placeholder
 * (`createEmptyGitChangesStatus`, identified by `branch === ''`).
 *
 * Using `status?.hasUpstream ?? fallback` directly is wrong: the placeholder supplies a *defined*
 * `false`, which suppresses the fallback. Downstream that drives `usePushAction`'s
 * `setUpstream: !hasUpstream`, so a placeholder would push `-u` onto a branch that may already
 * track an upstream — the exact regression the PR-based fallback guards against. See
 * docs/postmortems/2026-05-status-widget-amber-flash-on-load.md.
 *
 * Accepts the minimal structural shape it reads (not the full `GitChangesStatus`) so it also works
 * with narrowed views of the status object, e.g. `DiffSidebarRenderer`'s `gitStatus` prop. A real
 * status always has a non-empty `branch` (`parseGitStatus` → `status.current || 'HEAD'`), so a
 * falsy/absent branch marks "status unknown" (loading or the placeholder) → fall back.
 */
export function resolveHasUpstream(
  status: { branch?: string | null; hasUpstream?: boolean | null } | undefined | null,
  fallback: boolean
): boolean {
  if (!status || !status.branch) return fallback;
  return status.hasUpstream ?? fallback;
}
