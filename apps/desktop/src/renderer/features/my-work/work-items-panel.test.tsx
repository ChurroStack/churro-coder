// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkItemsPanel } from './work-items-panel';

afterEach(cleanup);

const mockListQuery = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    workItems: {
      list: { useQuery: (...args: unknown[]) => (mockListQuery as (...a: unknown[]) => unknown)(...args) }
    }
  }
}));

describe('WorkItemsPanel', () => {
  test('inserts the short issue reference when clicked', () => {
    const onInsert = vi.fn();
    mockListQuery.mockReturnValue({
      data: {
        items: [
          {
            id: 'github:owner/repo#12',
            number: 12,
            title: 'Fix login timeout',
            body: 'Investigate the auth flow',
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

    expect(onInsert).toHaveBeenCalledWith('#12: Fix login timeout (owner/repo)');
    expect(screen.getByRole('link', { name: /open issue #12 on github/i })).toBeDefined();
  });
});
