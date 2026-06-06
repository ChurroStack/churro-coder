import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktreeForChat } from './worktree';

const execFileAsync = promisify(execFile);

describe('createWorktreeForChat', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'churro-worktree-test-'));
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
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
});
