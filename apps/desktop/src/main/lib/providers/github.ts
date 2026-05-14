import type {
  ProviderAdapter,
  DetectResult,
  AuthResult,
  Account,
  AzureProject,
  CreateRepoInput,
  CreateRepoResult
} from './types';
import { runCli } from './cli-runner';
import { getCachedDetect, setCachedDetect, getCachedAuth, setCachedAuth } from './detect-cache';

function log(correlationId: string, op: string, ok: boolean, reason?: string): void {
  const suffix = ok ? '' : ` reason="${reason?.split('\n')[0].slice(0, 200)}"`;
  console.log(`[Provider:github] ${correlationId} op=${op} ok=${ok}${suffix}`);
}

export class GitHubAdapter implements ProviderAdapter {
  readonly id = 'github' as const;

  async detectCli(correlationId: string): Promise<DetectResult> {
    const cached = getCachedDetect('github');
    if (cached) return cached;

    const result = await runCli('gh', ['--version'], { timeoutMs: 5_000 });
    let detect: DetectResult;
    if (result.code === 0) {
      const version = result.stdout.split('\n')[0]?.match(/gh version ([^\s]+)/)?.[1] ?? 'unknown';
      detect = { available: true, version };
      log(correlationId, 'detectCli', true);
    } else {
      detect = { available: false };
      log(correlationId, 'detectCli', false, result.code === 127 ? 'not found' : result.stderr);
    }
    setCachedDetect('github', detect);
    return detect;
  }

  async checkAuth(correlationId: string): Promise<AuthResult> {
    const cached = getCachedAuth('github');
    if (cached) return cached;

    const result = await runCli('gh', ['auth', 'status']);
    let auth: AuthResult;
    if (result.code === 0) {
      auth = { ok: true };
      log(correlationId, 'checkAuth', true);
    } else {
      auth = { ok: false, code: 'not-authenticated', message: result.stderr.split('\n')[0] ?? 'Not authenticated' };
      log(correlationId, 'checkAuth', false, auth.message);
    }
    setCachedAuth('github', auth);
    return auth;
  }

  async listAccounts(correlationId: string): Promise<Account[]> {
    const [userResult, orgsResult] = await Promise.all([
      runCli('gh', ['api', 'user', '--jq', '.login']),
      runCli('gh', ['api', 'user/orgs', '--paginate', '--jq', '.[].login'])
    ]);

    const accounts: Account[] = [];

    if (userResult.code === 0 && userResult.stdout.trim()) {
      const login = userResult.stdout.trim();
      accounts.push({ id: login, label: login, badge: 'Personal' });
      log(correlationId, 'listAccounts:user', true);
    } else {
      log(correlationId, 'listAccounts:user', false, userResult.stderr);
    }

    if (orgsResult.code === 0 && orgsResult.stdout.trim()) {
      const orgs = orgsResult.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => l.trim().replace(/^"|"$/g, ''));
      for (const org of orgs) {
        if (org) accounts.push({ id: org, label: org });
      }
      log(correlationId, 'listAccounts:orgs', true);
    }

    return accounts;
  }

  async listProjects(_accountId: string, _correlationId: string): Promise<AzureProject[] | null> {
    return null;
  }

  async createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
    const { name, description, accountId, visibility, correlationId } = input;
    const repoRef = `${accountId}/${name}`;
    const visFlag = visibility === 'public' ? '--public' : '--private';
    const args = ['repo', 'create', repoRef, visFlag];
    if (description) {
      args.push('--description', description);
    }

    log(correlationId, 'createRepo', true); // log intent before call
    const result = await runCli('gh', args);
    if (result.code === 0) {
      log(correlationId, 'createRepo', true);
      return { ok: true, cloneUrl: `https://github.com/${repoRef}.git`, htmlUrl: `https://github.com/${repoRef}` };
    }

    const stderr = result.stderr.split('\n')[0] ?? '';
    log(correlationId, 'createRepo', false, stderr);

    if (stderr.toLowerCase().includes('already exists') || result.code === 422) {
      return { ok: false, code: 'name-conflict', message: `Repository ${repoRef} already exists` };
    }
    if (result.code === 403 || stderr.toLowerCase().includes('permission')) {
      return { ok: false, code: 'permission-denied', message: stderr };
    }
    return { ok: false, code: 'unknown', message: stderr };
  }

  getCloneUrl(accountId: string, repoName: string): string {
    return `https://github.com/${accountId}/${repoName}.git`;
  }
}
