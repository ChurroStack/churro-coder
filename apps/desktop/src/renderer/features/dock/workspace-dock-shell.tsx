import { useCallback, useEffect, useRef, useState } from "react"
import type { DockviewApi } from "dockview-react"
import { cn } from "../../lib/utils"
import { DockShell } from "./dock-shell"
import { ChatPanelSync } from "./chat-panel-sync"
import {
  loadDockSnapshotForWorkspace,
  saveDockSnapshotForWorkspace,
  captureDock,
  tryRestoreDock,
} from "./persistence"

export interface WorkspaceDockShellProps {
  /** The workspace this shell renders. Drives the persisted dock-layout
   *  storage key and the gate for ChatPanelSync. Use `null` for the
   *  "no workspace selected" pseudo-shell. */
  workspaceId: string | null
  /** When true, this shell is the visible, interactive one. The rest are
   *  stacked invisibly so terminals / chat streams / panel state stay
   *  alive. The flag also gates ChatPanelSync — only the active shell
   *  reconciles its dockview against the global sub-chat store. */
  active: boolean
  /** Surfaces this shell's dockApi to the parent so the global
   *  DockProvider can route `usePanelActions` / `addOrFocus` /
   *  `useWidgetPanel` to whichever shell is active. */
  onDockApiReady: (workspaceId: string | null, api: DockviewApi) => void
  onDockApiDisposed: (workspaceId: string | null) => void
}

/**
 * One DockShell per workspace the user has visited this session.
 *
 * Each shell owns its own `DockviewApi`, its own `ChatPanelSync` (gated by
 * `active`), and its own per-workspace dock layout in localStorage. Stacking
 * multiple shells in the center cell means switching workspaces is just a
 * CSS visibility toggle — terminal PTYs, xterm scrollback, chat SSE
 * streams, scroll positions, and form drafts all survive because the React
 * tree never unmounts.
 *
 * The shell only writes to its own LS key (`agents:dock:project:${id}` or
 * `agents:dock:no-workspace`). The shell snapshot (gridview) stays global
 * and is owned by `agents-layout.tsx`.
 */
export function WorkspaceDockShell({
  workspaceId,
  active,
  onDockApiReady,
  onDockApiDisposed,
}: WorkspaceDockShellProps) {
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null)
  // Pin our own workspaceId for the saver's closure — guards against the
  // case where someone changes workspaceId for an existing instance (we
  // don't, but cheaper than reasoning about it).
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  // Debounced layout saver, scoped to this shell's workspace.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback(
    (api: DockviewApi) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveDockSnapshotForWorkspace(workspaceIdRef.current, captureDock(api))
      }, 300)
    },
    [],
  )

  const handleReady = useCallback(
    (api: DockviewApi) => {
      setDockApi(api)
      onDockApiReady(workspaceId, api)

      // Restore this workspace's saved dock layout. fromJSON throws on
      // missing components so it's wrapped — fall back to a single `main`
      // placeholder if restore fails.
      const snapshot = loadDockSnapshotForWorkspace(workspaceId)
      const restored = tryRestoreDock(api, snapshot)
      if (!restored && !api.getPanel("main")) {
        api.addPanel({
          id: "main",
          component: "main",
          title: "Workspace",
        })
      } else if (restored && !api.getPanel("main")) {
        // Older snapshot without the placeholder — re-add so
        // ChatPanelSync's "no chat → main" branch keeps working.
        api.addPanel({
          id: "main",
          component: "main",
          title: "Workspace",
        })
      }

      api.onDidLayoutChange(() => scheduleSave(api))
    },
    [workspaceId, onDockApiReady, scheduleSave],
  )

  // On unmount: flush the saver and let the parent forget our api. This
  // fires when a workspace is removed from `mountedWorkspaceIdsAtom`
  // (archived, closed, etc.). PTYs of any open terminals get killed via
  // DockShell.onDidRemovePanel as their panels tear down — that's the
  // expected "user closed this workspace forever" path.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      onDockApiDisposed(workspaceIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={cn(
        "absolute inset-0",
        active
          ? "opacity-100 pointer-events-auto z-[1]"
          : "opacity-0 pointer-events-none z-0",
      )}
      // `display: none` would stop dockview's ResizeObserver from firing
      // and leave the panel frozen at zero size. Keeping it laid out but
      // invisible means it picks up resizes and is ready to show instantly
      // when the user switches back.
      aria-hidden={!active}
    >
      <DockShell onApiReady={handleReady} className="h-full w-full" />
      <ChatPanelSync
        workspaceId={workspaceId}
        active={active}
        dockApi={dockApi}
      />
    </div>
  )
}
