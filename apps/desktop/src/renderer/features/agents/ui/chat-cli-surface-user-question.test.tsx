// @vitest-environment jsdom
/**
 * Tests for the CLI user-input question widget in ChatCliSurface.
 * When the MCP request_user_input tool is called, the AgentUserQuestion widget
 * should appear above the CLI prompt bar and send answers back via tRPC.
 */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBuildCliBootstrapMutate = vi.fn();
const mockResolveCliUserQuestionMutate = vi.fn();

// Capture the cliUserQuestion subscription onData callback so tests can fire events
let capturedCliQuestionOnData: ((event: unknown) => void) | null = null;

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
        cliUserQuestion: {
          useSubscription: vi.fn((_subChatId: string, opts: { onData?: (event: unknown) => void }) => {
            if (opts?.onData) capturedCliQuestionOnData = opts.onData;
          })
        },
        resolveCliUserQuestion: {
          useMutation: vi.fn(() => ({
            mutate: mockResolveCliUserQuestionMutate,
            isPending: false
          }))
        },
        get: { useQuery: vi.fn(emptyQuery) },
        getSubChat: { useQuery: vi.fn(emptyQuery) },
        updateSubChatMode: { useMutation: vi.fn(emptyMutation) },
        getCurrentPlan: { useQuery: vi.fn(emptyQuery) },
        getCurrentReview: { useQuery: vi.fn(emptyQuery) },
        getCurrentTasks: { useQuery: vi.fn(emptyQuery) },
        getPrStatus: { useQuery: vi.fn(emptyQuery) },
        getMcpFileChanges: { useQuery: vi.fn(emptyQuery) }
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
      // stays visible while the terminal slot swaps), so its getStatus query runs
      // unconditionally — mirror the sibling chat-cli-surface.test.tsx mock.
      cliSession: {
        getStatus: { useQuery: vi.fn(emptyQuery) },
        ensureAttached: { useMutation: vi.fn(emptyMutation) }
      }
    }
  };
});

// The always-mounted conversation pane is irrelevant to the user-question widget
// assertions; stub it (as chat-cli-surface.test.tsx does) so it doesn't pull in
// cliSession.onMessages/getMessages.
vi.mock('./cli-conversation-pane', () => ({
  CliConversationPane: () => <div data-testid="cli-conversation-pane-stub" />
}));

vi.mock('@/lib/hooks/use-file-change-listener', () => ({ useFileChangeListener: vi.fn() }));
vi.mock('../hooks/use-stuck-detection', () => ({ useStuckDetection: vi.fn() }));
vi.mock('../hooks/use-cli-auto-rename-on-first-message', () => ({ useCliAutoRenameOnFirstMessage: vi.fn() }));
vi.mock('../hooks/use-harness-send-dispatcher', () => ({
  markMcpInjected: vi.fn(),
  forgetMcpInjected: vi.fn(),
  useHarnessSendDispatcher: vi.fn(() => ({
    dispatch: vi.fn(),
    dispatchBuildPlan: vi.fn(),
    dispatchFixReviewIssues: vi.fn(),
    dispatchReview: vi.fn(),
    isCliHarness: true,
    harness: 'claude-cli'
  }))
}));

vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal-stub" />
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ChatCliSurface } from './chat-cli-surface';

const TEST_SUB_CHAT_ID = 'sub-q-test';

const SAMPLE_QUESTION_EVENT = {
  requestId: 'req-abc-123',
  subChatId: TEST_SUB_CHAT_ID,
  questions: [
    {
      question: 'Which language do you prefer?',
      header: 'Language',
      options: [
        { label: 'TypeScript', description: 'Typed superset of JS' },
        { label: 'JavaScript', description: 'Dynamic language' }
      ],
      multiSelect: false
    }
  ]
};

beforeEach(() => {
  capturedCliQuestionOnData = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function renderSurface() {
  const store = createStore();
  render(
    <JotaiProvider store={store}>
      <ChatCliSurface
        subChatId={TEST_SUB_CHAT_ID}
        harness="claude-cli"
        chatId="chat-parent-1"
        startDisconnected={true}
        isOwner={true}
      />
    </JotaiProvider>
  );
  return { store };
}

describe('CLI user-input widget [cli/request-user-input]', () => {
  test('AgentUserQuestion renders when cliUserQuestion subscription fires', async () => {
    renderSurface();

    // Before event — no question visible
    expect(screen.queryByText('Which language do you prefer?')).toBeNull();

    // Fire the subscription event
    act(() => {
      capturedCliQuestionOnData?.(SAMPLE_QUESTION_EVENT);
    });

    // Widget should appear with the question text and options
    await waitFor(() => {
      expect(screen.getByText('Which language do you prefer?')).toBeTruthy();
    });
    expect(screen.getByText('TypeScript')).toBeTruthy();
    expect(screen.getByText('JavaScript')).toBeTruthy();
  });

  test('selecting an option and submitting calls resolveCliUserQuestion with answers', async () => {
    renderSurface();

    act(() => {
      capturedCliQuestionOnData?.(SAMPLE_QUESTION_EVENT);
    });

    await waitFor(() => {
      expect(screen.getByText('TypeScript')).toBeTruthy();
    });

    // Click TypeScript option
    fireEvent.click(screen.getByText('TypeScript'));

    // Click Submit button
    const submitButton = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submitButton);

    expect(mockResolveCliUserQuestionMutate).toHaveBeenCalledWith({
      requestId: SAMPLE_QUESTION_EVENT.requestId,
      answers: { 'Which language do you prefer?': 'TypeScript' },
      skip: undefined
    });
  });

  test('clicking Skip All calls resolveCliUserQuestion with skip: true', async () => {
    renderSurface();

    act(() => {
      capturedCliQuestionOnData?.(SAMPLE_QUESTION_EVENT);
    });

    await waitFor(() => {
      expect(screen.getByText('Which language do you prefer?')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /skip all/i }));

    expect(mockResolveCliUserQuestionMutate).toHaveBeenCalledWith({
      requestId: SAMPLE_QUESTION_EVENT.requestId,
      skip: true
    });
  });

  test('widget disappears after answering', async () => {
    renderSurface();

    act(() => {
      capturedCliQuestionOnData?.(SAMPLE_QUESTION_EVENT);
    });

    await waitFor(() => {
      expect(screen.getByText('Which language do you prefer?')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('TypeScript'));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.queryByText('Which language do you prefer?')).toBeNull();
    });
  });
});
