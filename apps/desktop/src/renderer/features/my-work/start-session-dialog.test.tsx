// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { createTestStore } from '../../../../test-utils/create-test-store';
import { StartSessionDialog } from './start-session-dialog';
import type { WorkItem } from '../../../main/lib/work-items/types';

afterEach(cleanup);

const mockMutate = vi.fn();
const mockIsPending = { isPending: false };
const mockProjectsQuery = vi.fn(() => ({ data: [] as unknown[] }));
const mockGetDetailQuery = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    chats: {
      create: {
        useMutation: (opts: { onSuccess?: (r: { id: string }) => void; onError?: (e: Error) => void }) => ({
          mutate: (input: unknown) => {
            mockMutate(input);
            opts.onSuccess?.({ id: 'new-chat-123' });
          },
          isPending: mockIsPending.isPending
        })
      }
    },
    projects: {
      list: { useQuery: (...args: unknown[]) => (mockProjectsQuery as (...a: unknown[]) => unknown)(...args) }
    }
  },
  trpcClient: {
    workItems: {
      getDetail: {
        query: (...args: unknown[]) => (mockGetDetailQuery as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
}));

vi.mock('../agents/stores/sub-chat-store', () => ({
  selectWorkspace: vi.fn()
}));

const baseItem: WorkItem = {
  id: 'github:owner/repo#7',
  number: 7,
  title: 'Implement dark mode',
  state: 'OPEN',
  type: 'issue',
  url: 'https://github.com/owner/repo/issues/7',
  labels: [],
  updatedAt: new Date('2026-06-01T10:00:00Z').toISOString(),
  createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
  provider: 'github',
  repoOwner: 'owner',
  repoName: 'repo'
};

function setup(item: WorkItem | null, projectId: string | null, onClose = vi.fn()) {
  const store = createTestStore();
  render(
    <Provider store={store}>
      <StartSessionDialog item={item} projectId={projectId} onClose={onClose} />
    </Provider>
  );
  return { onClose };
}

describe('StartSessionDialog [my-work/start-session-dialog]', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockIsPending.isPending = false;
    mockProjectsQuery.mockReturnValue({ data: [] });
    mockGetDetailQuery.mockReset();
    mockGetDetailQuery.mockResolvedValue({ body: 'Add dark mode support.' });
  });

  test('does not render when item is null', () => {
    setup(null, null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('renders dialog with issue summary when item is provided', () => {
    setup(baseItem, 'proj-1');
    expect(screen.getByRole('dialog', { name: /start session/i })).toBeDefined();
    expect(screen.getByText('Implement dark mode')).toBeDefined();
    expect(screen.getByText(/owner\/repo #7/)).toBeDefined();
  });

  test('renders mode selector', () => {
    setup(baseItem, 'proj-1');
    expect(screen.getByLabelText('Session mode')).toBeDefined();
  });

  test('renders agent harness selector', () => {
    setup(baseItem, 'proj-1');
    expect(screen.getByLabelText('Agent harness')).toBeDefined();
  });

  test('loads issue detail before creating the chat payload', async () => {
    setup(baseItem, 'proj-1');
    const btn = screen.getByRole('button', { name: /confirm start session/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          name: '#7: Implement dark mode',
          initialMessage:
            "I'm working on #7: Implement dark mode\n\nAdd dark mode support.\n\nhttps://github.com/owner/repo/issues/7",
          useWorktree: true
        })
      )
    );
    expect(mockGetDetailQuery).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', number: 7 });
  });

  test('calls onClose when Cancel is clicked', () => {
    const { onClose } = setup(baseItem, 'proj-1');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('allows selecting a workspace when the issue is not linked to a local project yet', () => {
    mockProjectsQuery.mockReturnValue({
      data: [
        { id: 'proj-a', name: 'Payments UI', path: '/tmp/payments' },
        { id: 'proj-b', name: 'Shared Backend', path: '/tmp/backend' }
      ]
    });
    setup(baseItem, null);

    fireEvent.click(screen.getByRole('combobox', { name: /workspace/i }));
    fireEvent.click(screen.getByRole('option', { name: /shared backend/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm start session/i }));

    return waitFor(() => expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-b' })));
  });
});
