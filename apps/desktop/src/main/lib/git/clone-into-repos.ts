import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

export interface CloneIntoReposInput {
  /** GitHub owner, Azure org, or any remote owner segment */
  owner: string;
  /** Repository name */
  repo: string;
  /** Azure DevOps project name (used to build the path segment) */
  project?: string;
  /** Full clone URL (https or ssh) */
  cloneUrl: string;
  /** Hint used only for legacy-path resolution ('github' triggers ~/.21st fallback) */
  providerHint?: 'github' | 'azure' | 'local';
}

export interface CloneIntoReposResult {
  clonePath: string;
  /** true if the directory already existed (no clone performed) */
  alreadyExisted: boolean;
}

/**
 * Filesystem-only clone helper. Creates the target directory and runs `git clone`.
 * Does NOT touch the database; callers handle their own DB inserts.
 *
 * Layout:
 *   ~/.churrostack/repos/<owner>/<repo>           (GitHub / generic)
 *   ~/.churrostack/repos/<owner>/<project>/<repo> (Azure DevOps)
 *
 * Legacy fallback for GitHub: if ~/.21st/repos/<owner>/<repo> exists and the
 * new path does not, the old clone is reused to avoid duplication.
 */
export async function cloneIntoRepos(input: CloneIntoReposInput): Promise<CloneIntoReposResult> {
  const { owner, repo, project, cloneUrl, providerHint } = input;
  const homePath = app.getPath('home');

  let reposDir: string;
  let newClonePath: string;

  if (providerHint === 'azure' && project) {
    reposDir = join(homePath, '.churrostack', 'repos', owner, project);
    newClonePath = join(reposDir, repo);
  } else {
    reposDir = join(homePath, '.churrostack', 'repos', owner);
    newClonePath = join(reposDir, repo);
  }

  // Legacy fallback: reuse ~/.21st path for GitHub repos to avoid duplicate clones
  let clonePath = newClonePath;
  if (providerHint === 'github' || !providerHint) {
    const legacyClonePath = join(homePath, '.21st', 'repos', owner, repo);
    if (!existsSync(newClonePath) && existsSync(legacyClonePath)) {
      clonePath = legacyClonePath;
    }
  }

  if (existsSync(clonePath)) {
    return { clonePath, alreadyExisted: true };
  }

  await mkdir(reposDir, { recursive: true });
  // execFile (argv array) — no shell, so cloneUrl/clonePath cannot expand
  // shell metacharacters even if the input contains $(...) or backticks.
  await execFileAsync('git', ['clone', cloneUrl, clonePath]);

  return { clonePath, alreadyExisted: false };
}

// Re-export the pure parsers from shared/ so existing callers and tests don't
// need to update their imports. New code should prefer the shared module.
export { parseGitHubRef, parseAzureDevOpsRef } from '../../../shared/git-url-parsers';
