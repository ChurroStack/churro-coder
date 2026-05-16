// @vitest-environment jsdom
/**
 * Tests for CliPromptBar: slash command autocomplete and image thumbnail chips.
 * [cli-prompt-bar/slash-autocomplete] [cli-prompt-bar/image-thumbnails]
 */

const mockDispatch = vi.hoisted(() => vi.fn());
const mockWritePastedImage = vi.hoisted(() => vi.fn());
const mockWritePastedText = vi.hoisted(() => vi.fn());

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

vi.mock('../stores/sub-chat-store', () => ({
  useAgentSubChatStore: vi.fn((selector: (s: unknown) => unknown) => {
    const fakeStore = { allSubChats: [{ id: 'sc-1', harness: 'claude-cli' }] };
    return selector(fakeStore);
  })
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
  subChatClaudeThinkingAtomFamily: vi.fn(() => ({ init: 'off' }))
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtom: vi.fn((atom: unknown) => {
      if (atom && typeof atom === 'object' && 'init' in atom) {
        if ((atom as { init: string }).init === 'claude-sonnet-4-6') return ['claude-sonnet-4-6', vi.fn()];
        if ((atom as { init: string }).init === 'off') return ['off', vi.fn()];
      }
      return [undefined, vi.fn()];
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

vi.mock('../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <div onClick={onSelect}>{children}</div>
  )
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { CliPromptBar } from './cli-prompt-bar';

afterEach(() => {
  cleanup();
  capturedSlashProps = null;
  mockDispatch.mockClear();
  mockWritePastedImage.mockClear();
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
