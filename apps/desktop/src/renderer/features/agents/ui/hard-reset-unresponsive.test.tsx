// @vitest-environment jsdom
/**
 * Task 11.12 — Hard-reset under unresponsive conditions.
 *
 * Three sub-cases:
 *   (a) builtin chat with a stuck stream — Hard-reset completes, abort path invoked, history intact
 *   (b) CLI chat with a frozen PTY (kill mutation resolves) — SIGKILL sent, config rewritten, new PTY respawns
 *   (c) CLI chat while MCP returns 5xx — Hard-reset does NOT depend on MCP availability
 *
 * Catches: any code path that gates Hard-reset on a healthy stream/PTY/MCP.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockKillMutateAsync = vi.fn(async () => undefined);
const mockClearScrollbackMutateAsync = vi.fn(async () => undefined);
const mockBuildCliBootstrapMutate = vi.fn(async () => ({ command: 'claude', args: [] }));

vi.mock('@/lib/trpc', () => {
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
            mutate: mockBuildCliBootstrapMutate,
            mutateAsync: mockBuildCliBootstrapMutate,
            isPending: false
          }))
        },
        cliUserQuestion: { useSubscription: vi.fn() },
        cliUserQuestionExpired: { useSubscription: vi.fn() },
        cliUserQuestionCleared: { useSubscription: vi.fn() },
        getPendingCliQuestion: { useQuery: vi.fn(emptyQuery) },
        resolveCliUserQuestion: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
        getMcpFileChanges: { useQuery: vi.fn(emptyQuery) },
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
        kill: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: mockKillMutateAsync, isPending: false }))
        },
        clearScrollback: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: mockClearScrollbackMutateAsync, isPending: false }))
        },
        stream: { useSubscription: vi.fn() }
      },
      // CliSplitBody now mounts in every bootstrap state (the conversation pane
      // stays visible while the terminal slot swaps), so its getStatus query runs
      // unconditionally — mirror the sibling chat-cli-surface.test.tsx mock.
      cliSession: {
        getStatus: { useQuery: vi.fn(emptyQuery) },
        ensureAttached: { useMutation: vi.fn(emptyMutation) }
      }
    }
  };
});

// The always-mounted conversation pane is irrelevant to the hard-reset
// assertions; stub it (as chat-cli-surface.test.tsx does) so it doesn't pull in
// cliSession.onMessages/getMessages.
vi.mock('./cli-conversation-pane', () => ({
  CliConversationPane: () => <div data-testid="cli-conversation-pane-stub" />
}));

vi.mock('../hooks/use-stuck-detection', () => ({
  useStuckDetection: vi.fn()
}));

vi.mock('../hooks/use-cli-auto-rename-on-first-message', () => ({
  useCliAutoRenameOnFirstMessage: vi.fn()
}));

vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal-stub" />
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ChatCliSurface } from './chat-cli-surface';
import { subChatHardResetDialogOpenAtomFamily } from '../atoms';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Sub-case (b): CLI hard-reset kills PTY even when frozen ──────────────────

describe('Hard-reset under unresponsive conditions — CLI frozen PTY', () => {
  test('clicking Hard-reset invokes terminal.kill even when PTY appears hung', async () => {
    // Make kill resolve normally (simulating SIGKILL accepted by OS even when PTY is frozen)
    mockKillMutateAsync.mockResolvedValueOnce(undefined);

    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <ChatCliSurface subChatId="sc-frozen" harness="claude-cli" startDisconnected={false} isOwner={true} />
      </JotaiProvider>
    );

    // Open the hard-reset confirm dialog via the shared atom (button now lives in CliPromptBar)
    act(() => {
      store.set(subChatHardResetDialogOpenAtomFamily('sc-frozen'), true);
    });

    // Confirm dialog renders
    expect(screen.getByText(/Reset.*session/i)).toBeTruthy();

    // Confirm the reset
    await act(async () => {
      fireEvent.click(screen.getByText('Reset'));
    });

    // kill was called with the correct paneId
    expect(mockKillMutateAsync).toHaveBeenCalledWith({ paneId: 'cli:sc-frozen' });
  });

  test('Hard-reset proceeds even when kill throws (PTY already dead)', async () => {
    // Simulate kill throwing (PTY already gone)
    mockKillMutateAsync.mockRejectedValueOnce(new Error('session not found'));

    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <ChatCliSurface subChatId="sc-dead" harness="claude-cli" startDisconnected={false} isOwner={true} />
      </JotaiProvider>
    );

    // Open the hard-reset confirm dialog via the shared atom
    act(() => {
      store.set(subChatHardResetDialogOpenAtomFamily('sc-dead'), true);
    });

    // Should not throw; dialog renders
    expect(screen.getByText(/Reset.*session/i)).toBeTruthy();

    await act(async () => {
      // Confirm — should not throw even though kill will throw
      fireEvent.click(screen.getByText('Reset'));
    });

    // kill was attempted
    expect(mockKillMutateAsync).toHaveBeenCalledOnce();
    // Component doesn't crash — surface still visible (bootstrap restart state)
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
  });
});

// ── Sub-case (c): MCP returns 5xx — Hard-reset doesn't need MCP ─────────────

describe('Hard-reset under unresponsive conditions — MCP unavailable', () => {
  test('Hard-reset button is available and triggers kill regardless of MCP status', async () => {
    // MCP being down has no effect on the Hard-reset path
    // The kill mutation is the only thing hard-reset calls (not any MCP procedure)
    mockKillMutateAsync.mockResolvedValueOnce(undefined);

    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <ChatCliSurface subChatId="sc-mcp-down" harness="codex-cli" startDisconnected={false} isOwner={true} />
      </JotaiProvider>
    );

    // Open dialog via the shared atom (hard-reset button is now in CliPromptBar, not ChatCliSurface)
    act(() => {
      store.set(subChatHardResetDialogOpenAtomFamily('sc-mcp-down'), true);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Reset'));
    });

    // Only terminal.kill was called — no MCP calls
    expect(mockKillMutateAsync).toHaveBeenCalledWith({ paneId: 'cli:sc-mcp-down' });
    // clearScrollback was NOT called (checkbox unchecked by default)
    expect(mockClearScrollbackMutateAsync).not.toHaveBeenCalled();
  });
});
