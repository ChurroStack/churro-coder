import { useEffect } from "react"
import { useSetAtom } from "jotai"
import { usePanelActions } from "./use-panel-actions"
import { useDockApi } from "./dock-context"
import { addOrFocus } from "./add-or-focus"
import { dockPanelsAtom, type DockPanelSummary } from "./atoms"

/**
 * Bridges the global agent action system to per-workspace dock actions.
 *
 * The action handlers in [agents-actions.ts] for `create-new-subchat` /
 * `new-terminal` / `open-search` can't call `usePanelActions()` directly —
 * `usePanelActions` reads `useDockApi()` which requires being inside the
 * `DockProvider`. The action handlers (and the hotkey manager that
 * dispatches them) live above the provider in the tree.
 *
 * So those handlers dispatch a `CustomEvent` instead, and this host
 * (mounted *inside* `DockProvider`) listens for the events and calls the
 * matching panel action with the live, currently-active dockApi.
 *
 * Same indirection pattern that `open-in-editor` / `open-file-in-editor`
 * use — see [info-section.tsx] for the receiving end of those events.
 */
export function DockHotkeysHost() {
  const actions = usePanelActions()
  const dockApi = useDockApi()
  const setDockPanels = useSetAtom(dockPanelsAtom)

  // Publish a live snapshot of dockview panels for consumers outside
  // DockProvider (Spotlight's WorkspaceTabsProvider).
  useEffect(() => {
    if (!dockApi) {
      setDockPanels([])
      return
    }
    const snapshot = (): DockPanelSummary[] =>
      dockApi.panels.map((p) => ({
        id: p.id,
        title: p.title ?? p.id,
        kind: (p.api as unknown as { component?: string }).component ?? "",
        isActive: p.api.isActive,
      }))

    const update = () => setDockPanels(snapshot())
    update()

    const subs = [
      dockApi.onDidAddPanel(update),
      dockApi.onDidRemovePanel(update),
      dockApi.onDidActivePanelChange(update),
      dockApi.onDidLayoutChange(update),
    ]
    return () => {
      subs.forEach((s) => s.dispose())
    }
  }, [dockApi, setDockPanels])

  useEffect(() => {
    const handleNewSubChat = () => {
      if (!actions.canNewSubChat) return
      actions.newSubChat()
    }
    const handleNewTerminal = () => {
      if (!actions.canOpenTerminal) return
      actions.openTerminal()
    }
    const handleOpenSearch = () => {
      if (!actions.canOpenSearch) return
      actions.openSearch()
    }
    const handleOpenDiff = () => {
      if (!actions.canOpenDiff) return
      actions.openDiff()
    }
    const handleOpenPlan = () => {
      if (!actions.canOpenPlan) return
      actions.openPlan()
    }
    const handleOpenFile = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { absolutePath?: string; initialLine?: number; initialColumn?: number }
        | undefined
      if (!dockApi || !detail?.absolutePath) return
      addOrFocus(dockApi, {
        kind: "file",
        data: {
          absolutePath: detail.absolutePath,
          initialLine: detail.initialLine,
          initialColumn: detail.initialColumn,
        },
      })
    }
    const handleActivatePanel = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { panelId?: string }
        | undefined
      if (!dockApi || !detail?.panelId) return
      const panel = dockApi.getPanel(detail.panelId)
      if (panel) panel.api.setActive()
    }

    window.addEventListener("dock:new-subchat", handleNewSubChat)
    window.addEventListener("dock:new-terminal", handleNewTerminal)
    window.addEventListener("dock:open-search", handleOpenSearch)
    window.addEventListener("dock:open-diff", handleOpenDiff)
    window.addEventListener("dock:open-plan", handleOpenPlan)
    window.addEventListener("dock:open-file", handleOpenFile)
    window.addEventListener("dock:activate-panel", handleActivatePanel)

    return () => {
      window.removeEventListener("dock:new-subchat", handleNewSubChat)
      window.removeEventListener("dock:new-terminal", handleNewTerminal)
      window.removeEventListener("dock:open-search", handleOpenSearch)
      window.removeEventListener("dock:open-diff", handleOpenDiff)
      window.removeEventListener("dock:open-plan", handleOpenPlan)
      window.removeEventListener("dock:open-file", handleOpenFile)
      window.removeEventListener("dock:activate-panel", handleActivatePanel)
    }
  }, [actions, dockApi])

  return null
}
