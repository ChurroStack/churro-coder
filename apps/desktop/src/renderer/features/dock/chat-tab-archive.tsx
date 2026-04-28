import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { trpc } from "../../lib/trpc"
import { useDockApi } from "./dock-context"

/**
 * "Archive chat" flow for the X on a chat: tab.
 *
 * Always shows a confirm dialog before doing anything destructive — the
 * X click never silently closes a chat. The action on confirm depends
 * on how many chats are open:
 * - Multiple chats open → drop just this one from openSubChatIds. The
 *   sub-chat stays in `allSubChats` for history, the dockview panel
 *   closes via DockShell.onDidRemovePanel, Cmd+Z can reopen it.
 * - Last chat open → archive the parent workspace via trpc.chats.archive
 *   (in practice the X is `disabled` in this state — see
 *   [renamable-tab.tsx] — but the path stays here as a safeguard for
 *   keyboard / programmatic clicks).
 *
 * Wiring matches the rename dispatch in [renamable-tab.tsx]: a host
 * component captures the dispatcher into a module-level slot so the
 * dockview tab (rendered outside the React tree by dockview) can call
 * it without prop drilling.
 */

let dispatchArchiveImpl:
  | ((panelId: string) => void)
  | null = null

export function requestArchiveChatTab(panelId: string): void {
  if (dispatchArchiveImpl) dispatchArchiveImpl(panelId)
}

export function ChatTabArchiveHost() {
  const dockApi = useDockApi()
  const archiveChat = trpc.chats.archive.useMutation()
  const [pendingArchive, setPendingArchive] = useState<{
    subChatId: string
    parentChatId: string | null
    name: string
    /** When true, confirming archives the parent workspace. When false,
     *  confirming just drops the sub-chat from openSubChatIds. */
    archivesWorkspace: boolean
  } | null>(null)

  const dispatch = useCallback(
    (panelId: string) => {
      if (!panelId.startsWith("chat:")) return
      const subChatId = panelId.slice("chat:".length)
      const store = useAgentSubChatStore.getState()
      const openCount = store.openSubChatIds.length
      const parentChatId = store.chatId
      const sc = store.allSubChats.find((s) => s.id === subChatId)
      setPendingArchive({
        subChatId,
        parentChatId,
        name: sc?.name || "this chat",
        archivesWorkspace: openCount <= 1,
      })
    },
    [],
  )

  useEffect(() => {
    dispatchArchiveImpl = dispatch
    return () => {
      dispatchArchiveImpl = null
    }
  }, [dispatch])

  const handleConfirm = useCallback(() => {
    if (!pendingArchive) return
    const { parentChatId, subChatId, archivesWorkspace } = pendingArchive
    setPendingArchive(null)

    // Common path: drop this one sub-chat from openSubChatIds. The
    // matching dockview panel closes via DockShell.onDidRemovePanel.
    const dropFromOpen = () =>
      useAgentSubChatStore.getState().removeFromOpenSubChats(subChatId)

    if (!archivesWorkspace) {
      dropFromOpen()
      return
    }

    // Last-chat safeguard — archive the workspace too.
    if (!parentChatId) {
      // No parent context (shouldn't happen) — best-effort drop.
      dropFromOpen()
      return
    }
    archiveChat
      .mutateAsync({ id: parentChatId })
      .then(() => {
        dropFromOpen()
        // Close any other chat: panels that belong to this archived
        // workspace too — dockview sees the parent gone via the chats list
        // refresh, but we explicitly close to keep the UI immediate.
        if (dockApi) {
          for (const panel of dockApi.panels) {
            if (panel.id.startsWith("chat:")) panel.api.close()
          }
        }
      })
      .catch((err) => {
        console.error("[archive] Failed to archive workspace:", err)
        toast.error("Failed to archive chat")
      })
  }, [pendingArchive, archiveChat, dockApi])

  const handleCancel = useCallback(() => {
    setPendingArchive(null)
  }, [])

  return (
    <AlertDialog
      open={!!pendingArchive}
      onOpenChange={(open) => {
        if (!open) handleCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive chat</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription className="px-5 pb-5">
          Do you want to archive{" "}
          <span className="font-medium text-foreground">
            {pendingArchive?.name ?? "this chat"}
          </span>
          ?
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} autoFocus>
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
