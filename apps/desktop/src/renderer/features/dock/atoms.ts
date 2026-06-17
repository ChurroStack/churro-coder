import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { atomWithWindowStorage } from '../../lib/window-storage';
import type { WidgetId } from '../details-sidebar/atoms';

export type PanelKind =
  | 'chat'
  | 'chat-new'
  | 'terminal'
  | 'file'
  | 'plan'
  | 'review'
  | 'diff'
  | 'search'
  | 'files-tree'
  | 'openspec-change'
  | 'project-settings';

/**
 * Snapshot of a single dockview panel — kept in sync by `DockHotkeysHost`
 * so consumers (e.g. Spotlight's WorkspaceTabsProvider) can list / focus
 * tabs without needing to be inside `DockProvider`.
 */
export interface DockPanelSummary {
  id: string;
  title: string;
  kind: PanelKind | 'main' | string;
  isActive: boolean;
}

export const dockPanelsAtom = atom<DockPanelSummary[]>([]);

export interface ChatPanelEntity {
  subChatId: string;
  /** Parent chat (workspace) id this sub-chat belongs to. Used by ChatPanel
   *  to look up the chat record / sub-chats list. */
  chatId: string;
  /** Present when this chat tab should render the OpenSpec change editor. */
  projectId?: string;
  openspecChangeId?: string | null;
  openspecChangePath?: string;
  /** Initial display name — kept in sync via setTitle when the sub-chat
   *  is renamed in the store. */
  name?: string;
  /** Immutable harness for this subChat. Carried on the dockview params so
   *  the surface router resolves correctly on drag-drop, tear-out, and layout
   *  deserialization — before the async store/query hydration completes. */
  harness?: 'builtin' | 'claude-cli' | 'codex-cli';
}
export interface NewChatPanelEntity {
  draftId?: string;
  projectId: string;
}
export interface TerminalPanelEntity {
  /** Stable PTY identifier — matches the `paneId` registered in the
   *  terminalsAtom store for this terminal. The backend keeps the PTY
   *  alive across mount/unmount cycles keyed by this id. */
  paneId: string;
  /** Display name shown as the dockview tab title (e.g. "Terminal 1"). */
  name: string;
  /** Chat workspace this terminal belongs to — used for cleanup on close
   *  and to look up the per-chat terminal list. */
  chatId: string;
  /** Working directory for the PTY. */
  cwd: string;
  /** Persistence scope id (usually the same as chatId for local chats). */
  workspaceId: string;
  /** Shell commands sent to the PTY immediately after it spawns. Used by
   *  script terminals to run their command on open. */
  initialCommands?: string[];
}
export interface FilePanelEntity {
  absolutePath: string;
  initialLine?: number;
  initialColumn?: number;
  subChatId?: string;
}
export interface PlanPanelEntity {
  chatId: string;
  planPath: string;
}
export interface ReviewPanelEntity {
  subChatId: string;
}
export interface DiffPanelEntity {
  chatId: string;
  subChatId?: string;
}
export interface SearchPanelEntity {
  projectId: string;
  initialQuery?: string;
}
export interface FilesTreePanelEntity {
  projectId: string;
}

export interface OpenSpecChangePanelEntity {
  subChatId: string;
  chatId: string;
  projectId: string;
  changeId: string;
  changePath: string;
  name?: string;
}

/**
 * Per-workspace Project Settings panel. Scoped to `path` (the workspace's own
 * working tree — worktree dir or, for a Local workspace, the base repo) so
 * edits land in that tree and ride along with the branch. One per workspace,
 * keyed by `chatId` (the workspace id).
 */
export interface ProjectSettingsPanelEntity {
  chatId: string;
  projectId: string;
  path: string;
  projectName?: string;
}

export type PanelEntity =
  | { kind: 'chat'; data: ChatPanelEntity }
  | { kind: 'chat-new'; data: NewChatPanelEntity }
  | { kind: 'terminal'; data: TerminalPanelEntity }
  | { kind: 'file'; data: FilePanelEntity }
  | { kind: 'plan'; data: PlanPanelEntity }
  | { kind: 'review'; data: ReviewPanelEntity }
  | { kind: 'diff'; data: DiffPanelEntity }
  | { kind: 'search'; data: SearchPanelEntity }
  | { kind: 'files-tree'; data: FilesTreePanelEntity }
  | { kind: 'openspec-change'; data: OpenSpecChangePanelEntity }
  | { kind: 'project-settings'; data: ProjectSettingsPanelEntity };

export function panelIdFor(entity: PanelEntity): string {
  switch (entity.kind) {
    case 'chat':
      return `chat:${entity.data.subChatId}`;
    case 'chat-new':
      return `chat-new:${entity.data.draftId ?? 'singleton'}`;
    case 'terminal':
      return `terminal:${entity.data.paneId}`;
    case 'file':
      return `file:${entity.data.absolutePath}`;
    case 'plan':
      return `plan:${entity.data.chatId}:${entity.data.planPath}`;
    case 'review':
      return `review:${entity.data.subChatId}`;
    case 'diff':
      return `diff:${entity.data.chatId}`;
    case 'search':
      return `search:${entity.data.projectId}`;
    case 'files-tree':
      return `files-tree:${entity.data.projectId}`;
    case 'openspec-change':
      return `openspec-change:${entity.data.changeId}`;
    case 'project-settings':
      return `project-settings:${entity.data.chatId}`;
  }
}

export function panelTitleFor(entity: PanelEntity): string {
  switch (entity.kind) {
    case 'chat':
      return entity.data.name ?? 'Conversation';
    case 'chat-new':
      return 'New chat';
    case 'terminal':
      return entity.data.name || 'Terminal';
    case 'file': {
      const segs = entity.data.absolutePath.split('/');
      return segs[segs.length - 1] || entity.data.absolutePath;
    }
    case 'plan':
      return 'Plan';
    case 'review':
      return 'Review';
    case 'diff':
      return 'Changes';
    case 'search':
      return 'Search';
    case 'files-tree':
      return 'Files';
    case 'openspec-change':
      return entity.data.name ?? entity.data.changeId;
    case 'project-settings':
      return 'Project Settings';
  }
}

export function widgetMutexKey(widgetId: WidgetId, entityKey: string): string {
  return `${widgetId}:${entityKey}`;
}

export const widgetPanelMapAtom = atomWithWindowStorage<Record<string, string | null>>(
  'dock:widgetPanelMap',
  {},
  { getOnInit: true }
);

export const pinnedPanelIdsAtom = atomWithWindowStorage<string[]>('dock:pinnedPanelIds', [], { getOnInit: true });

export const dockReadyAtom = atom<boolean>(false);

/**
 * Workspaces whose `WorkspaceDockShell` has been mounted in *this session*.
 *
 * The center rail keeps each visited workspace's DockShell rendered (just
 * stacked invisibly when not active) so terminals, chat streams, and panel
 * state survive a switch. This atom drives that — entries are appended on
 * first visit and removed only when the workspace is archived/deleted (or
 * the window reloads, since this is intentionally not persisted).
 */
export const mountedWorkspaceIdsAtom = atom<string[]>([]);

/**
 * Per-workspace "Project Settings panel is open" flag. The `ProjectSettingsPanel`
 * self-registers `true` on mount / `false` on unmount (gated on workspace
 * identity), exactly mirroring the chat-panel self-registration into
 * `openSubChatIds`. `ChatPanelSync` reads this so the `main` placeholder exists
 * iff the workspace has zero anchors (no open chats AND no PS panel) — without
 * it, the openSubChatIds-driven effect wouldn't re-run when only the PS panel
 * opens/closes and `main` would go stale.
 */
export const workspaceProjectSettingsOpenAtomFamily = atomFamily((_workspaceId: string) => atom<boolean>(false));

/**
 * Request to open the Project Settings panel in a specific workspace once its
 * `WorkspaceDockShell` is mounted and active. Seeded by `useOpenLocalWorkspace`
 * (and the layout-reset reseed path) and consumed + cleared by the sync effect
 * in `ChatPanelSync` — mirrors `pendingOpenSpecPanelAtom`.
 */
export interface PendingProjectSettingsPanel {
  chatId: string;
  projectId: string;
  path: string;
  projectName?: string;
}
export const pendingProjectSettingsPanelAtom = atom<PendingProjectSettingsPanel | null>(null);

export type ProjectSettingsSection = 'worktree' | 'env' | 'skills' | 'agents' | 'mcp';

/**
 * The active section of a workspace's Project Settings panel. An atomFamily
 * (keyed by workspaceId) rather than panel-local state so external triggers —
 * e.g. the details-sidebar Scripts/MCP widget gears — can deep-link to a
 * section even when the panel is already open. Defaults to 'worktree'.
 */
export const workspaceProjectSettingsSectionAtomFamily = atomFamily((_workspaceId: string) =>
  atom<ProjectSettingsSection>('worktree')
);
