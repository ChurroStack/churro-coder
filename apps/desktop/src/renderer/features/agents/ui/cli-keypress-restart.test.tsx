// @vitest-environment jsdom
// Regression test: the in-terminal "[Press any key to restart]" affordance must
// run the SAME kill + rebootstrap('restart') path as the Restart button, so a
// dead CLI pane relaunches the correct binary (never a bare default shell) and
// re-sends the first prompt. Before the fix, the keypress called the generic
// Terminal.restartTerminal() which re-attaches WITHOUT a bootstrap.

import type { TerminalProps } from '@/features/terminal/types';

// Captures the props the surface passes to <Terminal> (rendered only in the
// 'ready' state) so the test can invoke onExitedKeyPress directly.
const terminalProps = vi.hoisted(() => ({ last: null as TerminalProps | null }));
const mockBuildMutate = vi.hoisted(() => vi.fn());
const mockKillMutateAsync = vi.hoisted(() => vi.fn(async () => undefined));

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
        // Drive the surface to 'ready' by invoking onSuccess synchronously with a
        // bootstrap result (no `kind` ⇒ success), so <Terminal> renders and we can
        // grab onExitedKeyPress.
        buildCliBootstrap: {
          useMutation: vi.fn((opts?: { onSuccess?: (r: unknown) => void }) => ({
            mutate: (input: unknown) => {
              mockBuildMutate(input);
              opts?.onSuccess?.({ command: 'claude', args: [] });
            },
            mutateAsync: vi.fn(),
            isPending: false
          }))
        },
        cliUserQuestion: { useSubscription: vi.fn() },
        cliUserQuestionExpired: { useSubscription: vi.fn() },
        cliUserQuestionCleared: { useSubscription: vi.fn() },
        getPendingCliQuestion: { useQuery: vi.fn(emptyQuery) },
        resolveCliUserQuestion: { useMutation: vi.fn(emptyMutation) },
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
        clearScrollback: { useMutation: vi.fn(emptyMutation) },
        stream: { useSubscription: vi.fn() }
      },
      cliSession: {
        getStatus: { useQuery: vi.fn(() => ({ data: undefined, isLoading: false, isSuccess: false })) },
        ensureAttached: { useMutation: vi.fn(emptyMutation) }
      }
    }
  };
});

vi.mock('../hooks/use-stuck-detection', () => ({ useStuckDetection: vi.fn() }));
vi.mock('../hooks/use-cli-auto-rename-on-first-message', () => ({
  useCliAutoRenameOnFirstMessage: vi.fn()
}));

vi.mock('@/features/terminal/terminal', () => ({
  Terminal: (props: TerminalProps) => {
    terminalProps.last = props;
    return <div data-testid="terminal-stub" />;
  }
}));

vi.mock('./cli-conversation-pane', () => ({
  CliConversationPane: () => <div data-testid="cli-conversation-pane-stub" />
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { ChatCliSurface } from './chat-cli-surface';
import { subChatCliRestartHandlerAtomFamily } from '../atoms';

afterEach(cleanup);

beforeEach(() => {
  terminalProps.last = null;
  mockBuildMutate.mockClear();
  mockKillMutateAsync.mockClear();
});

async function mountReady(subChatId: string, harness: 'claude-cli' | 'codex-cli') {
  // No chatId → skips the workflow notch (needs a QueryClientProvider). The
  // terminal slot reaches 'ready' on mount via the initial bootstrap.
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<ChatCliSurface subChatId={subChatId} harness={harness} />);
  });
  return utils;
}

describe('CLI keypress restart [cli-keypress-restart]', () => {
  it('claude-cli: onExitedKeyPress runs kill + buildCliBootstrap(trigger=restart)', async () => {
    await mountReady('sc-keypress', 'claude-cli');

    // Initial bootstrap fetched once with trigger=initial.
    expect(mockBuildMutate).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'initial' }));
    expect(terminalProps.last?.onExitedKeyPress).toBeTypeOf('function');

    mockBuildMutate.mockClear();
    await act(async () => {
      terminalProps.last!.onExitedKeyPress!();
    });

    // PTY killed by stable pane id, then a fresh restart bootstrap re-spawns the CLI.
    expect(mockKillMutateAsync).toHaveBeenCalledWith({ paneId: 'cli:sc-keypress' });
    expect(mockBuildMutate).toHaveBeenCalledWith(
      expect.objectContaining({ subChatId: 'sc-keypress', harness: 'claude-cli', trigger: 'restart' })
    );
  });

  it('codex-cli: onExitedKeyPress runs kill + buildCliBootstrap(trigger=restart)', async () => {
    await mountReady('sc-codex', 'codex-cli');
    expect(terminalProps.last?.onExitedKeyPress).toBeTypeOf('function');

    mockBuildMutate.mockClear();
    await act(async () => {
      terminalProps.last!.onExitedKeyPress!();
    });

    expect(mockKillMutateAsync).toHaveBeenCalledWith({ paneId: 'cli:sc-codex' });
    expect(mockBuildMutate).toHaveBeenCalledWith(
      expect.objectContaining({ subChatId: 'sc-codex', harness: 'codex-cli', trigger: 'restart' })
    );
  });

  it('button path (registered restart handler) runs the SAME kill + restart logic', async () => {
    await mountReady('sc-shared', 'claude-cli');

    // The Restart button reads this atom-registered handler.
    const registered = getDefaultStore().get(subChatCliRestartHandlerAtomFamily('sc-shared'));
    expect(registered).toBeTypeOf('function');

    mockBuildMutate.mockClear();
    await act(async () => {
      await registered!();
    });

    expect(mockKillMutateAsync).toHaveBeenCalledWith({ paneId: 'cli:sc-shared' });
    expect(mockBuildMutate).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'restart' }));
  });
});
