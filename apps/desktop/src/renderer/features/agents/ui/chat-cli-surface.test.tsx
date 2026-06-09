// @vitest-environment jsdom
// Regression test for task 10.3: lazy CLI respawn on panel activation after restart.
// Asserts no PTY spawns (no buildCliBootstrap call) until the user clicks Reattach.

const mockBuildCliBootstrap = vi.hoisted(() => vi.fn(async () => ({ command: 'claude', args: [] })));

// Controllable CLI-session mocks for the mount self-heal tests. `status` is the
// object returned by `cliSession.getStatus.useQuery`; mutate it per test. The
// default mirrors the old `emptyQuery` so the pre-existing tests are unaffected
// (no `isSuccess` ⇒ the self-heal effect bails).
const cliSessionMocks = vi.hoisted(() => ({
  status: { data: undefined as undefined | Record<string, unknown>, isLoading: false, isSuccess: false },
  ensureAttachedMutate: vi.fn()
}));

vi.mock('../../../lib/trpc', () => {
  const emptyQuery = () => ({ data: undefined, isLoading: false });
  const emptyMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const emptyInvalidate = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: vi.fn(() => ({
        chats: {
          getPrStatus: emptyInvalidate,
          getCurrentPlan: emptyInvalidate,
          getCurrentReview: emptyInvalidate,
          getReviewContent: emptyInvalidate,
          getCurrentTasks: emptyInvalidate,
          get: emptyInvalidate
        },
        changes: { getStatus: emptyInvalidate, getBranches: emptyInvalidate },
        cliSession: { getStatus: emptyInvalidate },
        messages: { getLatest: emptyInvalidate }
      })),
      chats: {
        buildCliBootstrap: {
          useMutation: vi.fn(() => ({
            mutate: mockBuildCliBootstrap,
            mutateAsync: mockBuildCliBootstrap,
            isPending: false
          }))
        },
        cliUserQuestion: { useSubscription: vi.fn() },
        resolveCliUserQuestion: { useMutation: vi.fn(emptyMutation) },
        getMcpFileChanges: { useQuery: vi.fn(emptyQuery) },
        // Workflow notch chain — useWorkflowState / useWorkflowSnapshot:
        get: { useQuery: vi.fn(emptyQuery) },
        getSubChat: { useQuery: vi.fn(emptyQuery) },
        updateSubChatMode: { useMutation: vi.fn(emptyMutation) },
        getCurrentPlan: { useQuery: vi.fn(emptyQuery) },
        getCurrentReview: { useQuery: vi.fn(emptyQuery) },
        getCurrentTasks: { useQuery: vi.fn(emptyQuery) },
        getPrStatus: { useQuery: vi.fn(emptyQuery) }
      },
      changes: {
        getStatus: { useQuery: vi.fn(emptyQuery) },
        push: { useMutation: vi.fn(emptyMutation) },
        pull: { useMutation: vi.fn(emptyMutation) }
      },
      terminal: {
        write: { useMutation: vi.fn(emptyMutation) },
        kill: { useMutation: vi.fn(emptyMutation) },
        clearScrollback: { useMutation: vi.fn(emptyMutation) },
        stream: { useSubscription: vi.fn() }
      },
      // CliSplitBody now mounts in every bootstrap state (the conversation pane
      // always renders), so getStatus is queried even while disconnected/loading.
      cliSession: {
        getStatus: { useQuery: vi.fn(() => cliSessionMocks.status) },
        ensureAttached: {
          useMutation: vi.fn(() => ({
            mutate: cliSessionMocks.ensureAttachedMutate,
            mutateAsync: vi.fn(),
            isPending: false
          }))
        }
      }
    }
  };
});

vi.mock('../hooks/use-stuck-detection', () => ({
  useStuckDetection: vi.fn()
}));

vi.mock('../hooks/use-cli-auto-rename-on-first-message', () => ({
  useCliAutoRenameOnFirstMessage: vi.fn()
}));

// Stub the Terminal component — we only care about whether bootstrap was fetched.
vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal-stub" />
}));

// Stub the read-only conversation pane — it mounts alongside the terminal slot
// now, but its messages/onMessages/file-open chain is irrelevant to these tests.
vi.mock('./cli-conversation-pane', () => ({
  CliConversationPane: () => <div data-testid="cli-conversation-pane-stub" />
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ChatCliSurface } from './chat-cli-surface';

afterEach(cleanup);

beforeEach(() => {
  mockBuildCliBootstrap.mockClear();
  cliSessionMocks.ensureAttachedMutate.mockClear();
  cliSessionMocks.status = { data: undefined, isLoading: false, isSuccess: false };
});

describe('ChatCliSurface — lazy reattach (task 10.3)', () => {
  it('does NOT call buildCliBootstrap when startDisconnected=true (no PTY spawn on restore)', () => {
    render(<ChatCliSurface subChatId="sc-restored" harness="claude-cli" startDisconnected={true} />);
    expect(mockBuildCliBootstrap).not.toHaveBeenCalled();
  });

  it('shows the Reattach button when startDisconnected=true', () => {
    const { getByTestId } = render(
      <ChatCliSurface subChatId="sc-restored" harness="claude-cli" startDisconnected={true} />
    );
    expect(getByTestId('cli-reattach-button')).toBeTruthy();
  });

  it('renders the conversation pane alongside the Reattach prompt (chat stays visible while detached)', () => {
    // No chatId here: it would mount the workflow notch (SubChatStatusCard),
    // which needs a QueryClientProvider these mocks don't set up. The pane
    // renders independent of chatId — it's the layout split we're asserting.
    const { getByTestId } = render(
      <ChatCliSurface subChatId="sc-restored" harness="claude-cli" startDisconnected={true} />
    );
    // Reattach prompt is scoped to the terminal slot; the chat transcript pane
    // renders next to it instead of being hidden by a full-screen overlay.
    expect(getByTestId('cli-reattach-button')).toBeTruthy();
    expect(getByTestId('cli-conversation-pane-stub')).toBeTruthy();
  });

  it('clicking Reattach triggers buildCliBootstrap with the correct subChatId', async () => {
    const { getByTestId } = render(
      <ChatCliSurface subChatId="sc-restored" harness="claude-cli" startDisconnected={true} />
    );

    await act(async () => {
      fireEvent.click(getByTestId('cli-reattach-button'));
    });

    expect(mockBuildCliBootstrap).toHaveBeenCalledOnce();
    expect(mockBuildCliBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ subChatId: 'sc-restored', harness: 'claude-cli' })
    );
  });

  it('calls buildCliBootstrap immediately when startDisconnected=false (fresh panel, normal flow)', () => {
    render(<ChatCliSurface subChatId="sc-fresh" harness="codex-cli" startDisconnected={false} />);
    expect(mockBuildCliBootstrap).toHaveBeenCalledOnce();
    expect(mockBuildCliBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ subChatId: 'sc-fresh', harness: 'codex-cli' })
    );
  });

  it('shows the chat-cli-surface testid regardless of startDisconnected', () => {
    const { getByTestId: fresh } = render(
      <ChatCliSurface subChatId="sc-a" harness="claude-cli" startDisconnected={false} />
    );
    expect(fresh('chat-cli-surface')).toBeTruthy();

    cleanup();
    const { getByTestId: restored } = render(
      <ChatCliSurface subChatId="sc-b" harness="claude-cli" startDisconnected={true} />
    );
    expect(restored('chat-cli-surface')).toBeTruthy();
  });
});

describe('ChatCliSurface — mount self-heal (auto-attach when ingester is not watching)', () => {
  it('fires ensureAttached once when a CLI sub-chat has a claimed session but no watcher', () => {
    cliSessionMocks.status = {
      data: { harness: 'claude-cli', sessionFile: null, sessionId: 'sess-123', detectedAt: null, watching: false },
      isLoading: false,
      isSuccess: true
    };
    render(<ChatCliSurface subChatId="sc-orphaned" harness="claude-cli" startDisconnected={true} />);
    expect(cliSessionMocks.ensureAttachedMutate).toHaveBeenCalledTimes(1);
    expect(cliSessionMocks.ensureAttachedMutate).toHaveBeenCalledWith(
      { subChatId: 'sc-orphaned' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it('does NOT fire ensureAttached when an ingester is already watching', () => {
    cliSessionMocks.status = {
      data: {
        harness: 'claude-cli',
        sessionFile: '/x/sess.jsonl',
        sessionId: 'sess-123',
        detectedAt: 1,
        watching: true
      },
      isLoading: false,
      isSuccess: true
    };
    render(<ChatCliSurface subChatId="sc-healthy" harness="claude-cli" startDisconnected={true} />);
    expect(cliSessionMocks.ensureAttachedMutate).not.toHaveBeenCalled();
  });

  it('does NOT fire ensureAttached when no session id is claimed yet (nothing to recover)', () => {
    cliSessionMocks.status = {
      data: { harness: 'claude-cli', sessionFile: null, sessionId: null, detectedAt: null, watching: false },
      isLoading: false,
      isSuccess: true
    };
    render(<ChatCliSurface subChatId="sc-fresh" harness="claude-cli" startDisconnected={true} />);
    expect(cliSessionMocks.ensureAttachedMutate).not.toHaveBeenCalled();
  });
});
