import { useEffect } from "react"
import type { DockviewApi } from "dockview-react"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"

/**
 * ChatPanelSync — keeps a workspace's dockview chat panels (`chat:*`) in
 * lockstep with the sub-chat store's `openSubChatIds` / `activeSubChatId`.
 *
 * One instance is mounted per `WorkspaceDockShell`. Only the *active*
 * workspace's instance runs (others bail via the `active` prop), so the
 * inactive workspaces' DockShells stay frozen with whatever panels they
 * had — preserving terminals, chat streams, scroll positions, etc.
 *
 * Responsibilities while active:
 * 1. When the user picks no chat (`selectedChatId === null`): close any
 *    `chat:*` panels and ensure the `main` placeholder is mounted.
 * 2. When a chat is selected and we're its WorkspaceDockShell: open one
 *    `chat:${subChatId}` panel for every entry in `openSubChatIds`, and
 *    close any `chat:*` panel that's no longer in that list.
 * 3. When `activeSubChatId` changes: make the matching panel the active
 *    dockview panel.
 *
 * Inactive instances are no-ops — their dockview keeps every panel as it
 * was when the workspace was last active.
 */
export interface ChatPanelSyncProps {
  /** This shell's workspace id. Used to gate effects: only the workspace
   *  matching the global `selectedChatId` reconciles its dockview. */
  workspaceId: string | null
  /** When false, every effect bails — the inactive shell stays frozen. */
  active: boolean
  /** The dockview instance owned by this shell. */
  dockApi: DockviewApi | null
}

export function ChatPanelSync({
  workspaceId,
  active,
  dockApi,
}: ChatPanelSyncProps) {
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds)
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats)
  const storeChatId = useAgentSubChatStore((s) => s.chatId)

  // Effect (1) — no chat selected: close chat panels, ensure `main`.
  useEffect(() => {
    if (!active || !dockApi) return
    if (workspaceId !== null) return
    for (const panel of dockApi.panels) {
      if (panel.id.startsWith("chat:")) panel.api.close()
    }
    if (!dockApi.getPanel("main")) {
      dockApi.addPanel({
        id: "main",
        component: "main",
        title: "Workspace",
      })
    }
  }, [active, dockApi, workspaceId])

  // Effect (2) — workspace selected: reconcile chat panels.
  useEffect(() => {
    if (!active || !dockApi || !workspaceId) return
    // The store loads its slice on `setChatId`; if it lags behind the
    // workspace switch we bail to wait for the next render.
    if (storeChatId !== workspaceId) return

    if (openSubChatIds.length > 0) {
      const main = dockApi.getPanel("main")
      if (main) main.api.close()
    }

    for (const subChatId of openSubChatIds) {
      const id = `chat:${subChatId}`
      if (dockApi.getPanel(id)) continue
      const sc = allSubChats.find((x) => x.id === subChatId)
      dockApi.addPanel({
        id,
        component: "chat",
        title: sc?.name || "Conversation",
        params: {
          subChatId,
          chatId: workspaceId,
          name: sc?.name,
        },
      })
    }

    for (const panel of dockApi.panels) {
      if (!panel.id.startsWith("chat:")) continue
      const subChatId = panel.id.slice("chat:".length)
      if (!openSubChatIds.includes(subChatId)) {
        panel.api.close()
      }
    }
  }, [active, dockApi, workspaceId, storeChatId, openSubChatIds, allSubChats])

  // Effect (3) — active sub-chat → setActive on the matching panel.
  useEffect(() => {
    if (!active || !dockApi || !workspaceId) return
    if (storeChatId !== workspaceId) return
    if (!activeSubChatId) return
    const panel = dockApi.getPanel(`chat:${activeSubChatId}`)
    if (panel && !panel.api.isActive) panel.api.setActive()
  }, [active, dockApi, workspaceId, storeChatId, activeSubChatId])

  return null
}
