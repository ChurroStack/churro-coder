// @vitest-environment jsdom
/**
 * Tests for CliPromptBar after the textarea was removed and voice became the
 * only external send path. The CLI TUI itself is the primary text input.
 *
 * Coverage:
 *   - Voice dispatch: single transcript on release.
 *   - Voice dispatch: multiple native finals batched into one CLI submission
 *     on the falling edge of isRecording/isTranscribing (R-VOICE-SPLIT).
 *   - OpenSpec prefix on voice dispatch.
 *   - Auto-rename is NOT triggered here — that lives in
 *     `useCliAutoRenameOnFirstMessage`.
 *   - OpenSpec CLI bootstrap (terminal-idle latching) still works.
 *   - Restart button + dialog.
 */

const mockDispatch = vi.hoisted(() => vi.fn());

const mockStore = vi.hoisted(() => ({
  chatId: 'chat-1' as string | null,
  allSubChats: [{ id: 'sc-1', harness: 'claude-cli', name: undefined as string | undefined }] as Array<{
    id: string;
    harness: string;
    name?: string;
  }>
}));

const mockPendingOpenSpecMsgState = vi.hoisted(() => ({
  value: null as { subChatId: string; message: string } | null
}));
const mockSetPendingOpenSpecMessage = vi.hoisted(() => vi.fn());

const mockStateSubscriptionCallbacks = vi.hoisted(() => ({
  onData: null as ((evt: { paneId: string; state: 'idle' | 'running' }) => void) | null
}));

const voiceState = vi.hoisted(() => ({
  isAvailable: true,
  isRecording: false,
  isTranscribing: false,
  audioLevel: 0,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  capturedOnTranscript: null as ((t: string) => void) | null
}));

vi.mock('../hooks/use-harness-send-dispatcher', () => ({
  useHarnessSendDispatcher: vi.fn(() => ({
    dispatch: mockDispatch,
    isCliHarness: true
  }))
}));

vi.mock('../stores/sub-chat-store', () => {
  const useAgentSubChatStore = vi.fn((selector: (s: unknown) => unknown) => {
    return selector(mockStore);
  }) as unknown as {
    (selector: (s: unknown) => unknown): unknown;
    getState: () => typeof mockStore;
  };
  useAgentSubChatStore.getState = () => mockStore;
  return { useAgentSubChatStore };
});

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    terminal: {
      state: {
        useSubscription: vi.fn(
          (
            _paneId: string,
            opts: {
              enabled?: boolean;
              onData?: (evt: { paneId: string; state: 'idle' | 'running' }) => void;
            }
          ) => {
            if (opts?.onData) mockStateSubscriptionCallbacks.onData = opts.onData;
          }
        )
      }
    }
  }
}));

vi.mock('../../../lib/hooks/use-voice-input', () => ({
  useVoiceInput: vi.fn((opts: { onTranscript?: (t: string) => void }) => {
    voiceState.capturedOnTranscript = opts.onTranscript ?? null;
    return {
      isAvailable: voiceState.isAvailable,
      isRecording: voiceState.isRecording,
      isTranscribing: voiceState.isTranscribing,
      audioLevel: voiceState.audioLevel,
      startRecording: voiceState.startRecording,
      stopRecording: voiceState.stopRecording
    };
  })
}));

vi.mock('../atoms', () => ({
  subChatModelIdAtomFamily: vi.fn(() => ({ init: 'claude-sonnet-4-6' })),
  subChatClaudeThinkingAtomFamily: vi.fn(() => ({ init: 'off' })),
  subChatCliRestartHandlerAtomFamily: vi.fn(() => ({ _tag: 'cli-restart-handler', init: null })),
  cliSplitLayoutAtomFamily: vi.fn(() => ({ _tag: 'cli-split-layout', init: 'horizontal' }))
}));

const mockOpenSpecContextState = vi.hoisted(() => ({
  value: null as { chatId: string; projectId: string; changeId: string; changePath: string } | null
}));
const mockOpenSpecCurrentStepState = vi.hoisted(() => ({
  value: 'proposal' as 'proposal' | 'design' | 'tasks'
}));

vi.mock('../../openspec/atoms', () => ({
  pendingOpenSpecMessageAtom: { _tag: 'pending-openspec-msg', init: null },
  openSpecSidebarContextAtomFamily: vi.fn(() => ({ _tag: 'openspec-context' })),
  openSpecCurrentStepAtomFamily: vi.fn(() => ({ _tag: 'openspec-current-step' }))
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtom: vi.fn((atom: unknown) => {
      if (atom && typeof atom === 'object' && '_tag' in atom) {
        if ((atom as { _tag: string })._tag === 'pending-openspec-msg') {
          return [mockPendingOpenSpecMsgState.value, mockSetPendingOpenSpecMessage];
        }
      }
      if (atom && typeof atom === 'object' && 'init' in atom) {
        if ((atom as { init: string }).init === 'claude-sonnet-4-6') return ['claude-sonnet-4-6', vi.fn()];
        if ((atom as { init: string }).init === 'off') return ['off', vi.fn()];
        if ((atom as { init: string }).init === 'horizontal') return ['horizontal', vi.fn()];
      }
      return [undefined, vi.fn()];
    }),
    useAtomValue: vi.fn((atom: unknown) => {
      if (atom && typeof atom === 'object' && '_tag' in atom) {
        const tag = (atom as { _tag: string })._tag;
        if (tag === 'openspec-context') return mockOpenSpecContextState.value;
        if (tag === 'openspec-current-step') return mockOpenSpecCurrentStepState.value;
        if (tag === 'cli-restart-handler') return null;
      }
      return undefined;
    })
  };
});

vi.mock('../lib/models', () => ({
  CLAUDE_MODELS: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', version: '4.6', thinkings: ['off', 'high'] }],
  CLI_MODEL_ALIASES: [{ id: 'opusplan', name: 'Opus Plan', version: 'auto', thinkings: ['off', 'high'] }],
  formatClaudeThinkingLabel: (level: string) => level,
  CODEX_MODELS: []
}));

vi.mock('../components/agent-send-button', () => ({
  AgentSendButton: ({
    onVoiceMouseDown,
    onVoiceMouseUp,
    disabled
  }: {
    onVoiceMouseDown: () => void;
    onVoiceMouseUp: () => void;
    disabled: boolean;
  }) => (
    <button data-testid="voice-button" disabled={disabled} onMouseDown={onVoiceMouseDown} onMouseUp={onVoiceMouseUp}>
      Mic
    </button>
  )
}));

vi.mock('./voice-wave-indicator', () => ({
  VoiceWaveIndicator: () => null
}));

vi.mock('../../../components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tooltip-content">{children}</span>
}));

vi.mock('../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <div onClick={onSelect}>{children}</div>
  )
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CliPromptBar, _resetCliAutoRenameTriggered } from './cli-prompt-bar';

function resetVoice(): void {
  voiceState.isAvailable = true;
  voiceState.isRecording = false;
  voiceState.isTranscribing = false;
  voiceState.audioLevel = 0;
  voiceState.startRecording = vi.fn();
  voiceState.stopRecording = vi.fn();
  voiceState.capturedOnTranscript = null;
}

afterEach(() => {
  cleanup();
  mockDispatch.mockClear();
  mockSetPendingOpenSpecMessage.mockClear();
  mockPendingOpenSpecMsgState.value = null;
  mockStateSubscriptionCallbacks.onData = null;
  mockOpenSpecContextState.value = null;
  mockOpenSpecCurrentStepState.value = 'proposal';
  mockStore.chatId = 'chat-1';
  mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: undefined }];
  _resetCliAutoRenameTriggered();
  resetVoice();
});

// ── No textarea ─────────────────────────────────────────────────────────────

describe('CliPromptBar — no textarea [cli-prompt-bar/no-textarea]', () => {
  it('does not render any textarea', () => {
    const { container } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('renders the voice button when voice is available and owner', () => {
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    expect(getByTestId('voice-button')).toBeTruthy();
  });

  it('hides the voice button when voice is unavailable', () => {
    voiceState.isAvailable = false;
    const { queryByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    expect(queryByTestId('voice-button')).toBeNull();
  });

  it('hides the voice button when read-only (isOwner=false)', () => {
    const { queryByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner={false} />);
    expect(queryByTestId('voice-button')).toBeNull();
  });
});

// ── Voice dispatch [cli-prompt-bar/voice-dispatch] ──────────────────────────

describe('CliPromptBar — voice dispatch [cli-prompt-bar/voice-dispatch]', () => {
  it('dispatches a single CLI message when one transcript arrives and recording ends', async () => {
    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.capturedOnTranscript?.('hello world');
    });
    expect(mockDispatch).not.toHaveBeenCalled();

    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith('hello world');
  });

  it('batches multiple native finals into ONE CLI submission on release (R-VOICE-SPLIT)', async () => {
    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.capturedOnTranscript?.('hello');
      voiceState.capturedOnTranscript?.('world');
    });
    expect(mockDispatch).not.toHaveBeenCalled();

    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith('hello world');
  });

  it('waits for transcribing to finish before flushing (OpenAI backend)', async () => {
    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.isRecording = false;
      voiceState.isTranscribing = true;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });
    expect(mockDispatch).not.toHaveBeenCalled();

    await act(async () => {
      voiceState.capturedOnTranscript?.('hello from openai');
    });

    await act(async () => {
      voiceState.isTranscribing = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith('hello from openai');
  });

  it('does not dispatch when read-only', async () => {
    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner={false} />);

    await act(async () => {
      voiceState.capturedOnTranscript?.('ignored');
    });
    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner={false} />);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('prefixes /opsx:propose when current OpenSpec tab is proposal', async () => {
    mockOpenSpecContextState.value = {
      chatId: 'chat-1',
      projectId: 'project-1',
      changeId: 'add-login',
      changePath: 'openspec/changes/add-login'
    };
    mockOpenSpecCurrentStepState.value = 'proposal';

    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.capturedOnTranscript?.('refine this proposal');
    });
    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).toHaveBeenCalledWith('/opsx:propose\nrefine this proposal');
  });

  it('prefixes /opsx:apply when current OpenSpec tab is tasks', async () => {
    mockOpenSpecContextState.value = {
      chatId: 'chat-1',
      projectId: 'project-1',
      changeId: 'add-login',
      changePath: 'openspec/changes/add-login'
    };
    mockOpenSpecCurrentStepState.value = 'tasks';

    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.capturedOnTranscript?.('fix the failing task');
    });
    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).toHaveBeenCalledWith('/opsx:apply\nfix the failing task');
  });

  it('does not prefix outside an OpenSpec editor', async () => {
    mockOpenSpecContextState.value = null;
    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.capturedOnTranscript?.('just a normal prompt');
    });
    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).toHaveBeenCalledWith('just a normal prompt');
  });

  it('does not dispatch when the buffer is empty', async () => {
    voiceState.isRecording = true;
    const { rerender } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      voiceState.isRecording = false;
      rerender(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ── OpenSpec CLI bootstrap [cli-prompt-bar/openspec-bootstrap] ──────────────

describe('CliPromptBar — openspec CLI bootstrap [cli-prompt-bar/openspec-bootstrap]', () => {
  it('dispatches pendingOpenSpecMessage and clears the atom when terminal state goes idle', async () => {
    mockPendingOpenSpecMsgState.value = {
      subChatId: 'sc-1',
      message: '/opsx:propose change-abc\n\nBuild a feature'
    };

    render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: 'cli:sc-1', state: 'idle' });
    });

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith('/opsx:propose change-abc\n\nBuild a feature');
      expect(mockSetPendingOpenSpecMessage).toHaveBeenCalledWith(null);
    });
  });

  it('does not dispatch before terminal state goes idle', () => {
    mockPendingOpenSpecMsgState.value = {
      subChatId: 'sc-1',
      message: '/opsx:propose change-abc\n\nBuild a feature'
    };

    render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockSetPendingOpenSpecMessage).not.toHaveBeenCalled();
  });

  it('does not dispatch on running state — only idle latches ready', async () => {
    mockPendingOpenSpecMsgState.value = {
      subChatId: 'sc-1',
      message: '/opsx:propose change-abc\n\nBuild a feature'
    };

    render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: 'cli:sc-1', state: 'running' });
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockSetPendingOpenSpecMessage).not.toHaveBeenCalled();
  });

  it('does not dispatch when subChatId does not match', async () => {
    mockPendingOpenSpecMsgState.value = {
      subChatId: 'sc-OTHER',
      message: '/opsx:propose change-abc\n\nBuild a feature'
    };

    render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);

    await act(async () => {
      mockStateSubscriptionCallbacks.onData?.({ paneId: 'cli:sc-1', state: 'idle' });
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockSetPendingOpenSpecMessage).not.toHaveBeenCalled();
  });
});

// ── Restart button [cli-prompt-bar/restart-button] ──────────────────────────

describe('CliPromptBar — Restart button [cli-prompt-bar/restart-button]', () => {
  it('renders Restart CLI button for claude-cli harness', () => {
    const { getByLabelText } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    expect(getByLabelText('Restart CLI')).toBeTruthy();
  });

  it('renders Restart CLI button for codex-cli harness', () => {
    const { getByLabelText } = render(<CliPromptBar subChatId="sc-1" harness="codex-cli" isOwner />);
    expect(getByLabelText('Restart CLI')).toBeTruthy();
  });

  it('Restart CLI button is disabled when isOwner=false', () => {
    const { getByLabelText } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner={false} />);
    expect((getByLabelText('Restart CLI') as HTMLButtonElement).disabled).toBe(true);
  });

  it('clicking Restart button opens a confirmation dialog', async () => {
    const { getByLabelText } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    await act(async () => {
      fireEvent.click(getByLabelText('Restart CLI'));
    });
    expect(screen.getByText(/Restart.*session\?/i)).toBeTruthy();
  });

  it('cancel button dismisses the dialog', async () => {
    const { getByLabelText } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    await act(async () => {
      fireEvent.click(getByLabelText('Restart CLI'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByText(/Restart.*session\?/i)).toBeNull();
  });
});
