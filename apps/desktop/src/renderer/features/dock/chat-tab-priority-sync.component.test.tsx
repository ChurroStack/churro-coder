// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { createStore } from 'jotai';
import { ChatTabPrioritySync } from './chat-tab-priority-sync';
import { useStreamingStatusStore } from '../agents/stores/streaming-status-store';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';
import type { DockviewApi } from 'dockview-react';

// ── Minimal dockview mock types ───────────────────────────────────────────────

type MockPanel = {
  id: string;
  api: {
    group: MockGroup;
    moveTo: ReturnType<typeof vi.fn>;
    setActive: ReturnType<typeof vi.fn>;
  };
};

type MockGroup = {
  panels: MockPanel[];
  activePanel: MockPanel | null;
};

function makePanel(id: string): MockPanel {
  return {
    id,
    api: {
      group: null as unknown as MockGroup,
      moveTo: vi.fn(),
      setActive: vi.fn()
    }
  };
}

function makeGroup(panels: MockPanel[], activePanelId: string): MockGroup {
  const group: MockGroup = {
    panels,
    activePanel: panels.find((p) => p.id === activePanelId) ?? null
  };
  for (const panel of panels) {
    panel.api.group = group;
  }
  return group;
}

function makeDockApi(panels: MockPanel[]): DockviewApi {
  return { panels } as unknown as DockviewApi;
}

// ── Wrapper that provides an isolated Jotai store ────────────────────────────

function wrap(ui: React.ReactElement) {
  const store = createStore();
  return render(<JotaiProvider store={store}>{ui}</JotaiProvider>);
}

const WORKSPACE_ID = 'ws-test-1';

// ── Active-panel preservation regression tests ────────────────────────────────

describe('ChatTabPrioritySync — active panel preservation across auto-promote', () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} });
    useAgentSubChatStore.setState({ chatId: WORKSPACE_ID } as any);
  });

  afterEach(() => {
    cleanup();
    useStreamingStatusStore.setState({ statuses: {} });
    useAgentSubChatStore.setState({ chatId: null } as any);
  });

  test('active panel is re-asserted when dockview changes it after promote', () => {
    const panelA = makePanel('chat:sc-a');
    const panelB = makePanel('chat:sc-b');
    const panelC = makePanel('chat:sc-c');
    const allPanels = [panelA, panelB, panelC];
    const group = makeGroup(allPanels, 'chat:sc-a'); // A is the user-selected panel

    // Simulate the dockview v5.2 bug: moveTo changes group.activePanel to the promoted panel
    panelC.api.moveTo.mockImplementation(() => {
      group.activePanel = panelC;
    });

    const dockApi = makeDockApi(allPanels);

    // Mount — first effect run is the seeding pass (records C=not-active)
    const { rerender } = wrap(<ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />);

    // C transitions to streaming → triggers the promotion on the next render
    act(() => {
      useStreamingStatusStore.getState().setStatus('sc-c', 'streaming');
    });
    rerender(
      <JotaiProvider store={createStore()}>
        <ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />
      </JotaiProvider>
    );

    expect(panelC.api.moveTo).toHaveBeenCalledWith({ group, index: 0, skipSetActive: true });
    // moveTo changed activePanel to C; the fix must call A.api.setActive() to restore the user's selection
    expect(panelA.api.setActive).toHaveBeenCalled();
  });

  test('re-assert is skipped when dockview already preserved the active panel', () => {
    const panelA = makePanel('chat:sc-a');
    const panelB = makePanel('chat:sc-b');
    const panelC = makePanel('chat:sc-c');
    const allPanels = [panelA, panelB, panelC];
    const group = makeGroup(allPanels, 'chat:sc-a'); // A is active

    // moveTo does NOT change activePanel — dockview correctly preserved A
    panelC.api.moveTo.mockImplementation(() => {
      // group.activePanel stays as panelA — no bug
    });
    void group;

    const dockApi = makeDockApi(allPanels);

    const { rerender } = wrap(<ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />);

    act(() => {
      useStreamingStatusStore.getState().setStatus('sc-c', 'streaming');
    });
    rerender(
      <JotaiProvider store={createStore()}>
        <ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />
      </JotaiProvider>
    );

    expect(panelC.api.moveTo).toHaveBeenCalled();
    // dockview kept activePanel = A — setActive must NOT be called (it's already correct)
    expect(panelA.api.setActive).not.toHaveBeenCalled();
  });

  test('no re-assert when the promoted panel was already the active one and dockview preserved it', () => {
    const panelA = makePanel('chat:sc-a');
    const panelB = makePanel('chat:sc-b');
    const panelC = makePanel('chat:sc-c');
    const allPanels = [panelA, panelB, panelC];
    // C is already the user-selected panel
    makeGroup(allPanels, 'chat:sc-c');
    // moveTo does NOT change activePanel — group.activePanel stays as C
    panelC.api.moveTo.mockImplementation(() => {
      // no-op: dockview preserved C as active
    });

    const dockApi = makeDockApi(allPanels);

    const { rerender } = wrap(<ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />);

    act(() => {
      useStreamingStatusStore.getState().setStatus('sc-c', 'streaming');
    });
    rerender(
      <JotaiProvider store={createStore()}>
        <ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />
      </JotaiProvider>
    );

    expect(panelC.api.moveTo).toHaveBeenCalled();
    // activePanel already correct (C) — no re-assert needed
    expect(panelA.api.setActive).not.toHaveBeenCalled();
    expect(panelC.api.setActive).not.toHaveBeenCalled();
  });

  test('user viewing the promoted panel: moveTo flips activePanel to sibling → re-assert promoted panel', () => {
    // Repro for the user-reported "open new chat, type input, content jumps to previous chat" bug.
    // The user is viewing C (their new chat). C's status flips to 'submitted', triggering promotion.
    // dockview's moveTo flips activePanel from C to A (the sibling that was at index 0).
    // Without the fix, A's content would render. The fix must re-assert C.
    const panelA = makePanel('chat:sc-a');
    const panelB = makePanel('chat:sc-b');
    const panelC = makePanel('chat:sc-c');
    const allPanels = [panelA, panelB, panelC];
    const group = makeGroup(allPanels, 'chat:sc-c'); // C is the user-selected panel

    // Simulate the bug: moveTo on C flips activePanel from C to A
    panelC.api.moveTo.mockImplementation(() => {
      group.activePanel = panelA;
    });

    const dockApi = makeDockApi(allPanels);

    const { rerender } = wrap(<ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />);

    act(() => {
      useStreamingStatusStore.getState().setStatus('sc-c', 'submitted');
    });
    rerender(
      <JotaiProvider store={createStore()}>
        <ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />
      </JotaiProvider>
    );

    expect(panelC.api.moveTo).toHaveBeenCalled();
    // Re-assert must call setActive on C (the user's selection), not A
    expect(panelC.api.setActive).toHaveBeenCalled();
    expect(panelA.api.setActive).not.toHaveBeenCalled();
  });

  test('seeding pass does not call moveTo or setActive', () => {
    const panelA = makePanel('chat:sc-a');
    const panelB = makePanel('chat:sc-b');
    const panelC = makePanel('chat:sc-c');
    const allPanels = [panelA, panelB, panelC];
    makeGroup(allPanels, 'chat:sc-a');

    // C is already streaming at mount time — seeding pass must only observe, never promote
    useStreamingStatusStore.setState({ statuses: { 'sc-c': 'streaming' } });

    const dockApi = makeDockApi(allPanels);

    wrap(<ChatTabPrioritySync workspaceId={WORKSPACE_ID} active={true} dockApi={dockApi} />);

    expect(panelC.api.moveTo).not.toHaveBeenCalled();
    expect(panelA.api.setActive).not.toHaveBeenCalled();
    expect(panelC.api.setActive).not.toHaveBeenCalled();
  });
});
