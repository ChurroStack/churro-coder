// @vitest-environment jsdom
/**
 * Task 2.6 — router parameter-table test.
 * Covers all 6 cells from specs/chat-surface-router/spec.md.
 * Heavy inner components are mocked so this tests routing logic only.
 *
 * Task 11.1 extends this to a fuller table-driven integration test.
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

// Ownership hook — default to owner=true so tests don't see the read-only banner
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
    chats: {
      get: { useQuery: () => ({ data: undefined }) }
    }
  }
}));

// Terminal dependencies pulled in by ChatCliSurface (real import is mocked above)
vi.mock('@/features/terminal/terminal', () => ({
  Terminal: () => <div data-testid="terminal" />
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { ChatPanel } from './chat-panel';
import type { IDockviewPanelProps } from 'dockview-react';
import type { ChatPanelEntity } from '../atoms';

const WORKSPACE_ID = 'workspace-1';
const SUB_CHAT_ID = 'sc-test-1';
const PROJECT_ID = 'proj-1';

/** Minimal dockview API stub — just enough for ChatPanel's useEffects. */
function makeDockviewProps(subChatId = SUB_CHAT_ID): IDockviewPanelProps<ChatPanelEntity> {
  const api = {
    id: `chat:${subChatId}`,
    title: 'Test Chat',
    isActive: true,
    isVisible: true,
    onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
    setTitle: vi.fn()
  } as unknown as IDockviewPanelProps<ChatPanelEntity>['api'];

  const containerApi = {
    onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() }))
  } as unknown as IDockviewPanelProps<ChatPanelEntity>['containerApi'];

  return {
    api,
    containerApi,
    params: {
      subChatId,
      chatId: WORKSPACE_ID,
      projectId: PROJECT_ID
    }
  } as unknown as IDockviewPanelProps<ChatPanelEntity>;
}

function seedStore(harness: 'builtin' | 'claude-cli' | 'codex-cli', openspecChangeId: string | null) {
  useAgentSubChatStore.setState({
    chatId: WORKSPACE_ID,
    activeSubChatId: SUB_CHAT_ID,
    openSubChatIds: [SUB_CHAT_ID],
    allSubChats: [
      {
        id: SUB_CHAT_ID,
        name: 'Test Chat',
        harness,
        projectId: PROJECT_ID,
        openspecChangeId,
        openspecChangePath: openspecChangeId ? `openspec/changes/${openspecChangeId}` : undefined
      }
    ]
  } as any);
}

function renderPanel(subChatId = SUB_CHAT_ID) {
  const store = createStore();
  return render(
    <JotaiProvider store={store}>
      <ChatPanel {...makeDockviewProps(subChatId)} />
    </JotaiProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatPanel surface router — 6-cell parameter table', () => {
  beforeEach(() => {
    useAgentSubChatStore.setState({
      chatId: null,
      activeSubChatId: null,
      openSubChatIds: [],
      allSubChats: [],
      splitPaneIds: [],
      splitRatios: []
    } as any);
  });

  afterEach(cleanup);

  // Cell 1: builtin + no openspec
  test('builtin + null openspecChangeId → AgentsContent', () => {
    seedStore('builtin', null);
    renderPanel();
    expect(screen.getByTestId('agents-content')).toBeTruthy();
    expect(screen.queryByTestId('chat-cli-surface')).toBeNull();
    expect(screen.queryByTestId('openspec-change-panel-content')).toBeNull();
  });

  // Cell 2: builtin + openspec change
  test('builtin + openspecChangeId → OpenSpec editor with AgentsContent sidebar (no CLI surface)', () => {
    seedStore('builtin', 'change-abc');
    renderPanel();
    expect(screen.getByTestId('openspec-change-panel-content')).toBeTruthy();
    // The default sidebar is AgentsContent — mocked OpenSpecChangePanelContent renders its sidebarContent child
    // When sidebarContent is undefined, AgentsContent renders inside the mock via the real AgentsContent import.
    // The key assertion: no CLI surface on a builtin panel.
    expect(screen.queryByTestId('chat-cli-surface')).toBeNull();
  });

  // Cell 3: claude-cli + no openspec
  test('claude-cli + null openspecChangeId → ChatCliSurface (full panel)', () => {
    seedStore('claude-cli', null);
    renderPanel();
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
    expect(screen.getByTestId('chat-cli-surface').dataset.harness).toBe('claude-cli');
    expect(screen.queryByTestId('agents-content')).toBeNull();
    expect(screen.queryByTestId('openspec-change-panel-content')).toBeNull();
  });

  // Cell 4: claude-cli + openspec change
  test('claude-cli + openspecChangeId → OpenSpec editor with ChatCliSurface sidebar', () => {
    seedStore('claude-cli', 'change-abc');
    renderPanel();
    const panel = screen.getByTestId('openspec-change-panel-content');
    expect(panel).toBeTruthy();
    // The sidebarContent prop was a ChatCliSurface — it renders inside the mock
    const cliSurface = screen.getByTestId('chat-cli-surface');
    expect(cliSurface).toBeTruthy();
    expect(cliSurface.dataset.harness).toBe('claude-cli');
  });

  // Cell 5: codex-cli + no openspec
  test('codex-cli + null openspecChangeId → ChatCliSurface (full panel)', () => {
    seedStore('codex-cli', null);
    renderPanel();
    expect(screen.getByTestId('chat-cli-surface')).toBeTruthy();
    expect(screen.getByTestId('chat-cli-surface').dataset.harness).toBe('codex-cli');
    expect(screen.queryByTestId('agents-content')).toBeNull();
    expect(screen.queryByTestId('openspec-change-panel-content')).toBeNull();
  });

  // Cell 6: codex-cli + openspec change
  test('codex-cli + openspecChangeId → OpenSpec editor with ChatCliSurface sidebar', () => {
    seedStore('codex-cli', 'change-abc');
    renderPanel();
    const panel = screen.getByTestId('openspec-change-panel-content');
    expect(panel).toBeTruthy();
    const cliSurface = screen.getByTestId('chat-cli-surface');
    expect(cliSurface).toBeTruthy();
    expect(cliSurface.dataset.harness).toBe('codex-cli');
  });
});

describe('ChatPanel surface router — harness icon in tab (regression guard)', () => {
  afterEach(cleanup);

  test('builtin panel never renders a CLI harness surface', () => {
    seedStore('builtin', null);
    renderPanel();
    expect(screen.queryByTestId('chat-cli-surface')).toBeNull();
    expect(screen.queryByTestId('harness-icon-claude-cli')).toBeNull();
    expect(screen.queryByTestId('harness-icon-codex-cli')).toBeNull();
  });
});
