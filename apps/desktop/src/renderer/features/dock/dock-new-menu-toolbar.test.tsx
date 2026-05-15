// @vitest-environment jsdom
/**
 * Task 7.5 — DockNewMenuToolbar: clicking each entry creates the right subChat,
 * pinning/unpinning moves entries between toolbar icons and overflow dropdown.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNewSubChat = vi.fn();
const mockNewSubChatWithHarness = vi.fn();
const mockOpenTerminal = vi.fn();

vi.mock('./use-panel-actions', () => ({
  usePanelActions: () => ({
    available: true,
    canNewSubChat: true,
    canOpenTerminal: true,
    newSubChat: mockNewSubChat,
    newSubChatWithHarness: mockNewSubChatWithHarness,
    openTerminal: mockOpenTerminal,
    canOpenPlan: false,
    canOpenDiff: false,
    canOpenSearch: false,
    canOpenFilesTree: false,
    openPlan: vi.fn(),
    openDiff: vi.fn(),
    openSearch: vi.fn(),
    openFilesTree: vi.fn(),
    resetLayout: vi.fn()
  })
}));

// HarnessIcon used inside EntryIcon
vi.mock('../agents/lib/harness-icons', () => ({
  HarnessIcon: ({ harness }: { harness: string }) => <span data-testid={`harness-icon-${harness}`} />,
  HARNESS_LABELS: { builtin: 'Built-in', 'claude-cli': 'Claude CLI', 'codex-cli': 'Codex CLI' }
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { DockNewMenuToolbar } from './dock-new-menu-toolbar';
import { dockNewMenuPinnedAtom } from '../../lib/atoms';
import type { NewMenuEntryKind } from './new-menu-registry';
import { TooltipProvider } from '../../components/ui/tooltip';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderToolbar(pinned: NewMenuEntryKind[]) {
  const store = createStore();
  store.set(dockNewMenuPinnedAtom, pinned);
  return {
    store,
    ...render(
      <JotaiProvider store={store}>
        <TooltipProvider>
          <DockNewMenuToolbar />
        </TooltipProvider>
      </JotaiProvider>
    )
  };
}

describe('DockNewMenuToolbar', () => {
  test('pinned "chat" entry appears as toolbar button and calls newSubChat on click', () => {
    renderToolbar(['chat']);
    const btn = screen.getByTestId('dock-new-menu-pinned-chat');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(mockNewSubChat).toHaveBeenCalledTimes(1);
  });

  test('pinned "chat-claude-cli" calls newSubChatWithHarness("claude-cli")', () => {
    renderToolbar(['chat-claude-cli']);
    const btn = screen.getByTestId('dock-new-menu-pinned-chat-claude-cli');
    fireEvent.click(btn);
    expect(mockNewSubChatWithHarness).toHaveBeenCalledWith('claude-cli');
  });

  test('pinned "chat-codex-cli" calls newSubChatWithHarness("codex-cli")', () => {
    renderToolbar(['chat-codex-cli']);
    const btn = screen.getByTestId('dock-new-menu-pinned-chat-codex-cli');
    fireEvent.click(btn);
    expect(mockNewSubChatWithHarness).toHaveBeenCalledWith('codex-cli');
  });

  test('pinned "terminal" calls openTerminal', () => {
    renderToolbar(['terminal']);
    const btn = screen.getByTestId('dock-new-menu-pinned-terminal');
    fireEvent.click(btn);
    expect(mockOpenTerminal).toHaveBeenCalledTimes(1);
  });

  test('non-pinned entry is in overflow dropdown, not in toolbar icons', () => {
    // chat is not pinned — it should appear in the overflow dropdown only
    renderToolbar(['terminal']);
    expect(screen.queryByTestId('dock-new-menu-pinned-chat')).toBeNull();
    expect(screen.getByTestId('dock-new-menu-overflow-trigger')).toBeTruthy();
  });

  test('unpinning "chat" removes toolbar icon and adds it to overflow', () => {
    // Start with chat pinned
    const store = createStore();
    store.set(dockNewMenuPinnedAtom, ['chat', 'terminal']);
    const wrap = (node: React.ReactElement) => (
      <JotaiProvider store={store}>
        <TooltipProvider>{node}</TooltipProvider>
      </JotaiProvider>
    );
    const { rerender } = render(wrap(<DockNewMenuToolbar />));
    expect(screen.getByTestId('dock-new-menu-pinned-chat')).toBeTruthy();

    // Unpin chat
    store.set(dockNewMenuPinnedAtom, ['terminal']);
    rerender(wrap(<DockNewMenuToolbar />));
    expect(screen.queryByTestId('dock-new-menu-pinned-chat')).toBeNull();
    // Overflow trigger is present, confirming chat moved out of the toolbar
    expect(screen.getByTestId('dock-new-menu-overflow-trigger')).toBeTruthy();
  });

  test('when all entries pinned, no overflow trigger is rendered', () => {
    renderToolbar(['chat', 'chat-claude-cli', 'chat-codex-cli', 'terminal', 'openspec-change']);
    expect(screen.queryByTestId('dock-new-menu-overflow-trigger')).toBeNull();
  });
});
