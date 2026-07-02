import { describe, expect, test, vi } from 'vitest';
import { resolveWorkItemInsertText, workItemsProvider } from './work-items-provider';
import type { WorkItem } from '../../../../main/lib/work-items/types';

const mockGetDetailQuery = vi.fn();

vi.mock('../../../lib/trpc', () => ({
  trpcClient: {
    workItems: {
      getDetail: {
        query: (...args: unknown[]) => (mockGetDetailQuery as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
}));

const workItem: WorkItem = {
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
};

describe('workItemsProvider [work-item-detail-fetch/mention-insertion-resolves-body-before-inserting]', () => {
  test('serializes list items as a short ref without requiring body', () => {
    expect(
      workItemsProvider.serialize({
        id: 'github:issue:owner/repo#12',
        label: '#12: Fix login timeout',
        data: workItem
      } as never)
    ).toBe('#12: Fix login timeout (owner/repo)');
  });

  test('fetches detail on demand and returns the full insertion text', async () => {
    mockGetDetailQuery.mockResolvedValueOnce({ body: 'Investigate the auth flow' });

    await expect(resolveWorkItemInsertText(workItem)).resolves.toBe(
      '#12: Fix login timeout (owner/repo)\n\nInvestigate the auth flow'
    );
    expect(mockGetDetailQuery).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', number: 12 });
  });
});
