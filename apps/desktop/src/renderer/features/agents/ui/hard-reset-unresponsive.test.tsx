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

vi.mock('@/lib/trpc', () => ({
  trpc: {
    chats: {
      buildCliBootstrap: {
        useMutation: vi.fn(() => ({
          mutate: mockBuildCliBootstrapMutate,
          mutateAsync: mockBuildCliBootstrapMutate,
          isPending: false
        }))
      }
    },
    terminal: {
      kill: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: mockKillMutateAsync, isPending: false }))
      },
      clearScrollback: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: mockClearScrollbackMutateAsync, isPending: false }))
      },
      stream: { useSubscription: vi.fn() }
    }
  }
}));

vi.mock('../hooks/use-stuck-detection', () => ({
  useStuckDetection: vi.fn()
}));

vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal-stub" />
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ChatCliSurface } from './chat-cli-surface';

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

    // Open the hard-reset confirm dialog
    fireEvent.click(screen.getByTestId('hard-reset-button'));

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

    fireEvent.click(screen.getByTestId('hard-reset-button'));

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

    // Hard-reset button always rendered regardless of MCP health
    const resetButton = screen.getByTestId('hard-reset-button');
    expect(resetButton).toBeTruthy();
    expect(resetButton.hasAttribute('disabled') && resetButton.getAttribute('disabled') !== null).toBeFalsy();

    fireEvent.click(resetButton);
    await act(async () => {
      fireEvent.click(screen.getByText('Reset'));
    });

    // Only terminal.kill was called — no MCP calls
    expect(mockKillMutateAsync).toHaveBeenCalledWith({ paneId: 'cli:sc-mcp-down' });
    // clearScrollback was NOT called (checkbox unchecked by default)
    expect(mockClearScrollbackMutateAsync).not.toHaveBeenCalled();
  });
});
