// @vitest-environment jsdom
/**
 * Regression tests for DockHeaderActions — the [+] dropdown in the dockview tab strip.
 *
 * Guards the CLI harness menu items added in the harness feature so they cannot be
 * accidentally removed without a test failure. Also asserts the [+] button itself
 * is always present so the whole dropdown cannot vanish silently.
 *
 * Note: Radix UI DropdownMenuContent requires pointer-events to open, so these tests
 * use @testing-library/user-event (not fireEvent) to interact with the dropdown trigger.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider, createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNewSubChatWithHarness = vi.fn();
const mockNewSubChat = vi.fn();
const mockOpenTerminal = vi.fn();
const mockOpenPlan = vi.fn();
const mockOpenDiff = vi.fn();
const mockResetLayout = vi.fn();

vi.mock('./use-panel-actions', () => ({
  usePanelActions: () => ({
    available: true,
    canNewSubChat: true,
    canOpenPlan: true,
    canOpenDiff: true,
    canOpenTerminal: true,
    newSubChat: mockNewSubChat,
    newSubChatWithHarness: mockNewSubChatWithHarness,
    openPlan: mockOpenPlan,
    openDiff: mockOpenDiff,
    openTerminal: mockOpenTerminal,
    resetLayout: mockResetLayout
  })
}));

vi.mock('../../lib/hotkeys', () => ({
  useResolvedHotkeyDisplay: () => null
}));

vi.mock('../agents/lib/harness-icons', () => ({
  HarnessIcon: ({ harness }: { harness: string }) => <span data-testid={`harness-icon-${harness}`} />
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { DockHeaderActions } from './dock-header-actions';
import { visibleDockLaunchButtonsAtom, type DockLaunchButtonId } from '../../lib/atoms';
import { TooltipProvider } from '../../components/ui/tooltip';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Dockview passes IDockviewHeaderActionsProps — we only need the group prop.
const fakeProps = { group: {} } as any;

function renderActions(
  visible: DockLaunchButtonId[] = ['newChat', 'openPlan', 'openChanges', 'newTerminal', 'toggleDetails']
) {
  const store = createStore();
  store.set(visibleDockLaunchButtonsAtom, visible);
  return render(
    <JotaiProvider store={store}>
      <TooltipProvider>
        <DockHeaderActions {...fakeProps} />
      </TooltipProvider>
    </JotaiProvider>
  );
}

// ── [+] button always present ─────────────────────────────────────────────────

describe('DockHeaderActions — [+] button', () => {
  it('always renders the "Open a panel" dropdown trigger', () => {
    renderActions();
    expect(screen.getByRole('button', { name: /open a panel/i })).toBeTruthy();
  });
});

// ── CLI harness menu items ────────────────────────────────────────────────────

describe('DockHeaderActions — CLI harness items in dropdown', () => {
  it('dropdown contains "New Claude CLI Chat" item', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    expect(screen.getByText('New Claude CLI Chat')).toBeTruthy();
  });

  it('dropdown contains "New Codex CLI Chat" item', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    expect(screen.getByText('New Codex CLI Chat')).toBeTruthy();
  });

  it('clicking "New Claude CLI Chat" calls newSubChatWithHarness("claude-cli")', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    await user.click(screen.getByText('New Claude CLI Chat'));
    expect(mockNewSubChatWithHarness).toHaveBeenCalledWith('claude-cli');
    expect(mockNewSubChatWithHarness).toHaveBeenCalledTimes(1);
  });

  it('clicking "New Codex CLI Chat" calls newSubChatWithHarness("codex-cli")', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    await user.click(screen.getByText('New Codex CLI Chat'));
    expect(mockNewSubChatWithHarness).toHaveBeenCalledWith('codex-cli');
    expect(mockNewSubChatWithHarness).toHaveBeenCalledTimes(1);
  });

  it('CLI harness icons are rendered inside the dropdown', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    expect(screen.getByTestId('harness-icon-claude-cli')).toBeTruthy();
    expect(screen.getByTestId('harness-icon-codex-cli')).toBeTruthy();
  });
});

// ── Reset layout always present ───────────────────────────────────────────────

describe('DockHeaderActions — Reset layout', () => {
  it('dropdown always contains Reset layout item', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    expect(screen.getByText('Reset layout')).toBeTruthy();
  });

  it('clicking Reset layout calls resetLayout', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: /open a panel/i }));
    await user.click(screen.getByText('Reset layout'));
    expect(mockResetLayout).toHaveBeenCalledOnce();
  });
});
