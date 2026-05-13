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

function log(correlationId: string, op: string, ok: boolean, reason?: string): void {
  const suffix = ok ? '' : ` reason="${reason?.split('\n')[0].slice(0, 200)}"`;
  console.log(`[Provider:local] ${correlationId} op=${op} ok=${ok}${suffix}`);
}

export class LocalAdapter implements ProviderAdapter {
  readonly id = 'local' as const;

  async detectCli(correlationId: string): Promise<DetectResult> {
    const result = await runCli('git', ['--version'], { timeoutMs: 5_000 });
    if (result.code === 0) {
      const version = result.stdout.split('\n')[0]?.match(/git version ([^\s]+)/)?.[1] ?? 'unknown';
      log(correlationId, 'detectCli', true);
      return { available: true, version };
    }
    log(correlationId, 'detectCli', false, result.code === 127 ? 'git not found' : result.stderr);
    return { available: false };
  }

  async checkAuth(_correlationId: string): Promise<AuthResult> {
    return { ok: true };
  }

  async listAccounts(_correlationId: string): Promise<Account[]> {
    return [{ id: 'local', label: 'Local' }];
  }

  async listProjects(_accountId: string, _correlationId: string): Promise<AzureProject[] | null> {
    return null;
  }

  async createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
    const { correlationId } = input;
    // Local repos are initialized in the clone step via `git init`; no remote repo to create.
    log(correlationId, 'createRepo', true);
    return { ok: true, cloneUrl: '' };
  }

  getCloneUrl(_accountId: string, _repoName: string): string | null {
    return null;
  }
}
