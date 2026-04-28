import { atom } from "jotai"
import { atomWithWindowStorage } from "../../lib/window-storage"
import type { WidgetId } from "../details-sidebar/atoms"

export type PanelKind =
  | "chat"
  | "chat-new"
  | "terminal"
  | "file"
  | "plan"
  | "diff"
  | "search"
  | "files-tree"

/**
 * Snapshot of a single dockview panel — kept in sync by `DockHotkeysHost`
 * so consumers (e.g. Spotlight's WorkspaceTabsProvider) can list / focus
 * tabs without needing to be inside `DockProvider`.
 */
export interface DockPanelSummary {
  id: string
  title: string
  kind: PanelKind | "main" | string
  isActive: boolean
}

export const dockPanelsAtom = atom<DockPanelSummary[]>([])

export interface ChatPanelEntity {
  subChatId: string
  /** Parent chat (workspace) id this sub-chat belongs to. Used by ChatPanel
   *  to look up the chat record / sub-chats list. */
  chatId: string
  /** Initial display name — kept in sync via setTitle when the sub-chat
   *  is renamed in the store. */
  name?: string
}
export interface NewChatPanelEntity {
  draftId?: string
  projectId: string
}
export interface TerminalPanelEntity {
  /** Stable PTY identifier — matches the `paneId` registered in the
   *  terminalsAtom store for this terminal. The backend keeps the PTY
   *  alive across mount/unmount cycles keyed by this id. */
  paneId: string
  /** Display name shown as the dockview tab title (e.g. "Terminal 1"). */
  name: string
  /** Chat workspace this terminal belongs to — used for cleanup on close
   *  and to look up the per-chat terminal list. */
  chatId: string
  /** Working directory for the PTY. */
  cwd: string
  /** Persistence scope id (usually the same as chatId for local chats). */
  workspaceId: string
}
export interface FilePanelEntity {
  absolutePath: string
  initialLine?: number
  initialColumn?: number
}
export interface PlanPanelEntity {
  chatId: string
  planPath: string
}
export interface DiffPanelEntity {
  chatId: string
  subChatId?: string
}
export interface SearchPanelEntity {
  projectId: string
  initialQuery?: string
}
export interface FilesTreePanelEntity {
  projectId: string
}

export type PanelEntity =
  | { kind: "chat"; data: ChatPanelEntity }
  | { kind: "chat-new"; data: NewChatPanelEntity }
  | { kind: "terminal"; data: TerminalPanelEntity }
  | { kind: "file"; data: FilePanelEntity }
  | { kind: "plan"; data: PlanPanelEntity }
  | { kind: "diff"; data: DiffPanelEntity }
  | { kind: "search"; data: SearchPanelEntity }
  | { kind: "files-tree"; data: FilesTreePanelEntity }

export function panelIdFor(entity: PanelEntity): string {
  switch (entity.kind) {
    case "chat":
      return `chat:${entity.data.subChatId}`
    case "chat-new":
      return `chat-new:${entity.data.draftId ?? "singleton"}`
    case "terminal":
      return `terminal:${entity.data.paneId}`
    case "file":
      return `file:${entity.data.absolutePath}`
    case "plan":
      return `plan:${entity.data.chatId}:${entity.data.planPath}`
    case "diff":
      return `diff:${entity.data.chatId}`
    case "search":
      return `search:${entity.data.projectId}`
    case "files-tree":
      return `files-tree:${entity.data.projectId}`
  }
}

export function panelTitleFor(entity: PanelEntity): string {
  switch (entity.kind) {
    case "chat":
      return entity.data.name ?? "Conversation"
    case "chat-new":
      return "New chat"
    case "terminal":
      return entity.data.name || "Terminal"
    case "file": {
      const segs = entity.data.absolutePath.split("/")
      return segs[segs.length - 1] || entity.data.absolutePath
    }
    case "plan":
      return "Plan"
    case "diff":
      return "Changes"
    case "search":
      return "Search"
    case "files-tree":
      return "Files"
  }
}

export function widgetMutexKey(widgetId: WidgetId, entityKey: string): string {
  return `${widgetId}:${entityKey}`
}

export const widgetPanelMapAtom = atomWithWindowStorage<Record<string, string | null>>(
  "dock:widgetPanelMap",
  {},
  { getOnInit: true },
)

export const pinnedPanelIdsAtom = atomWithWindowStorage<string[]>(
  "dock:pinnedPanelIds",
  [],
  { getOnInit: true },
)

export const dockReadyAtom = atom<boolean>(false)

/**
 * Workspaces whose `WorkspaceDockShell` has been mounted in *this session*.
 *
 * The center rail keeps each visited workspace's DockShell rendered (just
 * stacked invisibly when not active) so terminals, chat streams, and panel
 * state survive a switch. This atom drives that — entries are appended on
 * first visit and removed only when the workspace is archived/deleted (or
 * the window reloads, since this is intentionally not persisted).
 */
export const mountedWorkspaceIdsAtom = atom<string[]>([])
