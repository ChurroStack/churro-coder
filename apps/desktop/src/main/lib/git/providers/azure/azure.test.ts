import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAzurePRStatus, invalidateAzurePRCache } from './azure';

// --- Module mocks (hoisted before imports) ---

vi.mock('../../shell-env', () => ({ execWithShellEnv: vi.fn() }));
vi.mock('../../worktree', () => ({ branchExistsOnRemote: vi.fn() }));
vi.mock('../../index', () => ({ getGitRemoteInfo: vi.fn() }));
vi.mock('./detect', () => ({ detectAzureCli: vi.fn(), detectionToToastMessage: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execWithShellEnv } from '../../shell-env';
import { branchExistsOnRemote } from '../../worktree';
import { getGitRemoteInfo } from '../../index';
import { detectAzureCli } from './detect';
import { execFile } from 'node:child_process';

const mockExec = vi.mocked(execWithShellEnv);
const mockBranchExists = vi.mocked(branchExistsOnRemote);
const mockGetRemoteInfo = vi.mocked(getGitRemoteInfo);
const mockDetect = vi.mocked(detectAzureCli);
const mockExecFile = vi.mocked(execFile);

const WORKTREE = '/projects/my-repo';
const BRANCH = 'feature-branch';
const REMOTE_URL = 'https://dev.azure.com/myorg/MyProject/_git/myrepo';

const REPO_WEB_URL = 'https://dev.azure.com/myorg/MyProject/_git/myrepo';

// PR fixtures
const makePR = (overrides: Record<string, unknown> = {}) => ({
  pullRequestId: 42,
  title: 'My Feature',
  status: 'active',
  isDraft: false,
  mergeStatus: 'succeeded',
  reviewers: [],
  closedDate: null,
  ...overrides
});

const makePolicyEval = (status: string, displayName = 'Build') => ({
  status,
  configuration: { type: { displayName } }
});

// Set up az CLI responses based on the command args
function setupAzResponses(
  opts: {
    activePRs?: unknown[];
    allPRs?: unknown[];
    showPR?: unknown;
    policies?: unknown[];
  } = {}
) {
  const { activePRs = [], allPRs = [], showPR = makePR(), policies = [] } = opts;

  mockExec.mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd !== 'az') throw new Error(`Unexpected command: ${cmd}`);

    // Check 'policy list' before 'pr list' — policy list args also contain 'pr' and 'list'.
    if (args.includes('policy') && args.includes('list')) {
      return { stdout: JSON.stringify(policies), stderr: '' };
    }
    if (args.includes('pr') && args.includes('list')) {
      const statusIdx = args.indexOf('--status');
      const status = statusIdx !== -1 ? args[statusIdx + 1] : 'active';
      const prs = status === 'active' ? activePRs : allPRs;
      return { stdout: JSON.stringify(prs), stderr: '' };
    }
    if (args.includes('pr') && args.includes('show')) {
      return { stdout: JSON.stringify(showPR), stderr: '' };
    }
    throw new Error(`Unexpected az args: ${args.join(' ')}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAzurePRCache(WORKTREE);

  // Default happy-path wiring
  mockDetect.mockResolvedValue({ status: 'ok' });
  mockGetRemoteInfo.mockResolvedValue({ provider: 'azure', remoteUrl: REMOTE_URL });
  mockBranchExists.mockResolvedValue({ status: 'exists' });

  // Default: git rev-parse --abbrev-ref HEAD → BRANCH
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: null, res: { stdout: string; stderr: string }) => void;
    callback(null, { stdout: `${BRANCH}\n`, stderr: '' });
  });
});

describe('fetchAzurePRStatus', () => {
  it('returns PR data for an active PR', async () => {
    setupAzResponses({ activePRs: [makePR()] });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result).not.toBeNull();
    expect(result!.pr).not.toBeNull();
    expect(result!.pr!.number).toBe(42);
    expect(result!.pr!.title).toBe('My Feature');
    expect(result!.pr!.state).toBe('open');
    expect(result!.pr!.url).toBe(`${REPO_WEB_URL}/pullrequest/42`);
  });

  it('returns state=draft for a draft PR', async () => {
    const pr = makePR({ isDraft: true });
    setupAzResponses({ activePRs: [pr], showPR: pr });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.state).toBe('draft');
  });

  it('returns state=merged for a completed PR found via --status all fallback', async () => {
    const closedDate = '2024-01-15T10:00:00Z';
    const completedPR = makePR({ status: 'completed', closedDate });
    // active → empty, all → completed PR
    setupAzResponses({ activePRs: [], allPRs: [completedPR], showPR: completedPR });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.state).toBe('merged');
    expect(result!.pr!.mergedAt).toBe(Date.parse(closedDate));
  });

  it('returns state=closed for an abandoned PR', async () => {
    const abandonedPR = makePR({ status: 'abandoned' });
    setupAzResponses({ activePRs: [], allPRs: [abandonedPR], showPR: abandonedPR });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.state).toBe('closed');
  });

  it('returns reviewDecision=changes_requested when a reviewer voted -10', async () => {
    const pr = makePR({ reviewers: [{ vote: -10, isRequired: true, displayName: 'Alice' }] });
    setupAzResponses({ activePRs: [pr], showPR: pr });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.reviewDecision).toBe('changes_requested');
  });

  it('returns reviewDecision=approved when all required reviewers voted 10', async () => {
    const pr = makePR({
      reviewers: [
        { vote: 10, isRequired: true, displayName: 'Alice' },
        { vote: 10, isRequired: true, displayName: 'Bob' }
      ]
    });
    setupAzResponses({ activePRs: [pr], showPR: pr });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.reviewDecision).toBe('approved');
  });

  it('returns checksStatus=failure when a policy check is rejected', async () => {
    setupAzResponses({
      activePRs: [makePR()],
      policies: [makePolicyEval('rejected', 'Build Policy')]
    });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.checksStatus).toBe('failure');
  });

  it('returns checksStatus=success when all policy checks are approved', async () => {
    setupAzResponses({
      activePRs: [makePR()],
      policies: [makePolicyEval('approved', 'Build'), makePolicyEval('approved', 'Tests')]
    });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.checksStatus).toBe('success');
  });

  it('returns pr=null when no PR exists for the branch', async () => {
    setupAzResponses({ activePRs: [], allPRs: [] });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result).not.toBeNull();
    expect(result!.pr).toBeNull();
    expect(result!.repoUrl).toBe(REPO_WEB_URL);
    expect(result!.branchExistsOnRemote).toBe(true);
  });

  it('unknown mergeStatus value (schema-loosen regression) still surfaces the PR', async () => {
    const pr = makePR({ mergeStatus: 'notYetRun' }); // value not in old enum
    setupAzResponses({ activePRs: [pr], showPR: pr });
    const result = await fetchAzurePRStatus(WORKTREE);
    // PR must still be present (old code would have dropped it on parse failure)
    expect(result!.pr).not.toBeNull();
    expect(result!.pr!.mergeable).toBe('UNKNOWN');
  });

  it('picks the highest pullRequestId when multiple PRs are returned', async () => {
    const prs = [makePR({ pullRequestId: 10 }), makePR({ pullRequestId: 42 })];
    // showPR returns the one we inject — make it match the highest id
    setupAzResponses({ activePRs: prs, showPR: makePR({ pullRequestId: 42 }) });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result!.pr!.number).toBe(42);
  });

  it('passes branch as refs/heads/<branch> to az repos pr list', async () => {
    setupAzResponses({ activePRs: [makePR()] });
    await fetchAzurePRStatus(WORKTREE);
    const listCall = mockExec.mock.calls.find(([, args]) => Array.isArray(args) && args.includes('list'));
    expect(listCall).toBeDefined();
    const args = listCall![1] as string[];
    const sbIdx = args.indexOf('--source-branch');
    expect(args[sbIdx + 1]).toBe(`refs/heads/${BRANCH}`);
  });

  it('returns null when CLI detection fails', async () => {
    mockDetect.mockResolvedValue({ status: 'missing_cli' });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result).toBeNull();
  });

  it('returns null when remote is not Azure', async () => {
    mockGetRemoteInfo.mockResolvedValue({ provider: 'github', remoteUrl: 'https://github.com/o/r' });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result).toBeNull();
  });

  it('returns null when current branch cannot be determined', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: Error) => void;
      callback(new Error('not a git repo'));
    });
    const result = await fetchAzurePRStatus(WORKTREE);
    expect(result).toBeNull();
  });

  it('short-circuits on the 10 s cache without re-querying az', async () => {
    setupAzResponses({ activePRs: [makePR()] });
    const r1 = await fetchAzurePRStatus(WORKTREE);
    const r2 = await fetchAzurePRStatus(WORKTREE); // cache hit
    expect(r1).toEqual(r2);
    // detectAzureCli should only have been called once (cache prevents second call chain)
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });
});
