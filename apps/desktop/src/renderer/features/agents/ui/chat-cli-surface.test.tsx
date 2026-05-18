// @vitest-environment jsdom
// Regression test for task 10.3: lazy CLI respawn on panel activation after restart.
// Asserts no PTY spawns (no buildCliBootstrap call) until the user clicks Reattach.

const mockBuildCliBootstrap = vi.hoisted(() => vi.fn(async () => ({ command: 'claude', args: [] })));

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
        changes: { getStatus: emptyInvalidate, getBranches: emptyInvalidate }
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
      }
    }
  };
});

vi.mock('../hooks/use-stuck-detection', () => ({
  useStuckDetection: vi.fn()
}));

// Stub the Terminal component — we only care about whether bootstrap was fetched.
vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal-stub" />
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ChatCliSurface } from './chat-cli-surface';

afterEach(cleanup);

beforeEach(() => {
  mockBuildCliBootstrap.mockClear();
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
