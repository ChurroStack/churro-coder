import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

const execAsync = promisify(exec);

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
  await execAsync(`git clone "${cloneUrl}" "${clonePath}"`);

  return { clonePath, alreadyExisted: false };
}

/**
 * Parse a GitHub repo reference into owner/repo parts.
 * Accepts HTTPS URL, SSH URL, or short `owner/repo` format.
 * Returns null if the input does not match any known format.
 */
export function parseGitHubRef(input: string): { owner: string; repo: string } | null {
  const https = input.match(/https?:\/\/github\.com\/([^/]+)\/([^/\s]+)/);
  if (https) return { owner: https[1]!, repo: https[2]!.replace(/\.git$/, '') };

  const ssh = input.match(/git@github\.com:([^/]+)\/(.+)/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]!.replace(/\.git$/, '') };

  const short = input.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) return { owner: short[1]!, repo: short[2]!.replace(/\.git$/, '') };

  return null;
}

/**
 * Parse an Azure DevOps clone URL into org/project/repo parts.
 * Accepts: https://dev.azure.com/<org>/<project>/_git/<repo>
 * Returns null if not a recognised Azure DevOps URL.
 */
export function parseAzureDevOpsRef(input: string): { org: string; project: string; repo: string } | null {
  const m = input.match(/https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/);
  if (!m) return null;
  return { org: m[1]!, project: m[2]!, repo: m[3]!.replace(/\.git$/, '') };
}
