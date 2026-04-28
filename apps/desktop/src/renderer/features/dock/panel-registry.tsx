import type { IDockviewPanelProps } from "dockview-react"
import { PlaceholderPanel } from "./panels/placeholder-panel"
import { MainPanel } from "./panels/main-panel"
import { ChatPanel } from "./panels/chat-panel"
import { PlanPanel } from "./panels/plan-panel"
import { DiffPanel } from "./panels/diff-panel"
import { TerminalPanel } from "./panels/terminal-panel"
import { FilePanel } from "./panels/file-panel"
import { SearchPanel } from "./panels/search-panel"
import { FilesTreePanel } from "./panels/files-tree-panel"
import type { PanelKind } from "./atoms"

export type PanelComponent = React.FunctionComponent<IDockviewPanelProps>

export const PANEL_COMPONENTS: Record<PanelKind, PanelComponent> = {
  chat: ChatPanel,
  "chat-new": PlaceholderPanel,
  terminal: TerminalPanel,
  file: FilePanel,
  plan: PlanPanel,
  diff: DiffPanel,
  search: SearchPanel,
  "files-tree": FilesTreePanel,
}

// Dockview consumes a Record<string, FunctionComponent>. We add the "main"
// singleton workspace shell here — it isn't a regular PanelKind because there's
// only ever one of it.
export const dockviewComponents: Record<string, PanelComponent> = {
  ...PANEL_COMPONENTS,
  main: MainPanel,
}
