// @vitest-environment jsdom
/**
 * Task 12.5 — harness durability through dockview re-mounts.
 * Covers the three scenarios from specs/chat-surface-router/spec.md
 * § "Harness persists through dockview panel re-mounts".
 *
 * The key invariant: a CLI panel must never render AgentsContent, even if
 * the Zustand store hasn't hydrated yet — params.harness is authoritative.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../agents/ui/agents-content', () => ({
  AgentsContent: () => <div data-testid="agents-content" />
}));

vi.mock('../../agents/ui/chat-cli-surface', () => ({
  ChatCliSurface: ({ harness }: { harness: string }) => <div data-testid="chat-cli-surface" data-harness={harness} />
}));

vi.mock('./openspec-change-panel', () => ({
  OpenSpecChangePanelContent: ({ sidebarContent }: { sidebarContent?: React.ReactNode }) => (
    <div data-testid="openspec-change-panel-content">{sidebarContent ?? null}</div>
  )
}));

vi.mock('../workspace-context', () => ({
  useDockWorkspace: () => ({ active: true })
}));

vi.mock('../../../lib/jotai-store', () => ({
  appStore: { get: () => 'workspace-1' }
}));

vi.mock('../../agents/hooks/use-sub-chat-ownership', () => ({
  useSubChatOwnership: () => ({ isOwner: true, currentOwner: null, takeOver: vi.fn() })
}));

vi.mock('../../../contexts/WindowContext', () => ({
  useWindowId: () => 'main',
  getWindowId: () => 'main'
}));

vi.mock('../../agents/hooks/use-stuck-detection', () => ({
  useStuckDetection: vi.fn()
}));

vi.mock('../../agents/ui/stall-banner', () => ({
  StallIcon: () => null,
  StallBanner: () => null
}));

vi.mock('../../agents/ui/cli-prompt-bar', () => ({
  CliPromptBar: () => <div data-testid="cli-prompt-bar" />
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      chats: {
        get: { invalidate: vi.fn() },
        getPrStatus: { invalidate: vi.fn() },
        getCurrentPlan: { invalidate: vi.fn() },
        getCurrentReview: { invalidate: vi.fn() },
        getReviewContent: { invalidate: vi.fn() }
      },
      changes: { getStatus: { invalidate: vi.fn() } },
      cliSession: { getStatus: { invalidate: vi.fn() } },
      messages: { getLatest: { invalidate: vi.fn() } }
    }),
    chats: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      getSubChatBootstrapState: { useQuery: () => ({ data: { bootstrappedAt: null }, isLoading: false }) },
      refreshWorkflowCaches: {
        useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) })
      }
    },
    cliSession: {
      relocate: { useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }) },
      reingest: { useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }) }
    },
    terminal: {
      getSession: { useQuery: () => ({ data: null, isLoading: false }) }
    }
  }
}));

vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal" />
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { ChatPanel } from './chat-panel';
import type { IDockviewPanelProps } from 'dockview-react';
import type { ChatPanelEntity } from '../atoms';

const WORKSPACE_ID = 'workspace-1';
const SUB_CHAT_ID = 'sc-remount-1';

function makeDockviewProps(overrides: Partial<ChatPanelEntity> = {}): IDockviewPanelProps<ChatPanelEntity> {
  const api = {
    id: `chat:${SUB_CHAT_ID}`,
    title: 'Test Chat',
    isActive: true,
    isVisible: true,
    onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
    setTitle: vi.fn(),
    renderer: 'always',
    setRenderer: vi.fn()
  } as unknown as IDockviewPanelProps<ChatPanelEntity>['api'];

  const containerApi = {
    onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() }))
  } as unknown as IDockviewPanelProps<ChatPanelEntity>['containerApi'];

  return {
    api,
    containerApi,
    params: { subChatId: SUB_CHAT_ID, chatId: WORKSPACE_ID, ...overrides }
  } as unknown as IDockviewPanelProps<ChatPanelEntity>;
}

function renderPanel(overrides: Partial<ChatPanelEntity> = {}) {
  const store = createStore();
  return render(
    <JotaiProvider store={store}>
      <ChatPanel {...makeDockviewProps(overrides)} />
    </JotaiProvider>
  );
}

const EMPTY_STORE = {
  chatId: WORKSPACE_ID,
  activeSubChatId: SUB_CHAT_ID,
  openSubChatIds: [SUB_CHAT_ID],
  allSubChats: [],
  splitPaneIds: [],
  splitRatios: []
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Harness persists through dockview panel re-mounts [chat-surface-router/harness-remount]', () => {
  beforeEach(() => {
    useAgentSubChatStore.setState(EMPTY_STORE as any);
  });

  afterEach(cleanup);

  test('params.harness=claude-cli → ChatCliSurface even when store is empty (drag-drop scenario)', () => {
    // Simulate re-mount: dockview passes params back but store hasn't hydrated yet
    renderPanel({ harness: 'claude-cli' });
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
    expect(screen.getByTestId('chat-cli-surface').getAttribute('data-harness')).toBe('claude-cli');
    expect(screen.queryByTestId('agents-content')).toBeNull();
  });

  test('params.harness=codex-cli → ChatCliSurface even when store is empty', () => {
    renderPanel({ harness: 'codex-cli' });
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
    expect(screen.getByTestId('chat-cli-surface').getAttribute('data-harness')).toBe('codex-cli');
    expect(screen.queryByTestId('agents-content')).toBeNull();
  });

  test('params.harness=builtin → AgentsContent (no builtin flash on CLI panels)', () => {
    renderPanel({ harness: 'builtin' });
    expect(screen.getByTestId('agents-content')).toBeTruthy();
    expect(screen.queryByTestId('chat-cli-surface')).toBeNull();
  });

  test('store fallback: no params.harness + store has claude-cli → ChatCliSurface', () => {
    // Pre-populate store with harness (simulates hydrated state from localStorage stub)
    useAgentSubChatStore.setState({
      ...EMPTY_STORE,
      allSubChats: [{ id: SUB_CHAT_ID, name: 'Test', harness: 'claude-cli' }]
    } as any);
    // Render without params.harness — old dockview snapshot without the field
    renderPanel();
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
    expect(screen.queryByTestId('agents-content')).toBeNull();
  });

  test('builtin flash regression: empty store + no params.harness → AgentsContent (acceptable default)', () => {
    // Neither params nor store has harness — falls back to builtin
    renderPanel();
    expect(screen.getByTestId('agents-content')).toBeTruthy();
    expect(screen.queryByTestId('chat-cli-surface')).toBeNull();
  });
});
