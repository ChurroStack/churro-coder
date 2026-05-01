import { useEffect, useMemo, useState } from "react"
import type { IDockviewPanelProps } from "dockview-react"
import { useAgentSubChatStore } from "../../agents/stores/sub-chat-store"
import { AgentsContent } from "../../agents/ui/agents-content"
import { selectedAgentChatIdAtom } from "../../agents/atoms"
import { appStore } from "../../../lib/jotai-store"
import type { ChatPanelEntity } from "../atoms"
import { useDockWorkspace } from "../workspace-context"

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
export function ChatPanel({
  params,
  api,
}: IDockviewPanelProps<ChatPanelEntity>) {
  const [isVisible, setIsVisible] = useState(api.isVisible)
  const [isActive, setIsActive] = useState(api.isActive)
  const { active: isWorkspaceActive } = useDockWorkspace()
  const setActiveSubChat = useAgentSubChatStore((s) => s.setActiveSubChat)
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats)

  // `isVisible` (per-group) drives whether to mount AgentsContent.
  useEffect(() => {
    setIsVisible(api.isVisible)
    const sub = api.onDidVisibilityChange((e) => setIsVisible(e.isVisible))
    return () => sub.dispose()
  }, [api])

  // `isActive` (global) drives the activeSubChatId store sync.
  useEffect(() => {
    setIsActive(api.isActive)
    const sub = api.onDidActiveChange((e) => setIsActive(e.isActive))
    return () => sub.dispose()
  }, [api])

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
    if (!isWorkspaceActive || !isActive) return
    const selectedWorkspaceId = appStore.get(selectedAgentChatIdAtom)
    if (params.chatId !== selectedWorkspaceId) return
    setActiveSubChat(params.subChatId)
  }, [isWorkspaceActive, isActive, params.chatId, params.subChatId, setActiveSubChat])

  // Keep the dockview tab title in sync with the sub-chat's display name.
  // The store's allSubChats array is the source of truth for names.
  const latestName = useMemo(() => {
    const sc = allSubChats.find((x) => x.id === params.subChatId)
    return sc?.name ?? params.name ?? "Conversation"
  }, [allSubChats, params.subChatId, params.name])

  useEffect(() => {
    if (latestName && latestName !== api.title) {
      api.setTitle(latestName)
    }
  }, [latestName, api])

  // Mount AgentsContent for any visible panel (active tab in its group).
  // Hidden tabs (in the same group, not selected) render nothing. Across
  // groups every visible panel mounts independently, so a horizontal split
  // shows two chats side-by-side.
  return (
    <div
      className="h-full w-full overflow-hidden bg-background"
      style={{
        contain: "layout style paint",
      }}
    >
      {isVisible ? (
        <AgentsContent
          subChatIdOverride={params.subChatId}
          dockWorkspaceActive={isWorkspaceActive}
          dockPanelVisible={isVisible}
          dockPanelActive={isActive}
        />
      ) : null}
    </div>
  )
}
