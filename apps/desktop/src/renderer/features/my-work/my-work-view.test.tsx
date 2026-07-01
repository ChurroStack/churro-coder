// @vitest-environment jsdom
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Provider } from 'jotai';
import { createTestStore } from '../../../../test-utils/create-test-store';
import { MyWorkView } from './my-work-view';
import type { WorkItem } from '../../../main/lib/work-items/types';

afterEach(cleanup);

vi.mock('../agents/ui/agents-header-controls', () => ({
  AgentsHeaderControls: () => null
}));

vi.mock('../../lib/hooks/use-mobile', () => ({ useIsMobile: () => false }));

vi.mock('./start-session-dialog', () => ({
  StartSessionDialog: ({ item, onClose }: { item: WorkItem | null; onClose: () => void }) =>
    item ? (
      <div role="dialog" aria-label="Start session">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
}));

vi.mock('./clone-and-start-dialog', () => ({
  CloneAndStartDialog: ({ item, onClose }: { item: WorkItem | null; onClose: () => void }) =>
    item ? (
      <div role="dialog" aria-label="Clone and start session">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
}));

const {
  mockRefreshMutate,
  mockLoadMoreMutate,
  mockListQuery,
  mockRefreshUseMutation,
  mockLoadMoreUseMutation,
  mockProjectsQuery,
  mockLinkedChatsQuery,
  mockSelectWorkspace
} = vi.hoisted(() => ({
  mockRefreshMutate: vi.fn(),
  mockLoadMoreMutate: vi.fn(),
  mockListQuery: vi.fn(),
  mockRefreshUseMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  mockLoadMoreUseMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  mockProjectsQuery: vi.fn(() => ({ data: [] as unknown[] })),
  mockLinkedChatsQuery: vi.fn(() => ({ data: [] as unknown[] })),
  mockSelectWorkspace: vi.fn()
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    workItems: {
      list: { useQuery: (...args: unknown[]) => (mockListQuery as (...a: unknown[]) => unknown)(...args) },
      refresh: {
        useMutation: (...args: unknown[]) => (mockRefreshUseMutation as (...a: unknown[]) => unknown)(...args)
      },
      loadMore: {
        useMutation: (...args: unknown[]) => (mockLoadMoreUseMutation as (...a: unknown[]) => unknown)(...args)
      },
      linkedChats: { useQuery: (...args: unknown[]) => (mockLinkedChatsQuery as (...a: unknown[]) => unknown)(...args) }
    },
    projects: {
      list: { useQuery: (...args: unknown[]) => (mockProjectsQuery as (...a: unknown[]) => unknown)(...args) }
    }
  }
}));

vi.mock('../agents/stores/sub-chat-store', () => ({ selectWorkspace: mockSelectWorkspace }));

const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'github:owner/repo#1',
  number: 1,
  title: 'Sample issue',
  body: 'Body text',
  state: 'OPEN',
  type: 'issue',
  url: 'https://github.com/owner/repo/issues/1',
  labels: [],
  updatedAt: new Date('2026-06-01T10:00:00Z').toISOString(),
  createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
  provider: 'github',
  repoOwner: 'owner',
  repoName: 'repo',
  ...overrides
});

function setup() {
  const store = createTestStore();
  render(
    <Provider store={store}>
      <MyWorkView />
    </Provider>
  );
  return store;
}

describe('MyWorkView [my-work/my-work-view]', () => {
  beforeEach(() => {
    mockProjectsQuery.mockReturnValue({ data: [] });
    mockLinkedChatsQuery.mockReturnValue({ data: [] });
    mockRefreshUseMutation.mockReturnValue({ mutate: mockRefreshMutate, isPending: false });
    mockLoadMoreUseMutation.mockReturnValue({ mutate: mockLoadMoreMutate, isPending: false });
    mockRefreshMutate.mockClear();
    mockLoadMoreMutate.mockClear();
    mockSelectWorkspace.mockClear();
  });

  test('shows loading state while query is loading', () => {
    mockListQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.getByText(/loading work items/i)).toBeDefined();
  });

  test('shows empty state when no items returned but projects exist', () => {
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'p1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    mockListQuery.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.getByText(/no open github issues assigned to you/i)).toBeDefined();
  });

  test('shows empty state prompting to open a project when no projects exist', () => {
    mockListQuery.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.getByText(/no open github issues assigned to you/i)).toBeDefined();
  });

  test('renders github work items in a list', () => {
    mockListQuery.mockReturnValue({
      data: { items: [makeItem({ number: 5, title: 'Fix crash on startup' })] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.getByRole('list', { name: /work items/i })).toBeDefined();
    expect(screen.getByText('Fix crash on startup')).toBeDefined();
  });

  test('filters items by search text', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [
          makeItem({ number: 1, title: 'Fix crash on startup', body: 'renderer panic' }),
          makeItem({
            number: 2,
            title: 'Add keyboard shortcuts',
            body: 'search shortcuts',
            repoName: 'repo-two',
            id: 'github:owner/repo-two#2'
          })
        ]
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    fireEvent.change(screen.getByRole('searchbox', { name: /search issues/i }), { target: { value: 'keyboard' } });
    expect(screen.getByText('Add keyboard shortcuts')).toBeDefined();
    expect(screen.queryByText('Fix crash on startup')).toBeNull();
  });

  test('filters to clonable issues only', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [
          makeItem({ number: 1, title: 'Opened locally', repoOwner: 'owner', repoName: 'repo' }),
          makeItem({
            number: 2,
            title: 'Needs clone',
            repoOwner: 'other',
            repoName: 'repo-two',
            id: 'github:other/repo-two#2'
          })
        ]
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'p1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    setup();
    fireEvent.click(screen.getByRole('combobox', { name: /visibility filter/i }));
    fireEvent.click(screen.getByRole('option', { name: /needs clone/i }));
    expect(screen.getByRole('listitem', { name: /issue #2: Needs clone/i })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: /issue #1: Opened locally/i })).toBeNull();
  });

  test('sorts items by repo name', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [
          makeItem({
            number: 2,
            title: 'Repo B issue',
            repoOwner: 'owner',
            repoName: 'zeta',
            id: 'github:owner/zeta#2'
          }),
          makeItem({
            number: 1,
            title: 'Repo A issue',
            repoOwner: 'owner',
            repoName: 'alpha',
            id: 'github:owner/alpha#1'
          })
        ]
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    fireEvent.click(screen.getByRole('combobox', { name: /sort issues/i }));
    fireEvent.click(screen.getByRole('option', { name: /repo name/i }));
    const headers = screen.getAllByText(/^owner\/(alpha|zeta)$/).map((node) => node.textContent);
    expect(headers[0]).toBe('owner/alpha');
    expect(headers[1]).toBe('owner/zeta');
  });

  test('shows error state with hint when CLI is missing', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [],
        error: { code: 'cli-missing', message: 'Please install the gh CLI.', hint: 'brew install gh' }
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.getByText('GitHub CLI not installed')).toBeDefined();
    expect(screen.getByText('brew install gh')).toBeDefined();
  });

  test('calls refresh mutation when refresh button clicked', () => {
    mockListQuery.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /refresh work items/i }));
    expect(mockRefreshMutate).toHaveBeenCalledWith();
  });

  test('opens start session dialog when Start session clicked', () => {
    mockListQuery.mockReturnValue({
      data: { items: [makeItem({ number: 9, title: 'Add search feature' })] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /start session for issue #9/i }));
    expect(screen.getByRole('dialog', { name: /start session/i })).toBeDefined();
  });

  test('opens clone and start dialog for issues without a local project', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [makeItem({ number: 12, title: 'Sync notifications', repoOwner: 'other', repoName: 'repo-two' })]
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'p1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /clone and start session for issue #12/i }));
    expect(screen.getByRole('dialog', { name: /clone and start session/i })).toBeDefined();
  });

  test('shows Resume session button when a linked chat exists for the issue', () => {
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'proj-1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    mockListQuery.mockReturnValue({
      data: { items: [makeItem({ number: 7, title: 'Dark mode', repoOwner: 'owner', repoName: 'repo' })] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    mockLinkedChatsQuery.mockReturnValue({
      data: [{ id: 'chat-abc', name: '#7: Dark mode', projectId: 'proj-1' }]
    });
    setup();
    expect(screen.getByRole('button', { name: /resume session for issue #7/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /start session for issue #7/i })).toBeNull();
  });

  test('only resumes chats whose title still matches the GitHub issue title', () => {
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'proj-1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    mockListQuery.mockReturnValue({
      data: { items: [makeItem({ number: 7, title: 'Dark mode', repoOwner: 'owner', repoName: 'repo' })] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    mockLinkedChatsQuery.mockReturnValue({
      data: [
        { id: 'chat-wrong', name: '#7: Old title', projectId: 'proj-1', updatedAt: new Date('2026-06-01T10:00:00Z') },
        { id: 'chat-right', name: '#7: Dark mode', projectId: 'proj-1', updatedAt: new Date('2026-07-01T10:00:00Z') }
      ]
    });

    setup();

    expect(screen.getByRole('button', { name: /resume session for issue #7/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /start session for issue #7/i })).toBeNull();
  });

  test('shows Load more button when hasNextPage is true', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [makeItem({ number: 3, title: 'Pagination issue' })],
        pageInfo: { hasNextPage: true, endCursor: 'cursor123' }
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.getByRole('button', { name: /load more issues/i })).toBeDefined();
  });

  test('does not show Load more button when hasNextPage is false', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [makeItem({ number: 3, title: 'Pagination issue' })],
        pageInfo: { hasNextPage: false, endCursor: null }
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    expect(screen.queryByRole('button', { name: /load more issues/i })).toBeNull();
  });

  test('calls loadMore mutation with cursor when Load more clicked', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [makeItem({ number: 3, title: 'Pagination issue' })],
        pageInfo: { hasNextPage: true, endCursor: 'cursor-abc' }
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /load more issues/i }));
    expect(mockLoadMoreMutate).toHaveBeenCalledWith({ cursor: 'cursor-abc' });
  });

  test('ArrowDown then Enter opens Start session for the active issue', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [
          makeItem({ number: 1, title: 'First issue' }),
          makeItem({ number: 2, title: 'Second issue', id: 'github:owner/repo#2' })
        ]
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    setup();
    const list = screen.getByRole('list', { name: /work items/i });
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: /start session/i })).toBeDefined();
  });

  test('Arrow navigation reaches clonable issues and Enter opens Clone and start dialog', () => {
    mockListQuery.mockReturnValue({
      data: {
        items: [
          makeItem({ number: 1, title: 'Opened locally', repoOwner: 'owner', repoName: 'repo' }),
          makeItem({
            number: 2,
            title: 'Needs clone',
            repoOwner: 'other',
            repoName: 'repo-two',
            id: 'github:other/repo-two#2'
          })
        ]
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'p1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    setup();
    const list = screen.getByRole('list', { name: /work items/i });
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: /clone and start session/i })).toBeDefined();
  });

  test('Arrow navigation reaches resumable issues and Enter resumes the linked session', () => {
    mockProjectsQuery.mockReturnValue({
      data: [{ id: 'proj-1', gitOwner: 'owner', gitRepo: 'repo', gitProvider: 'github' }]
    });
    mockListQuery.mockReturnValue({
      data: { items: [makeItem({ number: 7, title: 'Dark mode', repoOwner: 'owner', repoName: 'repo' })] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn()
    });
    mockLinkedChatsQuery.mockReturnValue({
      data: [{ id: 'chat-abc', name: '#7: Dark mode', projectId: 'proj-1' }]
    });
    setup();
    const list = screen.getByRole('list', { name: /work items/i });
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(mockSelectWorkspace).toHaveBeenCalledWith('chat-abc');
  });
});
