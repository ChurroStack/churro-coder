import type {
  DockviewApi,
  AddPanelOptions,
  DockviewGroupPanel,
} from "dockview-react"
import { panelIdFor, panelTitleFor, type PanelEntity } from "./atoms"
import type { NewPanelPlacement } from "../../lib/atoms"

export interface AddOrFocusOptions {
  splitDirection?: "right" | "down" | "left" | "up"
  floating?: boolean
  /** When provided, used as the reference panel for splits. Defaults to the active panel. */
  referencePanelId?: string
  /**
   * When provided (and no splitDirection is set), the new panel becomes a
   * tab inside this group. This is what header-action buttons pass to keep
   * the new panel in the same group whose [+]/Chat/Terminal button was
   * clicked, instead of landing on whichever group is globally active.
   */
  referenceGroup?: DockviewGroupPanel
}

/**
 * Converts a user-configured placement preference into AddOrFocusOptions.
 * "smart":
 *   - terminals always go to the bottom (split down, or tab into an existing
 *     terminal group so they cluster rather than stacking new splits)
 *   - other panels: split right in single-group, tab into source in multi-group
 * Splits are anchored to sourceGroup.activePanel so they work even when
 * api.activePanel is momentarily undefined (layout restore, focus shifts).
 */
export function resolvePlacementOpts(
  api: DockviewApi,
  placement: NewPanelPlacement,
  isTerminal: boolean,
  sourceGroup?: DockviewGroupPanel,
): AddOrFocusOptions {
  if (placement === "smart") {
    if (isTerminal) {
      const existingTerminal = api.panels.find((p) => p.id.startsWith("terminal:"))
      if (existingTerminal) return { referenceGroup: existingTerminal.group }
      return {
        splitDirection: "down",
        referencePanelId: sourceGroup?.activePanel?.id,
      }
    }
    const isSingleGroup = api.groups.length <= 1
    if (isSingleGroup) {
      return {
        splitDirection: "right",
        referencePanelId: sourceGroup?.activePanel?.id,
      }
    }
    return { referenceGroup: sourceGroup }
  }
  if (placement === "tab") return { referenceGroup: sourceGroup }
  return {
    splitDirection: placement.replace("split-", "") as "right" | "down" | "left",
    referencePanelId: sourceGroup?.activePanel?.id,
  }
}

export function addOrFocus(
  api: DockviewApi,
  entity: PanelEntity,
  opts: AddOrFocusOptions = {},
): void {
  const id = panelIdFor(entity)
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }

  const title = panelTitleFor(entity)
  const referenceId = opts.referencePanelId ?? api.activePanel?.id
  const reference = referenceId ? api.getPanel(referenceId) : undefined

  const options: AddPanelOptions = {
    id,
    component: entity.kind,
    params: entity.data as Record<string, unknown>,
    title,
  }

  if (opts.floating) {
    options.floating = true
  } else if (opts.splitDirection && reference) {
    options.position = {
      referencePanel: reference.id,
      direction: opts.splitDirection,
    }
  } else if (opts.referenceGroup) {
    options.position = { referenceGroup: opts.referenceGroup }
  }

  api.addPanel(options)
}
