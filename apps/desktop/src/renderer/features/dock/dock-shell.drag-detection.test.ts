/**
 * Drag-detection regression test for DockShell's onDidRemovePanel handler.
 *
 * Root cause: dockview fires onDidRemovePanel for BOTH drag (reposition) and
 * actual tab close. Before this fix the handler called removeFromOpenSubChats
 * immediately, so dragging a CLI panel caused ChatPanelSync to close it.
 *
 * Fix: the handler defers cleanup with queueMicrotask. Dockview re-adds the
 * panel synchronously (onDidAddPanel fires in the same tick), so by the time
 * the microtask runs the panel is back in dockApi.panels. If getPanel returns
 * non-null the cleanup is skipped (drag); if null it proceeds (close).
 */
import { describe, test, expect, vi } from 'vitest';

// Mirrors the deferred cleanup logic extracted from dock-shell.tsx
function deferChatPanelCleanup(
  panelId: string,
  dockApi: { getPanel: (id: string) => unknown },
  onClose: (subChatId: string) => void
): void {
  const subChatId = panelId.slice('chat:'.length);
  queueMicrotask(() => {
    if (dockApi.getPanel(panelId)) return;
    onClose(subChatId);
  });
}

describe('DockShell drag-detection [dock/drag-detection]', () => {
  test('does NOT remove subChat when panel is re-added synchronously (drag scenario)', async () => {
    const removeFromOpenSubChats = vi.fn();
    const panelId = 'chat:abc-123';
    // Panel is back in dockview before microtask fires (simulates drag + onDidAddPanel)
    const dockApi = { getPanel: (id: string) => (id === panelId ? {} : null) };

    deferChatPanelCleanup(panelId, dockApi, removeFromOpenSubChats);

    // queueMicrotask runs before this continuation
    await Promise.resolve();

    expect(removeFromOpenSubChats).not.toHaveBeenCalled();
  });

  test('removes subChat when panel stays gone (tab close scenario)', async () => {
    const removeFromOpenSubChats = vi.fn();
    const panelId = 'chat:abc-123';
    // Panel is not re-added (simulates explicit tab close)
    const dockApi = { getPanel: () => null };

    deferChatPanelCleanup(panelId, dockApi, removeFromOpenSubChats);

    await Promise.resolve();

    expect(removeFromOpenSubChats).toHaveBeenCalledWith('abc-123');
    expect(removeFromOpenSubChats).toHaveBeenCalledTimes(1);
  });

  test('handles multiple panels independently in the same tick', async () => {
    const remove = vi.fn();
    const keptPanelId = 'chat:kept';
    const closedPanelId = 'chat:closed';

    const dockApi = {
      getPanel: (id: string) => (id === keptPanelId ? {} : null)
    };

    // Simulate both firing in the same tick (e.g., group dissolve during drag)
    deferChatPanelCleanup(keptPanelId, dockApi, remove);
    deferChatPanelCleanup(closedPanelId, dockApi, remove);

    await Promise.resolve();
    // Extra microtask flush for the second callback
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('closed');
    expect(remove).not.toHaveBeenCalledWith('kept');
  });
});
