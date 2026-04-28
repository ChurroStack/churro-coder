import { useAtom } from "jotai"
import { useCallback, useMemo } from "react"
import type { WidgetId } from "../details-sidebar/atoms"
import { useDockApi } from "./dock-context"
import {
  panelIdFor,
  panelTitleFor,
  widgetMutexKey,
  widgetPanelMapAtom,
  type PanelEntity,
  type PanelKind,
} from "./atoms"

/**
 * Map widget IDs to the panel kind they open as.
 */
const WIDGET_TO_PANEL_KIND: Partial<Record<WidgetId, PanelKind>> = {
  plan: "plan",
  terminal: "terminal",
  diff: "diff",
}

export interface WidgetPanelHandle {
  /** True when an entity-matching panel currently exists in the dockview. */
  isOpen: boolean
  /** Open (or focus) the panel. No-op if dockview isn't mounted yet. */
  openAsPanel: () => void
  /** Close the panel if open. No-op if not open. */
  closePanel: () => void
  /** Whether this dock substrate is available (dockview mounted). */
  available: boolean
}

/**
 * Bind a sidebar widget to its corresponding full-pane panel in the dockview.
 *
 * The mutex contract: when the panel is open, the widget summary should hide
 * (the caller is expected to render `<PromotedToPanelStub/>` in its place).
 *
 * The mapping atom (`widgetPanelMapAtom`) is window-scoped; closing the panel
 * via dockview's tab X is also caught by `DockShell`'s onDidRemovePanel
 * listener, so both close paths converge on the same state.
 */
export function useWidgetPanel(
  widgetId: WidgetId,
  entity: PanelEntity,
): WidgetPanelHandle {
  const api = useDockApi()
  const [map, setMap] = useAtom(widgetPanelMapAtom)

  const kind = WIDGET_TO_PANEL_KIND[widgetId]
  const panelId = useMemo(
    () => (kind ? panelIdFor(entity) : null),
    [kind, entity],
  )

  // The mutex key is keyed by the entity id so different chats' plan widgets
  // can be promoted independently without interfering.
  const mutexKey = useMemo(
    () => (kind && panelId ? widgetMutexKey(widgetId, panelId) : null),
    [kind, panelId, widgetId],
  )

  const recordedId = mutexKey ? map[mutexKey] : null
  const isOpen = !!recordedId && !!api?.getPanel(recordedId)

  const openAsPanel = useCallback(() => {
    if (!api || !kind || !panelId || !mutexKey) return
    const existing = api.getPanel(panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    api.addPanel({
      id: panelId,
      component: kind,
      title: panelTitleFor(entity),
      params: entity.data as Record<string, unknown>,
    })
    setMap((prev) => ({ ...prev, [mutexKey]: panelId }))
  }, [api, kind, panelId, mutexKey, entity, setMap])

  const closePanel = useCallback(() => {
    if (!api || !panelId || !mutexKey) return
    const existing = api.getPanel(panelId)
    if (existing) existing.api.close()
    setMap((prev) => ({ ...prev, [mutexKey]: null }))
  }, [api, panelId, mutexKey, setMap])

  return {
    isOpen,
    openAsPanel,
    closePanel,
    available: !!api && !!kind,
  }
}
