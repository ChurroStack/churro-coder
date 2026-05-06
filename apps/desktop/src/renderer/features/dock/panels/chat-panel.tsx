import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { AgentsContent } from '../../agents/ui/agents-content';
import { selectedAgentChatIdAtom } from '../../agents/atoms';
import { appStore } from '../../../lib/jotai-store';
import type { ChatPanelEntity } from '../atoms';
import { useDockWorkspace } from '../workspace-context';

/**
 * ChatPanel — one dockview tab per open sub-chat. Each tab carries
 * `subChatId + chatId` in its params; the panel renders `<AgentsContent />`
 * which mounts ChatView for the parent chat.
 *
 * Visibility model: dockview gives us *two* notions of "active":
 * - `api.isActive` — global; only one panel across the whole dockview is
 *   the focused panel.
 * - `api.isVisible` — per-group; true when this panel is the active tab
 *   in its own group, regardless of whether its group has focus.
 *
 * For rendering content we want `isVisible` so each side of a split shows
 * its own chat — using `isActive` meant only the globally-focused panel
 * rendered, leaving the other side blank.
 *
 * For pushing `activeSubChatId` into the store we still want `isActive` —
 * that's what the right-rail widgets / hotkeys treat as "the chat the
 * user is currently looking at".
 *
 * ChatPanel passes its own sub-chat id through to ChatView, so each visible
 * split pane renders its own conversation while only the focused panel writes
 * global active-chat state.
 *
 * The opposite direction (store openSubChatIds → dockview) lives in
 * [chat-panel-sync.tsx].
 */
export function ChatPanel({ params, api, containerApi }: IDockviewPanelProps<ChatPanelEntity>) {
  const [isVisible, setIsVisible] = useState(api.isVisible);
  const [isActive, setIsActive] = useState(api.isActive);
  const { active: isWorkspaceActive } = useDockWorkspace();
  const setActiveSubChat = useAgentSubChatStore((s) => s.setActiveSubChat);
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats);

  // Dockview can restore a panel as the active tab without emitting the
  // visibility/active events to an already-mounted custom panel component.
  // Re-read the panel API on layout changes and on the next frame so a
  // restored workspace does not show a blank active chat until the user
  // clicks another tab.
  useEffect(() => {
    const syncPanelState = () => {
      setIsVisible(api.isVisible);
      setIsActive(api.isActive);
    };
    syncPanelState();
    const frame = requestAnimationFrame(syncPanelState);
    const subVisibility = api.onDidVisibilityChange((e) => setIsVisible(e.isVisible));
    const subActive = api.onDidActiveChange((e) => setIsActive(e.isActive));
    const subLayout = containerApi.onDidLayoutChange(syncPanelState);
    return () => {
      cancelAnimationFrame(frame);
      subVisibility.dispose();
      subActive.dispose();
      subLayout.dispose();
    };
  }, [api, containerApi]);

  // When this panel becomes the active panel in its dockview, sync
  // `activeSubChatId` so the rest of the app (right-rail widgets,
  // /commands, hotkeys) treats this sub-chat as the focused one.
  //
  // Multi-workspace caveat: every visited workspace has its own
  // WorkspaceDockShell mounted, so multiple ChatPanels (one per
  // workspace) can have `api.isActive=true` simultaneously — each
  // dockview has its own focused panel. Without the workspace gate,
  // they'd race to write the global `activeSubChatId`. Only the
  // currently-selected workspace's chat panels should claim focus.
  //
  // The workspace id check still reads `selectedAgentChatIdAtom` via
  // `appStore.get` instead of `useAtomValue`; workspace visibility is
  // delivered by WorkspaceDockShell context, while the selected-id read
  // remains a fire-time guard against stale panel events.
  useEffect(() => {
    if (!isWorkspaceActive || !isActive) return;
    const selectedWorkspaceId = appStore.get(selectedAgentChatIdAtom);
    if (params.chatId !== selectedWorkspaceId) return;
    setActiveSubChat(params.subChatId);
  }, [isWorkspaceActive, isActive, params.chatId, params.subChatId, setActiveSubChat]);

  // Keep the dockview tab title in sync with the sub-chat's display name.
  // Wait for store hydration before pushing a title so we don't overwrite
  // the restored dock snapshot title with a stale creation-time placeholder.
  useEffect(() => {
    const sc = allSubChats.find((x) => x.id === params.subChatId);
    if (!sc) return;
    const nextTitle = sc.name || 'New Chat';
    if (nextTitle !== api.title) {
      api.setTitle(nextTitle);
    }
  }, [allSubChats, params.subChatId, api]);

  // Mount AgentsContent for any visible panel (active tab in its group).
  // Hidden tabs (in the same group, not selected) render nothing. Across
  // groups every visible panel mounts independently, so a horizontal split
  // shows two chats side-by-side.
  const isStoreActivePanel =
    isWorkspaceActive &&
    (activeSubChatId === params.subChatId || (!activeSubChatId && openSubChatIds[0] === params.subChatId));
  const shouldMountContent = isVisible || isStoreActivePanel;

  return (
    <div
      className="h-full w-full overflow-hidden bg-background"
      style={{
        contain: 'layout style paint'
      }}>
      {shouldMountContent ? (
        <AgentsContent
          subChatIdOverride={params.subChatId}
          dockWorkspaceActive={isWorkspaceActive}
          dockPanelVisible={shouldMountContent}
          dockPanelActive={isActive || isStoreActivePanel}
        />
      ) : null}
    </div>
  );
}
