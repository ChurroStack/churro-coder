// @vitest-environment jsdom
/**
 * Tests for CliPromptBar: slash command autocomplete and image thumbnail chips.
 * [cli-prompt-bar/slash-autocomplete] [cli-prompt-bar/image-thumbnails]
 */

const mockDispatch = vi.hoisted(() => vi.fn());
const mockWritePastedImage = vi.hoisted(() => vi.fn());
const mockWritePastedText = vi.hoisted(() => vi.fn());
const mockAutoRenameDispatcher = vi.hoisted(() => vi.fn());
const mockStore = vi.hoisted(() => ({
  chatId: 'chat-1' as string | null,
  allSubChats: [{ id: 'sc-1', harness: 'claude-cli', name: undefined as string | undefined }] as Array<{
    id: string;
    harness: string;
    name?: string;
  }>
}));

// Mutable state for openspec-bootstrap tests — readable inside vi.mock factory closures
const mockPendingOpenSpecMsgState = vi.hoisted(() => ({
  value: null as { subChatId: string; message: string } | null
}));
const mockSetPendingOpenSpecMessage = vi.hoisted(() => vi.fn());
// Callback registered by trpc.terminal.state.useSubscription — tests call it to simulate idle
const mockStateSubscriptionCallbacks = vi.hoisted(() => ({
  onData: null as ((evt: { paneId: string; state: 'idle' | 'running' }) => void) | null
}));

// Capture the AgentsSlashCommand props so tests can inspect and trigger it
let capturedSlashProps: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (cmd: { name: string; category: string }) => void;
  searchText: string;
} | null = null;

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

vi.mock('../hooks/use-auto-rename-dispatcher', () => ({
  useAgentAutoRenameDispatcher: vi.fn(() => mockAutoRenameDispatcher)
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    files: {
      writePastedImage: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockWritePastedImage,
          isPending: false
        }))
      },
      writePastedText: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockWritePastedText,
          isPending: false
        }))
      }
    },
    commands: {
      list: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false }))
      }
    },
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
  useVoiceInput: vi.fn(() => ({
    isAvailable: false,
    isRecording: false,
    isTranscribing: false,
    audioLevel: 0,
    startRecording: vi.fn(),
    stopRecording: vi.fn()
  }))
}));

vi.mock('../atoms', () => ({
  subChatModelIdAtomFamily: vi.fn(() => ({ init: 'claude-sonnet-4-6' })),
  subChatClaudeThinkingAtomFamily: vi.fn(() => ({ init: 'off' })),
  subChatCliRestartHandlerAtomFamily: vi.fn(() => ({ _tag: 'cli-restart-handler', init: null }))
}));

// Mutable state for openspec context/step tests — readable inside vi.mock factory closures
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

vi.mock('../commands', () => ({
  AgentsSlashCommand: (props: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (cmd: { name: string; category: string }) => void;
    searchText: string;
  }) => {
    capturedSlashProps = props;
    if (!props.isOpen) return null;
    return (
      <div data-testid="slash-dropdown">
        <div data-testid="slash-search">{props.searchText}</div>
        <button data-testid="slash-select-plan" onClick={() => props.onSelect({ name: 'plan', category: 'builtin' })}>
          /plan
        </button>
        <button
          data-testid="slash-select-review"
          onClick={() => props.onSelect({ name: 'review', category: 'builtin' })}>
          /review
        </button>
      </div>
    );
  },
  BUILTIN_SLASH_COMMANDS: [
    { id: 'builtin:plan', name: 'plan', command: '/plan', description: 'Plan mode', category: 'builtin' }
  ]
}));

vi.mock('../lib/models', () => ({
  CLAUDE_MODELS: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', version: '4.6', thinkings: ['off', 'high'] }],
  formatClaudeThinkingLabel: (level: string) => level,
  CODEX_MODELS: []
}));

vi.mock('../components/agent-send-button', () => ({
  AgentSendButton: ({
    onClick,
    hasContent,
    disabled
  }: {
    onClick: () => void;
    hasContent: boolean;
    disabled: boolean;
  }) => (
    <button data-testid="send-button" onClick={onClick} disabled={disabled} data-has-content={String(hasContent)}>
      Send
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

afterEach(() => {
  cleanup();
  capturedSlashProps = null;
  mockDispatch.mockClear();
  mockWritePastedImage.mockClear();
  mockSetPendingOpenSpecMessage.mockClear();
  mockAutoRenameDispatcher.mockClear();
  mockPendingOpenSpecMsgState.value = null;
  mockStateSubscriptionCallbacks.onData = null;
  mockOpenSpecContextState.value = null;
  mockOpenSpecCurrentStepState.value = 'proposal';
  mockStore.chatId = 'chat-1';
  mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: undefined }];
  _resetCliAutoRenameTriggered();
});

describe('CliPromptBar — slash command autocomplete [cli-prompt-bar/slash-autocomplete]', () => {
  it('shows slash dropdown when input starts with /', () => {
    const { getByTestId, queryByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    expect(queryByTestId('slash-dropdown')).toBeNull();

    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: '/p' } });

    expect(getByTestId('slash-dropdown')).toBeTruthy();
    expect(getByTestId('slash-search').textContent).toBe('p');
  });

  it('hides slash dropdown when text is not a bare /command', () => {
    const { getByTestId, queryByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);

    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: '/plan' } });
    expect(getByTestId('slash-dropdown')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: '/plan some extra text' } });
    expect(queryByTestId('slash-dropdown')).toBeNull();
  });

  it('selecting /plan dispatches /plan and clears input', () => {
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);

    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: '/p' } });
    fireEvent.click(getByTestId('slash-select-plan'));

    expect(mockDispatch).toHaveBeenCalledWith('/plan');
    // Textarea should be cleared
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('selecting /review (prompt command) inserts text instead of dispatching', () => {
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);

    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: '/r' } });
    fireEvent.click(getByTestId('slash-select-review'));

    expect(mockDispatch).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('/review ');
  });

  it('Escape closes the slash dropdown', () => {
    const { getByTestId, queryByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);

    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(getByTestId('slash-dropdown')).toBeTruthy();

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(queryByTestId('slash-dropdown')).toBeNull();
  });
});

describe('CliPromptBar — image thumbnail chips [cli-prompt-bar/image-thumbnails]', () => {
  beforeEach(() => {
    mockWritePastedImage.mockResolvedValue({ filePath: '/tmp/sub-chats/sc-1/pasted-abc.png' });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn()
    });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'test-uuid-1') });
  });

  it('shows a thumbnail chip after pasting an image', async () => {
    const { getByTestId, queryByRole } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);

    const textarea = getByTestId('cli-prompt-input');

    const file = new File([''], 'screenshot.png', { type: 'image/png' });
    const clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
      getData: () => ''
    };

    await act(async () => {
      fireEvent.paste(textarea, { clipboardData });
    });

    await waitFor(() => {
      const img = queryByRole('img') as HTMLImageElement | null;
      expect(img).toBeTruthy();
    });
  });

  it('clicking X on a chip removes it from the DOM', async () => {
    const { getByTestId, queryByRole, getByLabelText } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);

    const textarea = getByTestId('cli-prompt-input');
    const file = new File([''], 'screenshot.png', { type: 'image/png' });
    const clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
      getData: () => ''
    };

    await act(async () => {
      fireEvent.paste(textarea, { clipboardData });
    });

    await waitFor(() => expect(queryByRole('img')).toBeTruthy());

    const removeBtn = getByLabelText('Remove image');
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(queryByRole('img')).toBeNull();
  });

  it('on send, prepends @path refs before the user text', async () => {
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    const textarea = getByTestId('cli-prompt-input');

    const file = new File([''], 'screenshot.png', { type: 'image/png' });
    const clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
      getData: () => ''
    };

    await act(async () => {
      fireEvent.paste(textarea, { clipboardData });
    });

    await waitFor(() => expect(mockWritePastedImage).toHaveBeenCalled());

    fireEvent.change(textarea, { target: { value: 'what is this?' } });
    fireEvent.click(getByTestId('send-button'));

    expect(mockDispatch).toHaveBeenCalledWith('@/tmp/sub-chats/sc-1/pasted-abc.png\nwhat is this?');
  });
});

describe('CliPromptBar — openspec tab prefix [cli-prompt-bar/openspec-tab-prefix]', () => {
  beforeEach(() => {
    mockOpenSpecContextState.value = {
      chatId: 'chat-1',
      projectId: 'project-1',
      changeId: 'add-login',
      changePath: 'openspec/changes/add-login'
    };
  });

  it('prefixes /opsx:propose when current tab is proposal (Enter)', () => {
    mockOpenSpecCurrentStepState.value = 'proposal';
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: 'refine this proposal' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenCalledWith('/opsx:propose\nrefine this proposal');
  });

  it('prefixes /opsx:propose when current tab is design (Send button)', () => {
    mockOpenSpecCurrentStepState.value = 'design';
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: 'update the architecture' } });
    fireEvent.click(getByTestId('send-button'));
    expect(mockDispatch).toHaveBeenCalledWith('/opsx:propose\nupdate the architecture');
  });

  it('prefixes /opsx:apply when current tab is tasks (Enter)', () => {
    mockOpenSpecCurrentStepState.value = 'tasks';
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: 'fix the failing task' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenCalledWith('/opsx:apply\nfix the failing task');
  });

  it('skips prefix when the user already typed a slash command', () => {
    mockOpenSpecCurrentStepState.value = 'tasks';
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: '/clear' } });
    // /clear matches bare-/command regex, so the slash dropdown opens — close it and submit
    fireEvent.keyDown(textarea, { key: 'Escape' });
    fireEvent.click(getByTestId('send-button'));
    expect(mockDispatch).toHaveBeenCalledWith('/clear');
  });

  it('does not prefix outside an OpenSpec editor', () => {
    mockOpenSpecContextState.value = null;
    mockOpenSpecCurrentStepState.value = 'tasks';
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" />);
    const textarea = getByTestId('cli-prompt-input');
    fireEvent.change(textarea, { target: { value: 'just a normal prompt' } });
    fireEvent.click(getByTestId('send-button'));
    expect(mockDispatch).toHaveBeenCalledWith('just a normal prompt');
  });
});

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

// ── Restart button [cli-prompt-bar/restart-button] ───────────────────────────

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

// ── Auto-rename on first send [cli-prompt-bar/auto-rename] ──────────────────

describe('CliPromptBar — auto-rename on first user send [cli-prompt-bar/auto-rename]', () => {
  it('fires the rename dispatcher on the first user submit when the persisted name is missing', () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: undefined }];
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    const textarea = getByTestId('cli-prompt-input');

    fireEvent.change(textarea, { target: { value: 'Build me a feature' } });
    fireEvent.click(getByTestId('send-button'));

    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
    expect(mockAutoRenameDispatcher).toHaveBeenCalledWith('Build me a feature', 'sc-1');
  });

  it("fires when persisted name is the 'New Chat' placeholder (hydration fallback casing)", () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: 'New Chat' }];
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    fireEvent.change(getByTestId('cli-prompt-input'), { target: { value: 'first message' } });
    fireEvent.click(getByTestId('send-button'));
    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
  });

  it("also fires when persisted name is the 'New chat' placeholder (form-save casing)", () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: 'New chat' }];
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    fireEvent.change(getByTestId('cli-prompt-input'), { target: { value: 'first message' } });
    fireEvent.click(getByTestId('send-button'));
    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the persisted name is a real title', () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: 'Refactor billing flow' }];
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    fireEvent.change(getByTestId('cli-prompt-input'), { target: { value: 'another message' } });
    fireEvent.click(getByTestId('send-button'));
    expect(mockAutoRenameDispatcher).not.toHaveBeenCalled();
  });

  it('does NOT fire a second time for the same sub-chat (module-level gate)', () => {
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: undefined }];
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    const textarea = getByTestId('cli-prompt-input');

    fireEvent.change(textarea, { target: { value: 'first message' } });
    fireEvent.click(getByTestId('send-button'));
    fireEvent.change(textarea, { target: { value: 'second message' } });
    fireEvent.click(getByTestId('send-button'));

    expect(mockAutoRenameDispatcher).toHaveBeenCalledTimes(1);
    expect(mockAutoRenameDispatcher).toHaveBeenCalledWith('first message', 'sc-1');
  });

  it('does NOT fire when parentChatId is null (store not hydrated yet)', () => {
    mockStore.chatId = null;
    mockStore.allSubChats = [{ id: 'sc-1', harness: 'claude-cli', name: undefined }];
    const { getByTestId } = render(<CliPromptBar subChatId="sc-1" harness="claude-cli" isOwner />);
    fireEvent.change(getByTestId('cli-prompt-input'), { target: { value: 'first message' } });
    fireEvent.click(getByTestId('send-button'));
    expect(mockAutoRenameDispatcher).not.toHaveBeenCalled();
  });
});
