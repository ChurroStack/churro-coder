// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ComponentProps } from 'react';
import { createTestStore } from '../../../../../test-utils/create-test-store';
import { AgentsFileMention } from './agents-file-mention';

afterEach(cleanup);

if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {};
}

const mockWorkItemsQuery = vi.fn();

vi.mock('../../../lib/trpc', () => {
  const query = (data: unknown) => vi.fn(() => ({ data, isLoading: false, isError: false }));
  return {
    trpc: {
      skills: { listEnabled: { useQuery: query([]) } },
      agents: { listEnabled: { useQuery: query([]) } },
      commands: { list: { useQuery: query([]) } },
      workItems: {
        list: { useQuery: (...args: unknown[]) => (mockWorkItemsQuery as (...a: unknown[]) => unknown)(...args) }
      }
    }
  };
});

vi.mock('../../../lib/mock-api', () => ({
  api: {
    github: {
      searchFiles: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false, isFetching: false, error: null }))
      }
    }
  }
}));

function renderMention(props: Partial<ComponentProps<typeof AgentsFileMention>> = {}) {
  const store = createTestStore();
  return render(
    <Provider store={store}>
      <AgentsFileMention
        isOpen
        onClose={() => {}}
        onSelect={() => {}}
        searchText=""
        position={{ top: 0, left: 0 }}
        {...props}
      />
    </Provider>
  );
}

describe('AgentsFileMention', () => {
  test('shows My Work as a category when GitHub work items exist', () => {
    mockWorkItemsQuery.mockReturnValue({
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
      }
    });

    renderMention();

    expect(screen.getByText('My Work')).toBeDefined();
  });

  test('renders GitHub issues inside the My Work subpage and selects them', () => {
    const onSelect = vi.fn();
    mockWorkItemsQuery.mockReturnValue({
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
      }
    });

    renderMention({ onSelect, showingWorkItemsList: true });

    fireEvent.click(screen.getByText('#12: Fix login timeout'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        label: '#12: Fix login timeout',
        repository: 'owner/repo',
        type: 'tool'
      })
    );
  });
});
