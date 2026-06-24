import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPRStatus, resolveProvider, invalidateProviderCache } from './index';

// --- Module mocks ---

vi.mock('../index', () => ({ getGitRemoteInfo: vi.fn() }));
vi.mock('../github', () => ({
  fetchGitHubPRStatus: vi.fn(),
  fetchGitHubPRComments: vi.fn(),
  invalidateGitHubPRCache: vi.fn(),
  invalidateGitHubPRCommentsCache: vi.fn()
}));
vi.mock('./azure/azure', () => ({
  fetchAzurePRStatus: vi.fn(),
  fetchAzurePRComments: vi.fn(),
  invalidateAzurePRCache: vi.fn(),
  invalidateAzurePRCommentsCache: vi.fn(),
  mergeAzurePR: vi.fn(),
  updateAzurePRTitle: vi.fn()
}));
// shell-env is imported at the bottom of providers/index for the GitHub adapters
vi.mock('../shell-env', () => ({ execWithShellEnv: vi.fn() }));

import { getGitRemoteInfo } from '../index';
import { fetchGitHubPRStatus } from '../github';
import { fetchAzurePRStatus } from './azure/azure';

const mockGetRemote = vi.mocked(getGitRemoteInfo);
const mockGH = vi.mocked(fetchGitHubPRStatus);
const mockAZ = vi.mocked(fetchAzurePRStatus);

const WORKTREE = '/projects/repo';

const githubStatus = {
  pr: null,
  repoUrl: 'https://github.com/owner/repo',
  branchExistsOnRemote: true,
  lastRefreshed: 1_000_000
};
const azureStatus = {
  pr: null,
  repoUrl: 'https://dev.azure.com/org/proj/_git/repo',
  branchExistsOnRemote: true,
  lastRefreshed: 1_000_000
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateProviderCache(WORKTREE);
});

describe('fetchPRStatus (dispatcher)', () => {
  it('routes a GitHub remote to fetchGitHubPRStatus', async () => {
    mockGetRemote.mockResolvedValue({ provider: 'github', remoteUrl: 'https://github.com/o/r' });
    mockGH.mockResolvedValue(githubStatus);

    const result = await fetchPRStatus(WORKTREE);

    expect(mockGH).toHaveBeenCalledWith(WORKTREE);
    expect(mockAZ).not.toHaveBeenCalled();
    expect(result).toEqual(githubStatus);
  });

  it('routes an Azure remote to fetchAzurePRStatus', async () => {
    mockGetRemote.mockResolvedValue({
      provider: 'azure',
      remoteUrl: 'https://dev.azure.com/org/proj/_git/repo'
    });
    mockAZ.mockResolvedValue(azureStatus);

    const result = await fetchPRStatus(WORKTREE);

    expect(mockAZ).toHaveBeenCalledWith(WORKTREE);
    expect(mockGH).not.toHaveBeenCalled();
    expect(result).toEqual(azureStatus);
  });

  it('returns null for an unsupported provider (gitlab)', async () => {
    mockGetRemote.mockResolvedValue({
      provider: 'other',
      remoteUrl: 'https://gitlab.com/owner/repo'
    });

    const result = await fetchPRStatus(WORKTREE);

    expect(result).toBeNull();
    expect(mockGH).not.toHaveBeenCalled();
    expect(mockAZ).not.toHaveBeenCalled();
  });

  it('returns null when there is no remote at all', async () => {
    mockGetRemote.mockResolvedValue({ provider: null, remoteUrl: null });

    const result = await fetchPRStatus(WORKTREE);
    expect(result).toBeNull();
  });
});

describe('resolveProvider + cache', () => {
  it('caches the provider for 60 s so getGitRemoteInfo is not called again', async () => {
    mockGetRemote.mockResolvedValue({ provider: 'github', remoteUrl: 'https://github.com/o/r' });
    mockGH.mockResolvedValue(githubStatus);

    const p1 = await resolveProvider(WORKTREE);
    const p2 = await resolveProvider(WORKTREE); // cache hit

    expect(p1).toBe('github');
    expect(p2).toBe('github');
    expect(mockGetRemote).toHaveBeenCalledTimes(1); // not 2
  });

  it('invalidateProviderCache clears the cache so next call re-resolves', async () => {
    mockGetRemote.mockResolvedValueOnce({ provider: 'github', remoteUrl: 'https://github.com/o/r' });
    const p1 = await resolveProvider(WORKTREE);
    expect(p1).toBe('github');

    invalidateProviderCache(WORKTREE);

    mockGetRemote.mockResolvedValueOnce({
      provider: 'azure',
      remoteUrl: 'https://dev.azure.com/org/proj/_git/repo'
    });
    const p2 = await resolveProvider(WORKTREE);
    expect(p2).toBe('azure');
    expect(mockGetRemote).toHaveBeenCalledTimes(2);
  });

  it('invalidateProviderCache() with no argument clears all entries', async () => {
    const worktree2 = '/projects/other';
    mockGetRemote.mockResolvedValue({ provider: 'github', remoteUrl: 'https://github.com/o/r' });
    await resolveProvider(WORKTREE);
    await resolveProvider(worktree2);
    expect(mockGetRemote).toHaveBeenCalledTimes(2);

    invalidateProviderCache(); // clear all

    mockGetRemote.mockResolvedValue({ provider: 'azure', remoteUrl: 'https://dev.azure.com/a/b/_git/c' });
    await resolveProvider(WORKTREE);
    await resolveProvider(worktree2);
    expect(mockGetRemote).toHaveBeenCalledTimes(4); // re-resolved both
  });
});

describe('cross-provider contract', () => {
  it('the same fetchPRStatus tRPC call works for GitHub', async () => {
    mockGetRemote.mockResolvedValue({ provider: 'github', remoteUrl: 'https://github.com/o/r' });
    mockGH.mockResolvedValue(githubStatus);
    await expect(fetchPRStatus(WORKTREE)).resolves.not.toBeNull();
  });

  it('the same fetchPRStatus tRPC call works for Azure', async () => {
    mockGetRemote.mockResolvedValue({
      provider: 'azure',
      remoteUrl: 'https://dev.azure.com/org/proj/_git/repo'
    });
    mockAZ.mockResolvedValue(azureStatus);
    await expect(fetchPRStatus(WORKTREE)).resolves.not.toBeNull();
  });
});
