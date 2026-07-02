import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchGitHubWorkItemsMock = vi.fn();
const fetchIssueBodyMock = vi.fn();

vi.mock('../../work-items/github', () => ({
  fetchGitHubWorkItems: (...args: unknown[]) => (fetchGitHubWorkItemsMock as (...a: unknown[]) => unknown)(...args),
  fetchIssueBody: (...args: unknown[]) => (fetchIssueBodyMock as (...a: unknown[]) => unknown)(...args)
}));

vi.mock('../../db', () => ({
  getDatabase: vi.fn(() => ({})),
  projects: {},
  chats: {}
}));

vi.mock('../index', () => ({
  publicProcedure: {
    input: () => ({
      mutation: (fn: unknown) => fn,
      query: (fn: unknown) => fn
    }),
    mutation: (fn: unknown) => fn,
    query: (fn: unknown) => fn
  },
  router: (routes: unknown) => routes
}));

describe('workItemsRouter', () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchGitHubWorkItemsMock.mockReset();
    fetchIssueBodyMock.mockReset();
    const cache = await import('../../work-items/cache');
    cache.evictAll();
  });

  test('refresh clears cached issue bodies so getDetail refetches fresh data', async () => {
    fetchIssueBodyMock.mockResolvedValueOnce('old body').mockResolvedValueOnce('new body');
    fetchGitHubWorkItemsMock.mockResolvedValue({
      items: [
        {
          id: 'github:owner/repo#12',
          number: 12,
          title: 'Fix login timeout',
          state: 'OPEN',
          type: 'issue',
          url: 'https://github.com/owner/repo/issues/12',
          labels: [],
          updatedAt: '2026-07-01T10:00:00.000Z',
          createdAt: '2026-06-01T10:00:00.000Z',
          provider: 'github',
          repoOwner: 'owner',
          repoName: 'repo'
        }
      ],
      pageInfo: { hasNextPage: false, endCursor: null }
    });

    const { workItemsRouter } = await import('./work-items');

    const first = await (workItemsRouter.getDetail as (ctx: unknown) => Promise<{ body: string }>)({
      input: { owner: 'owner', repo: 'repo', number: 12 }
    });
    expect(first).toEqual({ body: 'old body' });
    expect(fetchIssueBodyMock).toHaveBeenCalledTimes(1);

    await (workItemsRouter.refresh as (ctx: unknown) => Promise<unknown>)({ input: undefined });

    const second = await (workItemsRouter.getDetail as (ctx: unknown) => Promise<{ body: string }>)({
      input: { owner: 'owner', repo: 'repo', number: 12 }
    });
    expect(second).toEqual({ body: 'new body' });
    expect(fetchIssueBodyMock).toHaveBeenCalledTimes(2);
  });
});
