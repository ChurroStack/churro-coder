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
  console.log(`[Provider:azure] ${correlationId} op=${op} ok=${ok}${suffix}`);
}

export class AzureDevOpsAdapter implements ProviderAdapter {
  readonly id = 'azure' as const;

  async detectCli(correlationId: string): Promise<DetectResult> {
    const cached = getCachedDetect('azure');
    if (cached) return cached;

    const azResult = await runCli('az', ['--version'], { timeoutMs: 5_000 });
    if (azResult.code !== 0) {
      const detect: DetectResult = { available: false };
      setCachedDetect('azure', detect);
      log(correlationId, 'detectCli', false, azResult.code === 127 ? 'az not found' : azResult.stderr);
      return detect;
    }

    const version = azResult.stdout.split('\n')[0]?.match(/azure-cli\s+([^\s]+)/)?.[1] ?? 'unknown';

    const extResult = await runCli('az', ['extension', 'list', '--output', 'json'], { timeoutMs: 10_000 });
    if (extResult.code === 0) {
      try {
        const exts = JSON.parse(extResult.stdout) as Array<{ name: string }>;
        const hasExt = exts.some((e) => e.name === 'azure-devops');
        if (hasExt) {
          const detect: DetectResult = { available: true, version };
          setCachedDetect('azure', detect);
          log(correlationId, 'detectCli', true);
          return detect;
        }
      } catch {
        // fall through
      }
    }

    const detect: DetectResult = { available: false, missingExtension: 'azure-devops' };
    setCachedDetect('azure', detect);
    log(correlationId, 'detectCli', false, 'azure-devops extension not installed');
    return detect;
  }

  async checkAuth(correlationId: string): Promise<AuthResult> {
    const cached = getCachedAuth('azure');
    if (cached) return cached;

    const result = await runCli('az', ['account', 'show', '--output', 'json']);
    let auth: AuthResult;
    if (result.code === 0) {
      auth = { ok: true };
      log(correlationId, 'checkAuth', true);
    } else {
      auth = { ok: false, code: 'not-authenticated', message: result.stderr.split('\n')[0] ?? 'Not authenticated' };
      log(correlationId, 'checkAuth', false, auth.message);
    }
    setCachedAuth('azure', auth);
    return auth;
  }

  async listAccounts(correlationId: string): Promise<Account[]> {
    // Read org list from az devops configure --list — not persisted, React Query is the only cache
    const result = await runCli('az', ['devops', 'configure', '--list', '--output', 'json']);
    if (result.code !== 0) {
      log(correlationId, 'listAccounts', false, result.stderr);
      return [];
    }

    try {
      const config = JSON.parse(result.stdout) as Record<string, string>;
      const orgUrl = config['organization'];
      if (orgUrl) {
        const orgName = orgUrl.replace(/\/$/, '').split('/').pop() ?? orgUrl;
        log(correlationId, 'listAccounts', true);
        return [{ id: orgUrl, label: orgName }];
      }
    } catch {
      // fall through
    }

    log(correlationId, 'listAccounts', false, 'no organization configured');
    return [];
  }

  async listProjects(accountId: string, correlationId: string): Promise<AzureProject[]> {
    const orgUrl = accountId.startsWith('https://') ? accountId : `https://dev.azure.com/${accountId}`;
    const result = await runCli('az', ['devops', 'project', 'list', '--organization', orgUrl, '--output', 'json']);
    if (result.code !== 0) {
      log(correlationId, 'listProjects', false, result.stderr);
      return [];
    }

    try {
      const parsed = JSON.parse(result.stdout) as { value?: Array<{ id: string; name: string }> };
      const projects = (parsed.value ?? []).map((p) => ({ id: p.id, name: p.name }));
      log(correlationId, 'listProjects', true);
      return projects;
    } catch {
      log(correlationId, 'listProjects', false, 'parse error');
      return [];
    }
  }

  async createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
    const { name, accountId, projectId, correlationId } = input;
    const orgUrl = accountId.startsWith('https://') ? accountId : `https://dev.azure.com/${accountId}`;

    if (!projectId) {
      return { ok: false, code: 'unknown', message: 'Azure DevOps requires a project to create a repository' };
    }

    const args = [
      'repos',
      'create',
      '--name',
      name,
      '--organization',
      orgUrl,
      '--project',
      projectId,
      '--output',
      'json'
    ];

    log(correlationId, 'createRepo', true);
    const result = await runCli('az', args);
    if (result.code === 0) {
      try {
        const repo = JSON.parse(result.stdout) as { remoteUrl?: string; webUrl?: string };
        log(correlationId, 'createRepo', true);
        return {
          ok: true,
          cloneUrl: repo.remoteUrl ?? this.getCloneUrl(accountId, name, projectId) ?? '',
          htmlUrl: repo.webUrl
        };
      } catch {
        log(correlationId, 'createRepo', true);
        return { ok: true, cloneUrl: this.getCloneUrl(accountId, name, projectId) ?? '' };
      }
    }

    const stderr = result.stderr.split('\n')[0] ?? '';
    log(correlationId, 'createRepo', false, stderr);

    if (stderr.toLowerCase().includes('already exists') || result.code === 409) {
      return { ok: false, code: 'name-conflict', message: `Repository ${name} already exists in project ${projectId}` };
    }
    if (result.code === 403 || stderr.toLowerCase().includes('permission')) {
      return { ok: false, code: 'permission-denied', message: stderr };
    }
    return { ok: false, code: 'unknown', message: stderr };
  }

  getCloneUrl(accountId: string, repoName: string, projectId?: string): string | null {
    if (!projectId) return null;
    const orgUrl = accountId.startsWith('https://')
      ? accountId.replace(/\/$/, '')
      : `https://dev.azure.com/${accountId}`;
    return `${orgUrl}/${projectId}/_git/${repoName}`;
  }
}
