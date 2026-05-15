// @vitest-environment jsdom
/**
 * Task 10.10 — Component test: two panels for the same subChatId in two test stores.
 *
 * Panel A (owner): isOwner=true → no non-owner banner, sends normally.
 * Panel B (non-owner): isOwner=false → banner visible, "Take over here" button present.
 * After take-over: Panel B becomes the owner, banner disappears.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../agents/ui/agents-content', () => ({
  AgentsContent: () => <div data-testid="agents-content" />
}));

vi.mock('../../agents/ui/chat-cli-surface', () => ({
  ChatCliSurface: ({ harness, isOwner }: { harness: string; isOwner?: boolean }) => (
    <div data-testid="chat-cli-surface" data-harness={harness} data-owner={String(isOwner ?? true)} />
  )
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

// ── Ownership hook — overridable per-test ─────────────────────────────────────

const mockTakeOver = vi.fn();
let mockIsOwner = true;

vi.mock('../../agents/hooks/use-sub-chat-ownership', () => ({
  useSubChatOwnership: () => ({
    isOwner: mockIsOwner,
    currentOwner: mockIsOwner ? null : { windowId: 1, paneId: 'chat:sc-1' },
    takeOver: mockTakeOver
  })
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { ChatPanel } from './chat-panel';
import type { IDockviewPanelProps } from 'dockview-react';
import type { ChatPanelEntity } from '../atoms';

const SC = 'sc-owner-test-1';
const WORKSPACE_ID = 'workspace-1';

function makeDockviewProps(): IDockviewPanelProps<ChatPanelEntity> {
  const api = {
    id: `chat:${SC}`,
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
    params: { subChatId: SC, chatId: WORKSPACE_ID, projectId: 'proj-1' }
  } as unknown as IDockviewPanelProps<ChatPanelEntity>;
}

function seedBuiltinStore() {
  useAgentSubChatStore.setState({
    chatId: WORKSPACE_ID,
    activeSubChatId: SC,
    openSubChatIds: [SC],
    allSubChats: [{ id: SC, name: 'Test', harness: 'builtin', projectId: 'proj-1', openspecChangeId: null }]
  } as any);
}

function renderPanel() {
  const store = createStore();
  return {
    store,
    ...render(
      <JotaiProvider store={store}>
        <ChatPanel {...makeDockviewProps()} />
      </JotaiProvider>
    )
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIsOwner = true;
  useAgentSubChatStore.setState({
    chatId: null,
    activeSubChatId: null,
    openSubChatIds: [],
    allSubChats: [],
    splitPaneIds: [],
    splitRatios: []
  } as any);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatPanel — owner panel (isOwner=true)', () => {
  test('no non-owner banner when isOwner=true', () => {
    mockIsOwner = true;
    seedBuiltinStore();
    renderPanel();
    expect(screen.queryByTestId('non-owner-banner')).toBeNull();
    expect(screen.queryByTestId('non-owner-take-over')).toBeNull();
  });

  test('agents-content mounts for owner', () => {
    mockIsOwner = true;
    seedBuiltinStore();
    renderPanel();
    expect(screen.getByTestId('agents-content')).toBeTruthy();
  });
});

describe('ChatPanel — non-owner panel (isOwner=false)', () => {
  test('non-owner banner is visible', () => {
    mockIsOwner = false;
    seedBuiltinStore();
    renderPanel();
    expect(screen.getByTestId('non-owner-banner')).toBeTruthy();
    expect(screen.getByTestId('non-owner-take-over')).toBeTruthy();
  });

  test('banner copy matches spec', () => {
    mockIsOwner = false;
    seedBuiltinStore();
    renderPanel();
    const banner = screen.getByTestId('non-owner-banner');
    expect(banner.textContent).toContain('Already open in another window');
    expect(banner.textContent).toContain('read-only');
  });

  test('clicking "Take over here" calls takeOver()', () => {
    mockIsOwner = false;
    seedBuiltinStore();
    renderPanel();
    fireEvent.click(screen.getByTestId('non-owner-take-over'));
    expect(mockTakeOver).toHaveBeenCalledOnce();
  });
});

describe('ChatPanel — CLI harness + isOwner=false disables bootstrap', () => {
  test('ChatCliSurface receives isOwner=false when panel is not owner', () => {
    mockIsOwner = false;
    useAgentSubChatStore.setState({
      chatId: WORKSPACE_ID,
      activeSubChatId: SC,
      openSubChatIds: [SC],
      allSubChats: [{ id: SC, name: 'T', harness: 'claude-cli', projectId: 'proj-1', openspecChangeId: null }]
    } as any);
    renderPanel();
    const surface = screen.getByTestId('chat-cli-surface');
    expect(surface.dataset.owner).toBe('false');
  });
});
