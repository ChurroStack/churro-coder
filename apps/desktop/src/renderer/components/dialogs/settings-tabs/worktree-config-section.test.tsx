// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorktreeConfigSection } from './worktree-config-section';

// --- Mocks -----------------------------------------------------------------

// Hoisted so the (hoisted) vi.mock factories below can reference them.
const {
  CONFIG_QUERY,
  createSubChatMutate,
  saveMutate,
  getAgentChatInvalidate,
  selectWorkspace,
  addToOpenSubChats,
  setActiveSubChat,
  getState,
  cleanMutateAsync,
  toastInfo,
  toastSuccess,
  toastError
} = vi.hoisted(() => {
  const addToOpenSubChats = vi.fn();
  const setActiveSubChat = vi.fn();
  return {
    // Stable reference — a fresh object each render would retrigger the
    // sync-from-server effect (keyed on configData) and loop forever.
    CONFIG_QUERY: { data: { source: 'cscode', config: null, available: {} } },
    createSubChatMutate: vi.fn(async () => ({ id: 'new-sub' })),
    saveMutate: vi.fn(),
    getAgentChatInvalidate: vi.fn(),
    selectWorkspace: vi.fn(),
    addToOpenSubChats,
    setActiveSubChat,
    // store.chatId differs from the panel's chatId → navigation must switch workspace first.
    getState: vi.fn(() => ({ chatId: 'other-ws', addToOpenSubChats, setActiveSubChat })),
    cleanMutateAsync: vi.fn(async ({ dryRun }: { worktreePath: string; dryRun: boolean }) =>
      dryRun
        ? { hasRemote: true, candidates: ['merged-pr', 'old-feature'], deleted: [] }
        : { hasRemote: true, candidates: [], deleted: ['merged-pr', 'old-feature'] }
    ),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn()
  };
});

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    worktreeConfig: {
      // No existing config; section renders empty command/script lists.
      get: { useQuery: () => CONFIG_QUERY },
      save: { useMutation: () => ({ mutate: saveMutate }) }
    },
    changes: {
      cleanBranchesWithoutRemote: { useMutation: () => ({ mutateAsync: cleanMutateAsync, isPending: false }) }
    }
  },
  trpcClient: {
    chats: { createSubChat: { mutate: createSubChatMutate } }
  }
}));

vi.mock('../../../lib/mock-api', () => ({
  api: {
    useUtils: () => ({ agents: { getAgentChat: { invalidate: getAgentChatInvalidate } } })
  }
}));

// Deterministic prompt text so the test does not depend on the j2 templates.
vi.mock('../../../features/agents/commands', () => ({
  COMMAND_PROMPTS: {
    'worktree-setup': 'WORKTREE_PROMPT',
    'scripts-fill': 'SCRIPTS_PROMPT'
  }
}));

vi.mock('../../../features/agents/stores/sub-chat-store', () => ({
  selectWorkspace: (...args: unknown[]) => selectWorkspace(...args),
  useAgentSubChatStore: { getState: () => getState() }
}));

// Radix Select drives an infinite ref-update loop under jsdom; stub it to plain
// elements (the config-file target picker is irrelevant to the Fill-with-AI flow).
vi.mock('../../ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess, info: toastInfo } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection() {
  return render(<WorktreeConfigSection projectId="p1" path="/base/wt" chatId="ws1" />);
}

describe('WorktreeConfigSection — Fill with AI [worktree-config/fill-with-ai]', () => {
  it('renders a Fill with AI button for Worktree and Scripts', () => {
    renderSection();
    expect(screen.getAllByRole('button', { name: /Fill with AI/ })).toHaveLength(2);
  });

  it('Worktree "Fill with AI" creates a sub-chat in the current workspace seeded with the prompt', async () => {
    renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: /Fill with AI/ })[0]);

    await waitFor(() => expect(createSubChatMutate).toHaveBeenCalledTimes(1));
    expect(createSubChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'ws1',
        name: 'Worktree Setup',
        mode: 'execute',
        initialMessageParts: [{ type: 'text', text: 'WORKTREE_PROMPT' }]
      })
    );
    // A client-generated id is passed for optimistic UI.
    expect(typeof createSubChatMutate.mock.calls[0][0].id).toBe('string');
  });

  it('navigates to the workspace + new sub-chat after creating it', async () => {
    renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: /Fill with AI/ })[0]);

    await waitFor(() => expect(setActiveSubChat).toHaveBeenCalled());
    const newId = createSubChatMutate.mock.calls[0][0].id;
    // store.chatId ('other-ws') !== 'ws1' → must switch workspace first.
    expect(selectWorkspace).toHaveBeenCalledWith('ws1');
    expect(addToOpenSubChats).toHaveBeenCalledWith(newId, 'ws1');
    expect(setActiveSubChat).toHaveBeenCalledWith(newId, 'ws1');
    expect(getAgentChatInvalidate).toHaveBeenCalledWith({ chatId: 'ws1' });
  });

  it('Scripts "Fill with AI" seeds the scripts prompt', async () => {
    renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: /Fill with AI/ })[1]);

    await waitFor(() => expect(createSubChatMutate).toHaveBeenCalledTimes(1));
    expect(createSubChatMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Scripts',
        initialMessageParts: [{ type: 'text', text: 'SCRIPTS_PROMPT' }]
      })
    );
  });
});

describe('WorktreeConfigSection — Clean orphaned branches', () => {
  it('renders the cleanup button', () => {
    renderSection();
    expect(screen.getByRole('button', { name: 'Clean orphaned branches' })).toBeTruthy();
  });

  it('scans (dry-run) then confirms deletion of the listed orphan branches', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Clean orphaned branches' }));

    // Dry-run scan opens the confirm dialog listing the candidates.
    expect(await screen.findByText('merged-pr')).toBeTruthy();
    expect(screen.getByText('old-feature')).toBeTruthy();
    expect(cleanMutateAsync).toHaveBeenCalledWith({ worktreePath: '/base/wt', dryRun: true });

    // Confirming runs the real delete (dryRun: false).
    fireEvent.click(screen.getByRole('button', { name: 'Delete branches' }));

    await waitFor(() => expect(cleanMutateAsync).toHaveBeenCalledWith({ worktreePath: '/base/wt', dryRun: false }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
