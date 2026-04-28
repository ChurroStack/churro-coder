export {
  DockProvider,
  useDockApi,
  useGridApi,
  useDockHandles,
  type DockHandles,
} from "./dock-context"
export { DockShell } from "./dock-shell"
export {
  panelIdFor,
  panelTitleFor,
  widgetMutexKey,
  widgetPanelMapAtom,
  pinnedPanelIdsAtom,
  dockReadyAtom,
  mountedWorkspaceIdsAtom,
  type PanelEntity,
  type PanelKind,
} from "./atoms"
export { addOrFocus, type AddOrFocusOptions } from "./add-or-focus"
export { PANEL_COMPONENTS, dockviewComponents } from "./panel-registry"
export { useWidgetPanel, type WidgetPanelHandle } from "./use-widget-panel"
export { usePanelActions, type PanelActions } from "./use-panel-actions"
export { DockHeaderActions } from "./dock-header-actions"
export { ChatPanelSync } from "./chat-panel-sync"
export { WorkspaceDockShell } from "./workspace-dock-shell"
export { DockHotkeysHost } from "./dock-hotkeys-host"
export { RenamableTab, RenameDispatchHost } from "./renamable-tab"
export { ChatTabArchiveHost } from "./chat-tab-archive"
export { TerminalTabCloseHost } from "./terminal-tab-close"
export {
  loadLayoutSnapshot,
  saveLayoutSnapshot,
  captureSnapshot,
  tryRestore,
  makeDebouncedSaver,
  layoutStorageKey,
  loadShellSnapshot,
  saveShellSnapshot,
  loadDockSnapshotForWorkspace,
  saveDockSnapshotForWorkspace,
  captureDock,
  captureShell,
  tryRestoreShell,
  tryRestoreDock,
  type AgentsLayoutSnapshot,
  type DockSnapshot,
  type ShellSnapshot,
} from "./persistence"
