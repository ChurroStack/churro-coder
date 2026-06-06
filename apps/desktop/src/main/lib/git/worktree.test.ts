import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktree, createWorktreeForChat } from './worktree';

const execFileAsync = promisify(execFile);

const git = (cwd: string, ...args: string[]) =>
  execFileAsync('git', ['-C', cwd, '-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args]);

describe('createWorktreeForChat', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'churro-worktree-test-'));
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
    await rm(`${repoPath}-wt`, { recursive: true, force: true });
  });

  it('falls back to the project directory for a repo with no commits (unborn HEAD)', async () => {
    // `git init` with no commit → unborn HEAD. `git worktree add ... main`
    // would fail with "ambiguous argument 'main'"; the function must instead
    // degrade to using the project directory directly (no throw).
    await execFileAsync('git', ['-C', repoPath, 'init']);

    const result = await createWorktreeForChat(repoPath, 'slug', 'chat-1');

    expect(result.success).toBe(true);
    expect(result.worktreePath).toBe(repoPath);
  });

  it('falls back to the project directory when the path is not a git repo', async () => {
    const result = await createWorktreeForChat(repoPath, 'slug', 'chat-1');

    expect(result.success).toBe(true);
    expect(result.worktreePath).toBe(repoPath);
  });

  it('createWorktree falls back to HEAD when the requested base ref does not exist', async () => {
    // Repo has a commit on 'master'; a worktree is requested off 'main', which
    // does not exist here. Without the HEAD fallback this throws "ambiguous
    // argument 'main'". It must instead create the worktree off the current HEAD.
    await execFileAsync('git', ['-C', repoPath, 'init', '-b', 'master']);
    await git(repoPath, 'commit', '--allow-empty', '-m', 'init');
    const headSha = (await git(repoPath, 'rev-parse', 'HEAD')).stdout.trim();

    const worktreePath = `${repoPath}-wt`;
    await expect(createWorktree(repoPath, 'feat-branch', worktreePath, 'main')).resolves.toBeUndefined();

    const wtSha = (await git(worktreePath, 'rev-parse', 'HEAD')).stdout.trim();
    expect(wtSha).toBe(headSha);

    await git(repoPath, 'worktree', 'remove', '--force', worktreePath).catch(() => {});
  });
});
