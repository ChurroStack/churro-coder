/**
 * Pure helpers for the workspace "anchor" invariant — kept free of any
 * window/store/dockview imports so they can be unit-tested in the Node test
 * environment (importing the renamable-tab component would pull in
 * `atomWithWindowStorage`, which touches `window` at module load).
 *
 * An "anchor" panel is one a workspace must keep at least one of: a chat, an
 * OpenSpec editor, or the Project Settings panel. The close X on the sole anchor
 * is disabled so a workspace never collapses to zero surfaces.
 */
export function isAnchorPanelId(id: string): boolean {
  return id.startsWith('chat:') || id.startsWith('openspec-change:') || id.startsWith('project-settings:');
}

export function countAnchorPanels(panels: { id: string }[]): number {
  let n = 0;
  for (const p of panels) {
    if (isAnchorPanelId(p.id)) n++;
  }
  return n;
}

export interface CloseDisableState {
  isAnchorPanel: boolean;
  /** The sole remaining anchor — closing it would leave the workspace with no
   *  chat / OpenSpec editor / Project Settings surface. */
  isLastAnchor: boolean;
  /** The only tab in the dock, of any kind. */
  isOnlyPanel: boolean;
  closeDisabled: boolean;
}

/**
 * Pure close-disable decision for a dock tab. Extracted from the component so
 * the invariant can be unit-tested without dockview/store mocks (CI-safe).
 */
export function computeCloseDisableState(
  panelId: string,
  anchorPanelCount: number,
  totalPanelCount: number
): CloseDisableState {
  const isAnchorPanel = isAnchorPanelId(panelId);
  const isLastAnchor = isAnchorPanel && anchorPanelCount <= 1;
  const isOnlyPanel = totalPanelCount <= 1;
  return { isAnchorPanel, isLastAnchor, isOnlyPanel, closeDisabled: isLastAnchor || isOnlyPanel };
}
