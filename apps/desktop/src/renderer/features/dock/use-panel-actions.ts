import { useCallback } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import type { DockviewGroupPanel } from "dockview-react"
import {
  selectedAgentChatIdAtom,
  currentPlanPathAtomFamily,
} from "../agents/atoms"
import { defaultAgentModeAtom } from "../../lib/atoms"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import {
  terminalsAtom,
  activeTerminalIdAtom,
} from "../terminal/atoms"
import {
  buildTerminalPaneId,
  generateTerminalId,
  getNextTerminalName,
  getTerminalScopeKey,
} from "../terminal/utils"
import { trpc } from "../../lib/trpc"
import { useDockApi } from "./dock-context"
import { addOrFocus } from "./add-or-focus"
import { layoutStorageKey } from "./persistence"
import type { TerminalInstance } from "../terminal/types"

export interface PanelActions {
  available: boolean
  // Action availability
  canNewSubChat: boolean
  canOpenTerminal: boolean
  canOpenPlan: boolean
  canOpenDiff: boolean
  canOpenSearch: boolean
  canOpenFilesTree: boolean
  // Action triggers
  newSubChat: () => void
  openTerminal: () => void
  openPlan: () => void
  openDiff: () => void
  openSearch: () => void
  openFilesTree: () => void
  resetLayout: () => void
}

/**
 * Single source of truth for "open a panel" actions wired across the app —
 * TopBar quick-launch buttons, dockview header [+] menu, future hotkeys.
 *
 * Each `open*` is a no-op when the underlying entity isn't available; the
 * matching `can*` flag tells the caller whether to render the trigger as
 * enabled or disabled.
 *
 * `sourceGroup` lets a caller (typically a per-group header) pin new panels
 * to *its* group instead of dockview's globally active group — without it
 * the [+] button in group A would create a panel in group B if group B is
 * the focused one.
 */
export function usePanelActions(
  sourceGroup?: DockviewGroupPanel,
): PanelActions {
  const dockApi = useDockApi()
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const planPath = useAtomValue(
    currentPlanPathAtomFamily(activeSubChatId ?? chatId ?? ""),
  )
  const { data: chat } = trpc.chats.get.useQuery(
    { id: chatId ?? "" },
    { enabled: !!chatId },
  )
  const worktreePath = chat?.worktreePath ?? null
  const projectId = chat?.projectId ?? null
  const branch = chat?.branch ?? null

  const setTerminals = useSetAtom(terminalsAtom)
  const setActiveTerminalIds = useSetAtom(activeTerminalIdAtom)
  const allTerminals = useAtomValue(terminalsAtom)
  const defaultMode = useAtomValue(defaultAgentModeAtom)
  const utils = trpc.useUtils()
  const createSubChat = trpc.chats.createSubChat.useMutation()

  const newSubChat = useCallback(() => {
    if (!chatId) return
    const newId = crypto.randomUUID()
    // Optimistically add to the chat's sub-chats so workspace ownership
    // checks (validSubChatIds, tabsToRender) recognize it instantly. The
    // optimistic name is "New Chat" — we don't pass `name` to trpc so the
    // DB column stays NULL and the app-quit cleanup can recognize a
    // never-named sub-chat.
    utils.agents.getAgentChat.setData(
      { chatId } as { chatId: string },
      (old: any) => {
        if (!old) return old
        return {
          ...old,
          subChats: [
            ...(old.subChats || []),
            {
              id: newId,
              name: "New Chat",
              mode: defaultMode,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: null,
              stream_id: null,
            },
          ],
        }
      },
    )
    // Wire it into the store. ChatPanelSync watches openSubChatIds and
    // would normally add the dockview panel itself (without a group hint,
    // so dockview drops it on the globally-active group). To honor
    // sourceGroup, we add the panel here synchronously when we have a
    // dock api + source group; ChatPanelSync's "if panel exists, skip"
    // branch then leaves it alone.
    const store = useAgentSubChatStore.getState()
    store.addToOpenSubChats(newId)
    store.setActiveSubChat(newId)
    if (dockApi && sourceGroup) {
      const panelId = `chat:${newId}`
      if (!dockApi.getPanel(panelId)) {
        dockApi.addPanel({
          id: panelId,
          component: "chat",
          title: "New Chat",
          params: { subChatId: newId, chatId, name: "New Chat" },
          position: { referenceGroup: sourceGroup },
        })
      }
    }
    // Persist to DB in the background; roll back on error.
    createSubChat
      .mutateAsync({ id: newId, chatId, mode: defaultMode })
      .catch((err) => {
        console.error("[newSubChat] Failed to persist:", err)
        utils.agents.getAgentChat.setData(
          { chatId } as { chatId: string },
          (old: any) => {
            if (!old) return old
            return {
              ...old,
              subChats: (old.subChats || []).filter(
                (sc: { id: string }) => sc.id !== newId,
              ),
            }
          },
        )
        useAgentSubChatStore.getState().removeFromOpenSubChats(newId)
        toast.error("Failed to create chat")
      })
  }, [chatId, defaultMode, utils, createSubChat, dockApi, sourceGroup])

  const openTerminal = useCallback(() => {
    if (!dockApi || !chatId || !worktreePath) return
    const scopeKey = getTerminalScopeKey({ id: chatId, branch, worktreePath })
    const list = allTerminals[chatId] ?? []
    const id = generateTerminalId()
    const paneId = buildTerminalPaneId(scopeKey, id)
    const name = getNextTerminalName(list)
    const inst: TerminalInstance = { id, paneId, name, createdAt: Date.now() }
    setTerminals((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] ?? []), inst],
    }))
    setActiveTerminalIds((prev) => ({ ...prev, [chatId]: id }))
    addOrFocus(
      dockApi,
      {
        kind: "terminal",
        data: { paneId, name, chatId, cwd: worktreePath, workspaceId: chatId },
      },
      { referenceGroup: sourceGroup },
    )
  }, [
    dockApi,
    chatId,
    worktreePath,
    branch,
    allTerminals,
    setTerminals,
    setActiveTerminalIds,
    sourceGroup,
  ])

  const openPlan = useCallback(() => {
    if (!dockApi || !chatId || !planPath) return
    const effectiveChatId = activeSubChatId ?? chatId
    addOrFocus(
      dockApi,
      {
        kind: "plan",
        data: { chatId: effectiveChatId, planPath },
      },
      { referenceGroup: sourceGroup },
    )
  }, [dockApi, chatId, planPath, activeSubChatId, sourceGroup])

  const openDiff = useCallback(() => {
    if (!dockApi || !chatId) return
    addOrFocus(
      dockApi,
      { kind: "diff", data: { chatId } },
      { referenceGroup: sourceGroup },
    )
  }, [dockApi, chatId, sourceGroup])

  const openSearch = useCallback(() => {
    if (!dockApi || !projectId) return
    addOrFocus(
      dockApi,
      { kind: "search", data: { projectId } },
      { referenceGroup: sourceGroup },
    )
  }, [dockApi, projectId, sourceGroup])

  const openFilesTree = useCallback(() => {
    if (!dockApi || !projectId) return
    addOrFocus(
      dockApi,
      { kind: "files-tree", data: { projectId } },
      { referenceGroup: sourceGroup },
    )
  }, [dockApi, projectId, sourceGroup])

  const resetLayout = useCallback(() => {
    try {
      localStorage.removeItem(layoutStorageKey())
      window.location.reload()
    } catch (err) {
      console.warn("[layout] Failed to reset layout:", err)
    }
  }, [])

  return {
    available: !!dockApi,
    canNewSubChat: !!chatId && !!dockApi,
    canOpenTerminal: !!chatId && !!worktreePath && !!dockApi,
    canOpenPlan: !!chatId && !!planPath && !!dockApi,
    canOpenDiff: !!chatId && !!dockApi,
    canOpenSearch: !!projectId && !!dockApi,
    canOpenFilesTree: !!projectId && !!dockApi,
    newSubChat,
    openTerminal,
    openPlan,
    openDiff,
    openSearch,
    openFilesTree,
    resetLayout,
  }
}
