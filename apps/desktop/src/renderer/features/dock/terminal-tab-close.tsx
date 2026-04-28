import { useCallback, useEffect, useState } from "react"
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
import { useDockApi } from "./dock-context"

/**
 * "Close terminal" flow for the X on a terminal: tab.
 *
 * Closing a terminal panel is destructive — DockShell.onDidRemovePanel kills
 * the PTY (SIGKILL via trpc.terminal.kill), so any process the user is
 * running goes with it. The X click never silently nukes a shell: a confirm
 * dialog asks first.
 *
 * Wiring matches [chat-tab-archive.tsx] / [renamable-tab.tsx]: a host
 * component captures the dispatcher into a module-level slot so the
 * dockview tab (rendered outside the React tree) can call it without prop
 * drilling.
 */

let dispatchCloseImpl: ((panelId: string) => void) | null = null

export function requestCloseTerminalTab(panelId: string): void {
  if (dispatchCloseImpl) dispatchCloseImpl(panelId)
}

export function TerminalTabCloseHost() {
  const dockApi = useDockApi()
  const [pendingClose, setPendingClose] = useState<{
    panelId: string
    name: string
  } | null>(null)

  const dispatch = useCallback(
    (panelId: string) => {
      if (!panelId.startsWith("terminal:")) return
      const panel = dockApi?.getPanel(panelId)
      const params = (panel?.params ?? {}) as { name?: string }
      setPendingClose({
        panelId,
        name: params.name || panel?.title || "this terminal",
      })
    },
    [dockApi],
  )

  useEffect(() => {
    dispatchCloseImpl = dispatch
    return () => {
      dispatchCloseImpl = null
    }
  }, [dispatch])

  const handleConfirm = useCallback(() => {
    if (!pendingClose) return
    const { panelId } = pendingClose
    setPendingClose(null)
    // Close the panel — DockShell.onDidRemovePanel handles the SIGKILL +
    // store cleanup. Going through dockview keeps animations / focus
    // fallback consistent with every other close path.
    dockApi?.getPanel(panelId)?.api.close()
  }, [pendingClose, dockApi])

  const handleCancel = useCallback(() => {
    setPendingClose(null)
  }, [])

  return (
    <AlertDialog
      open={!!pendingClose}
      onOpenChange={(open) => {
        if (!open) handleCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close terminal</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription className="px-5 pb-5">
          Closing{" "}
          <span className="font-medium text-foreground">
            {pendingClose?.name ?? "this terminal"}
          </span>{" "}
          will kill any running commands.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} autoFocus>
            Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
