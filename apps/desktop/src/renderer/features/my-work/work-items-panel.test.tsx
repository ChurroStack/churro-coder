// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkItemsPanel } from './work-items-panel';

afterEach(cleanup);

const mockListQuery = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    workItems: {
      list: { useQuery: (...args: unknown[]) => (mockListQuery as (...a: unknown[]) => unknown)(...args) }
    }
  },
  trpcClient: {
    workItems: {
      getDetail: {
        query: vi.fn(async () => ({ body: 'Investigate the auth flow' }))
      }
    }
  }
}));

describe('WorkItemsPanel', () => {
  test('loads issue detail on click and inserts the resolved text', async () => {
    const onInsert = vi.fn();
    mockListQuery.mockReturnValue({
      data: {
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
        ]
      },
      isLoading: false
    });

    render(<WorkItemsPanel onInsert={onInsert} />);

    fireEvent.click(screen.getByRole('button', { name: /insert reference to issue #12/i }));

    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith('#12: Fix login timeout (owner/repo)\n\nInvestigate the auth flow')
    );
    expect(screen.getByRole('link', { name: /open issue #12 on github/i })).toBeDefined();
  });
});
