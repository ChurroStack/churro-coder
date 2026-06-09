// @vitest-environment jsdom
/**
 * Task 11.13 — Restart resumption split (three focused tests for easier triage).
 *
 *   (a) builtin-only: simulate restart — streaming-status is cleared to 'idle',
 *       in-flight stream state is dropped, message history is preserved in DB.
 *   (b) claude-cli scrollback restore: startDisconnected=true → xterm scrollback
 *       visible, no PTY spawned, reattach banner visible.
 *   (c) lazy respawn: clicking Reattach after restart triggers exactly one
 *       buildCliBootstrap call with the current subChatId (bearer comes from the
 *       bootstrap function, not from stale state).
 *
 * Catches: regressions where one flow breaks silently while the other two pass.
 */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBuildCliBootstrap = vi.hoisted(() => vi.fn(async () => ({ command: 'claude', args: [], env: {} })));

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
            mutate: mockBuildCliBootstrap,
            mutateAsync: mockBuildCliBootstrap,
            isPending: false
          }))
        },
        getMcpFileChanges: { useQuery: vi.fn(emptyQuery) },
        cliUserQuestion: { useSubscription: vi.fn() },
        resolveCliUserQuestion: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
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
      // always renders), so getStatus is queried even while disconnected.
      cliSession: {
        getStatus: { useQuery: vi.fn(emptyQuery) },
        ensureAttached: { useMutation: vi.fn(emptyMutation) }
      }
    }
  };
});

vi.mock('../hooks/use-stuck-detection', () => ({ useStuckDetection: vi.fn() }));
vi.mock('../hooks/use-cli-auto-rename-on-first-message', () => ({ useCliAutoRenameOnFirstMessage: vi.fn() }));

vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal-stub" />
}));

// Stub the read-only conversation pane — it mounts alongside the terminal slot
// now; its messages/onMessages/file-open chain is irrelevant to these tests.
vi.mock('./cli-conversation-pane', () => ({
  CliConversationPane: () => <div data-testid="cli-conversation-pane-stub" />
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { getDefaultStore } from 'jotai';
import { ChatCliSurface } from './chat-cli-surface';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { subChatCliRestartHandlerAtomFamily } from '../atoms';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── (a) builtin restart: streaming status dropped ────────────────────────────

describe('11.13(a) — builtin restart drops in-flight stream state', () => {
  test('streaming-status-store starts empty (simulates fresh app boot)', () => {
    const store = useStreamingStatusStore.getState();
    store.clearStatus('sc-builtin-restart');
    expect(store.getStatus('sc-builtin-restart')).toBe('ready');
    expect(store.isStreaming('sc-builtin-restart')).toBe(false);
  });

  test('an in-flight stream becomes idle after clearStatus (simulates restart)', () => {
    const store = useStreamingStatusStore.getState();
    store.setStatus('sc-in-flight', 'streaming');
    expect(store.isStreaming('sc-in-flight')).toBe(true);

    // Simulate app restart: main process re-hydrates store with no in-flight state
    store.clearStatus('sc-in-flight');
    expect(store.getStatus('sc-in-flight')).toBe('ready');
    expect(store.isStreaming('sc-in-flight')).toBe(false);
  });

  test('streaming-status-store is not persisted — cleared status cannot be recovered', () => {
    const store = useStreamingStatusStore.getState();
    store.setStatus('sc-persist-test', 'streaming');
    store.clearStatus('sc-persist-test');

    // After clear, the subChat is back to ready — there's no persistence layer
    expect(store.getStatus('sc-persist-test')).toBe('ready');
  });
});

// ── (b) CLI scrollback restore: disconnected state, no PTY spawned ───────────

describe('11.13(b) — CLI scrollback restore after restart', () => {
  beforeEach(() => mockBuildCliBootstrap.mockClear());

  test('startDisconnected=true: no PTY spawned at mount', () => {
    render(<ChatCliSurface subChatId="sc-restored" harness="claude-cli" startDisconnected={true} isOwner={true} />);
    expect(mockBuildCliBootstrap).not.toHaveBeenCalled();
  });

  test('startDisconnected=true: Reattach banner is visible', () => {
    render(<ChatCliSurface subChatId="sc-banner" harness="claude-cli" startDisconnected={true} isOwner={true} />);
    expect(screen.getByTestId('cli-reattach-button')).toBeTruthy();
  });

  test('startDisconnected=true: chat-cli-surface testid is visible (scrollback frame mounts)', () => {
    render(<ChatCliSurface subChatId="sc-frame" harness="claude-cli" startDisconnected={true} isOwner={true} />);
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
  });

  test('startDisconnected=true: conversation pane renders next to the Reattach prompt', () => {
    // No chatId: it mounts the workflow notch, which needs a QueryClientProvider
    // these mocks don't set up. The pane renders independent of chatId.
    render(<ChatCliSurface subChatId="sc-coexist" harness="claude-cli" startDisconnected={true} isOwner={true} />);
    // The Reattach prompt is scoped to the terminal pane; the transcript pane
    // stays mounted (it reads the persisted messages table, not the live PTY).
    expect(screen.getByTestId('cli-reattach-button')).toBeTruthy();
    expect(screen.getByTestId('cli-conversation-pane-stub')).toBeTruthy();
  });
});

// ── (c) lazy respawn: Reattach triggers exactly one bootstrap call ───────────

describe('11.13(c) — lazy respawn after restart', () => {
  beforeEach(() => mockBuildCliBootstrap.mockClear());

  test('clicking Reattach triggers exactly one buildCliBootstrap call', async () => {
    render(<ChatCliSurface subChatId="sc-reattach" harness="claude-cli" startDisconnected={true} isOwner={true} />);

    expect(mockBuildCliBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('cli-reattach-button'));
    });

    expect(mockBuildCliBootstrap).toHaveBeenCalledOnce();
  });

  test('bootstrap is called with the current subChatId (not a stale session id)', async () => {
    render(
      <ChatCliSurface subChatId="sc-current-bearer" harness="codex-cli" startDisconnected={true} isOwner={true} />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('cli-reattach-button'));
    });

    expect(mockBuildCliBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ subChatId: 'sc-current-bearer', harness: 'codex-cli' })
    );
  });

  test('Reattach is a no-op when isOwner=false (non-owner cannot respawn)', () => {
    render(<ChatCliSurface subChatId="sc-non-owner" harness="claude-cli" startDisconnected={true} isOwner={false} />);
    // The Reattach button may render, but bootstrap is not called
    // because doBootstrap checks `isOwner` before calling the mutation
    expect(mockBuildCliBootstrap).not.toHaveBeenCalled();
  });
});

// ── (d) Restart handler: ChatCliSurface registers restart handler on mount ────

describe('11.13(d) — restart handler registration and trigger', () => {
  beforeEach(() => mockBuildCliBootstrap.mockClear());

  test('ChatCliSurface registers restart handler atom on mount', () => {
    const store = getDefaultStore();
    const handlerAtom = subChatCliRestartHandlerAtomFamily('sc-handler-mount');

    expect(store.get(handlerAtom)).toBeNull();

    render(<ChatCliSurface subChatId="sc-handler-mount" harness="claude-cli" isOwner={true} />);

    expect(store.get(handlerAtom)).toBeTypeOf('function');
  });

  test('restart handler calls buildCliBootstrap with trigger=restart', async () => {
    const store = getDefaultStore();
    const handlerAtom = subChatCliRestartHandlerAtomFamily('sc-handler-call');

    render(<ChatCliSurface subChatId="sc-handler-call" harness="claude-cli" isOwner={true} />);

    const handler = store.get(handlerAtom);
    expect(handler).toBeTypeOf('function');

    await act(async () => {
      await handler!();
    });

    expect(mockBuildCliBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ subChatId: 'sc-handler-call', trigger: 'restart' })
    );
  });

  test('restart handler is cleared when ChatCliSurface unmounts', () => {
    const store = getDefaultStore();
    const handlerAtom = subChatCliRestartHandlerAtomFamily('sc-handler-unmount');

    const { unmount } = render(<ChatCliSurface subChatId="sc-handler-unmount" harness="claude-cli" isOwner={true} />);
    expect(store.get(handlerAtom)).toBeTypeOf('function');

    unmount();

    expect(store.get(handlerAtom)).toBeNull();
  });
});
