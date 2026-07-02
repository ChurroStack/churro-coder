// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { createTestStore } from '../../../../test-utils/create-test-store';
import { CloneAndStartDialog } from './clone-and-start-dialog';
import type { WorkItem } from '../../../main/lib/work-items/types';

afterEach(cleanup);

const mockCloneMutateAsync = vi.fn();
const mockCreateMutate = vi.fn();
const mockGetDetailQuery = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    projects: {
      cloneFromGitHub: {
        useMutation: () => ({
          mutateAsync: mockCloneMutateAsync,
          isPending: false
        })
      }
    },
    chats: {
      create: {
        useMutation: (opts: { onSuccess?: (r: { id: string }) => void; onError?: (e: Error) => void }) => ({
          mutate: (input: unknown) => {
            mockCreateMutate(input);
            opts.onSuccess?.({ id: 'chat-123' });
          },
          isPending: false
        })
      }
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

const item: WorkItem = {
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

function setup(onClose = vi.fn()) {
  const store = createTestStore();
  render(
    <Provider store={store}>
      <CloneAndStartDialog item={item} onClose={onClose} />
    </Provider>
  );
  return { onClose };
}

describe('CloneAndStartDialog [my-work/clone-and-start-dialog]', () => {
  beforeEach(() => {
    mockCloneMutateAsync.mockReset();
    mockCreateMutate.mockReset();
    mockGetDetailQuery.mockReset();
    mockGetDetailQuery.mockResolvedValue({ body: 'Add dark mode support.' });
  });

  test('renders issue summary and clone target', () => {
    mockCloneMutateAsync.mockResolvedValue({ id: 'proj-1' });
    setup();
    expect(screen.getByRole('dialog', { name: /clone and start session/i })).toBeDefined();
    expect(screen.getByText('Implement dark mode')).toBeDefined();
    expect(screen.getByText(/owner\/repo #7/)).toBeDefined();
    expect(screen.getByText(/is not open locally yet/i)).toBeDefined();
  });

  test('clones the repo and creates a chat when confirmed', async () => {
    mockCloneMutateAsync.mockResolvedValue({ id: 'proj-1' });
    setup();

    fireEvent.click(screen.getByRole('button', { name: /confirm clone and start session/i }));

    await waitFor(() =>
      expect(mockCloneMutateAsync).toHaveBeenCalledWith({ repoUrl: 'https://github.com/owner/repo' })
    );
    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        name: '#7: Implement dark mode',
        initialMessage:
          "I'm working on #7: Implement dark mode\n\nAdd dark mode support.\n\nhttps://github.com/owner/repo/issues/7",
        useWorktree: true
      })
    );
    expect(mockGetDetailQuery).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', number: 7 });
  });

  test('closes the dialog when cancel is clicked', () => {
    mockCloneMutateAsync.mockResolvedValue({ id: 'proj-1' });
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
