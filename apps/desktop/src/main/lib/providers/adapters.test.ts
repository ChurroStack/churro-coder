import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evict } from './detect-cache';

// Mock cli-runner
vi.mock('./cli-runner', () => ({
  runCli: vi.fn()
}));

import { runCli } from './cli-runner';
const mockRunCli = vi.mocked(runCli);

import { GitHubAdapter } from './github';
import { AzureDevOpsAdapter } from './azure-devops';
import { LocalAdapter } from './local';

beforeEach(() => {
  vi.clearAllMocks();
  evict('github');
  evict('azure');
  evict('local' as 'github');
});

describe('GitHubAdapter', () => {
  const adapter = new GitHubAdapter();
  const cid = 'test';

  it('detectCli returns available with version when gh succeeds', async () => {
    mockRunCli.mockResolvedValue({ stdout: 'gh version 2.40.0 (2024-01-01)\n', stderr: '', code: 0 });
    const result = await adapter.detectCli(cid);
    expect(result).toMatchObject({ available: true, version: '2.40.0' });
  });

  it('detectCli returns unavailable when gh not found', async () => {
    mockRunCli.mockResolvedValue({ stdout: '', stderr: 'Command not found: gh', code: 127 });
    const result = await adapter.detectCli(cid);
    expect(result).toMatchObject({ available: false });
  });

  it('checkAuth returns ok when gh auth status succeeds', async () => {
    mockRunCli.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    const result = await adapter.checkAuth(cid);
    expect(result).toMatchObject({ ok: true });
  });

  it('checkAuth returns not-authenticated when gh auth status fails', async () => {
    mockRunCli.mockResolvedValue({ stdout: '', stderr: 'not logged in', code: 1 });
    const result = await adapter.checkAuth(cid);
    expect(result).toMatchObject({ ok: false, code: 'not-authenticated' });
  });

  it('listAccounts returns personal + orgs', async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: 'myuser\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '"org1"\n"org2"\n', stderr: '', code: 0 });
    const accounts = await adapter.listAccounts(cid);
    expect(accounts).toHaveLength(3);
    expect(accounts[0]).toMatchObject({ id: 'myuser', badge: 'Personal' });
    expect(accounts[1]).toMatchObject({ id: 'org1' });
  });

  it('createRepo returns ok with clone URL on success', async () => {
    mockRunCli.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    const result = await adapter.createRepo({
      name: 'repo',
      accountId: 'user',
      correlationId: cid,
      visibility: 'private'
    });
    expect(result).toMatchObject({ ok: true, cloneUrl: 'https://github.com/user/repo.git' });
  });

  it('createRepo returns name-conflict on already exists error', async () => {
    mockRunCli.mockResolvedValue({ stdout: '', stderr: 'GraphQL: Name already exists on this account', code: 1 });
    const result = await adapter.createRepo({ name: 'repo', accountId: 'user', correlationId: cid });
    expect(result).toMatchObject({ ok: false, code: 'name-conflict' });
  });

  it('getCloneUrl returns github https URL', () => {
    expect(adapter.getCloneUrl('user', 'repo')).toBe('https://github.com/user/repo.git');
  });
});

describe('AzureDevOpsAdapter — detect with missing extension', () => {
  const adapter = new AzureDevOpsAdapter();
  const cid = 'test';

  it('returns available:false with missingExtension when az is present but extension is absent', async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: 'azure-cli 2.60.0\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: 'some-other-ext' }]), stderr: '', code: 0 });
    const result = await adapter.detectCli(cid);
    expect(result).toMatchObject({ available: false, missingExtension: 'azure-devops' });
  });

  it('returns available:true when az and extension both present', async () => {
    evict('azure');
    mockRunCli
      .mockResolvedValueOnce({ stdout: 'azure-cli 2.60.0\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: 'azure-devops' }]), stderr: '', code: 0 });
    const result = await adapter.detectCli(cid);
    expect(result).toMatchObject({ available: true });
  });
});

describe('LocalAdapter', () => {
  const adapter = new LocalAdapter();
  const cid = 'test';

  it('detectCli returns available with version when git succeeds', async () => {
    mockRunCli.mockResolvedValue({ stdout: 'git version 2.45.0\n', stderr: '', code: 0 });
    const result = await adapter.detectCli(cid);
    expect(result).toMatchObject({ available: true, version: '2.45.0' });
  });

  it('checkAuth always returns ok', async () => {
    const result = await adapter.checkAuth(cid);
    expect(result).toMatchObject({ ok: true });
  });

  it('listAccounts returns single Local entry', async () => {
    const accounts = await adapter.listAccounts(cid);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: 'local' });
  });

  it('createRepo returns ok', async () => {
    const result = await adapter.createRepo({ name: 'proj', accountId: 'local', correlationId: cid });
    expect(result).toMatchObject({ ok: true });
  });
});
