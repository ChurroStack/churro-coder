import { useCallback, useContext, useEffect, useState, useMemo, useRef, createContext, type ReactNode } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import { useTheme } from "next-themes"
import {
  GridviewReact,
  Orientation,
  LayoutPriority,
  type GridviewApi,
  type GridviewReadyEvent,
  type IGridviewPanelProps,
} from "dockview-react"
import { isDesktopApp } from "../../lib/utils/platform"
import { useIsMobile } from "../../lib/hooks/use-mobile"

import {
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  claudeLoginModalConfigAtom,
  isDesktopAtom,
  isFullscreenAtom,
  customHotkeysAtom,
  betaKanbanEnabledAtom,
  betaAutomationsEnabledAtom,
} from "../../lib/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom, selectedDraftIdAtom, showNewChatFormAtom, desktopViewAtom } from "../agents/atoms"
import { SpotlightModal } from "../spotlight/spotlight-modal"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { toggleSearchAtom } from "../agents/search"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { CodexLoginModal } from "../../components/dialogs/codex-login-modal"
import { TooltipProvider } from "../../components/ui/tooltip"
import { AgentsSidebar } from "../sidebar/agents-sidebar"
import { UpdateBanner } from "../../components/update-banner"
import { WindowsTitleBar } from "../../components/windows-title-bar"
import { DetailsRail } from "./details-rail"
import { SettingsSidebar } from "../settings/settings-sidebar"
import { SettingsContent } from "../settings/settings-content"
import { UsageContent } from "../usage/usage-content"
import { KanbanView } from "../kanban"
import {
  AutomationsView,
  AutomationsDetailView,
  InboxView,
} from "../automations"
import { NewChatForm } from "../agents/main/new-chat-form"
import {
  detailsSidebarOpenAtom,
  detailsSidebarWidthAtom,
} from "../details-sidebar/atoms"
import {
  DockProvider,
  WorkspaceDockShell,
  RenameDispatchHost,
  ChatTabArchiveHost,
  TerminalTabCloseHost,
  DockHotkeysHost,
  loadShellSnapshot,
  saveShellSnapshot,
  captureShell,
  tryRestoreShell,
  mountedWorkspaceIdsAtom,
  type DockHandles,
  type ShellSnapshot,
} from "../dock"
import type { DockviewApi } from "dockview-react"
import { useUpdateChecker } from "../../lib/hooks/use-update-checker"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { QueueProcessor } from "../agents/components/queue-processor"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 600
const SIDEBAR_DEFAULT_WIDTH = 240
const DETAILS_RAIL_MIN_WIDTH = 310
const DETAILS_RAIL_MAX_WIDTH = 700
const DETAILS_RAIL_DEFAULT_WIDTH = 460

// ============================================================================
// Shell context — bridges parent state into gridview panel renderers
// ============================================================================

interface ShellContextValue {
  onToggleSidebar: () => void
  /** Each workspace's `WorkspaceDockShell` registers its dockApi here so
   *  the layout can route the global DockProvider to whichever shell is
   *  active. Workspaces stay mounted across switches, so multiple
   *  registrations are valid simultaneously — keyed by workspaceId. */
  registerWorkspaceDockApi: (
    workspaceId: string | null,
    api: DockviewApi,
  ) => void
  unregisterWorkspaceDockApi: (workspaceId: string | null) => void
  /** Outer-shell (gridview) snapshot loaded once at mount. Workspace-
   *  agnostic — left/center/right widths and visibility. */
  shellSnapshot: ShellSnapshot | null
  /** Schedule a debounced save of the gridview layout (shell only — each
   *  WorkspaceDockShell handles its own dock save). */
  scheduleShellSave: () => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

function ShellProvider({
  value,
  children,
}: {
  value: ShellContextValue
  children: ReactNode
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

function useShellContext(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error("useShellContext must be used inside ShellProvider")
  return ctx
}

// ============================================================================
// Gridview panel renderers
// ============================================================================

function LeftRailPanel(_props: IGridviewPanelProps) {
  const { onToggleSidebar } = useShellContext()
  const desktopView = useAtomValue(desktopViewAtom)
  const isSettingsView = desktopView === "settings"

  return (
    <div
      className="h-full w-full"
      // Each adjacent cell contributes gap/2 of padding on its inner-facing
      // edge so the visible cell-to-cell gap matches the window-edge gap.
      // Dockview's sash is absolutely positioned over the seam (no flow
      // width), so the two paddings sum cleanly to --shell-gap.
      style={{ paddingRight: "calc(var(--shell-gap) / 2)" }}
    >
      <div
        className="h-full w-full overflow-hidden bg-tl-background border border-border/50"
        style={{
          // Match the dockview groupview corner radius so rails + panel cards
          // read as a single coherent shell.
          borderRadius: "var(--dv-border-radius)",
          // Cell content is fully interactive — opt out of the outer drag region.
          WebkitAppRegion: "no-drag",
        }}
      >
        {isSettingsView ? (
          <SettingsSidebar />
        ) : (
          <AgentsSidebar
            onToggleSidebar={onToggleSidebar}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Resolves which system-wide view (if any) should overlay the workspace
 * shell. None of these views belong to a workspace, so they shouldn't
 * render inside a dockview tab — instead they cover the whole center cell.
 *
 * - `settings` / `usage` / `automations` / `automations-detail` / `inbox`
 *   are explicitly chosen via `desktopViewAtom`.
 * - `kanban` is implicit when the beta flag is on and no chat / draft /
 *   new-workspace flow is active.
 * - `new-workspace` covers every "no chat selected" state that isn't a
 *   different system view — that's the form the user sees when they hit
 *   "New Workspace" or first launch the app.
 */
function useEffectiveSystemView():
  | "settings"
  | "usage"
  | "automations"
  | "automations-detail"
  | "inbox"
  | "kanban"
  | "new-workspace"
  | null {
  const desktopView = useAtomValue(desktopViewAtom)
  const betaKanbanEnabled = useAtomValue(betaKanbanEnabledAtom)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedDraftId = useAtomValue(selectedDraftIdAtom)
  const showNewChatForm = useAtomValue(showNewChatFormAtom)

  if (desktopView !== null) return desktopView
  if (selectedChatId) return null
  if (
    betaKanbanEnabled &&
    !selectedDraftId &&
    !showNewChatForm
  ) {
    return "kanban"
  }
  return "new-workspace"
}

function CenterRailPanel(_props: IGridviewPanelProps) {
  const { registerWorkspaceDockApi, unregisterWorkspaceDockApi } =
    useShellContext()
  const systemView = useEffectiveSystemView()
  const betaAutomationsEnabled = useAtomValue(betaAutomationsEnabledAtom)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const mountedWorkspaceIds = useAtomValue(mountedWorkspaceIdsAtom)

  return (
    <div
      className="h-full w-full"
      // gap/2 on each inner edge — paired with the rails' gap/2 it sums to
      // --shell-gap across the sash (which is absolutely positioned).
      style={{
        paddingLeft: "calc(var(--shell-gap) / 2)",
        paddingRight: "calc(var(--shell-gap) / 2)",
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden bg-background flex flex-col min-w-0"
        style={{
          // Dockview's tab strip drags via its own rule on .dv-tabs-and-actions-
          // container; everything else inside the card is interactive content,
          // so opt out of the outer drag region by default.
          //
          // No border/rounded chrome here on purpose — every dockview groupview
          // styles itself as a card (see .dv-groupview rule in globals.css) so
          // splits read as multiple floating cards rather than panes inside
          // one big card. The outer rails (left/right) keep their wrappers.
          WebkitAppRegion: "no-drag",
        }}
      >
        {/* One DockShell per workspace the user has visited this session,
            stacked absolutely. The active one is fully visible /
            interactive; the rest are invisible / non-interactive but stay
            mounted so terminal PTYs, chat streams, xterm scrollback, scroll
            positions and form drafts all survive a workspace switch. */}
        {mountedWorkspaceIds.map((id) => (
          <WorkspaceDockShell
            key={id}
            workspaceId={id}
            active={id === selectedChatId}
            onDockApiReady={registerWorkspaceDockApi}
            onDockApiDisposed={unregisterWorkspaceDockApi}
          />
        ))}
        {/* System-wide views overlay the dockview surface — they don't
            belong to any workspace, so they shouldn't render inside a tab.
            Inheriting the parent's rounded clip keeps the chrome consistent. */}
        {systemView !== null && (
          <div className="absolute inset-0 z-10 bg-background overflow-hidden">
            {systemView === "settings" && <SettingsContent />}
            {systemView === "usage" && <UsageContent />}
            {systemView === "kanban" && <KanbanView />}
            {systemView === "new-workspace" && (
              <div className="h-full flex flex-col relative overflow-hidden">
                <NewChatForm />
              </div>
            )}
            {betaAutomationsEnabled && systemView === "automations" && (
              <AutomationsView />
            )}
            {betaAutomationsEnabled && systemView === "automations-detail" && (
              <AutomationsDetailView />
            )}
            {betaAutomationsEnabled && systemView === "inbox" && <InboxView />}
          </div>
        )}
      </div>
    </div>
  )
}

const GRID_COMPONENTS: Record<string, React.FunctionComponent<IGridviewPanelProps>> = {
  "left-rail": LeftRailPanel,
  "center": CenterRailPanel,
  "right-rail": DetailsRail,
}

// ============================================================================
// Component
// ============================================================================

export function AgentsLayout() {
  // No useHydrateAtoms - desktop doesn't need SSR, atomWithStorage handles persistence
  const isMobile = useIsMobile()

  // Global desktop/fullscreen state - initialized here at root level
  const [isDesktop, setIsDesktop] = useAtom(isDesktopAtom)
  const [isFullscreen, setIsFullscreen] = useAtom(isFullscreenAtom)

  // Initialize isDesktop on mount
  useEffect(() => {
    setIsDesktop(isDesktopApp())
  }, [setIsDesktop])

  // Subscribe to fullscreen changes from Electron
  useEffect(() => {
    if (
      !isDesktop ||
      typeof window === "undefined" ||
      !window.desktopApi?.windowIsFullscreen
    )
      return

    // Get initial fullscreen state
    window.desktopApi.windowIsFullscreen().then(setIsFullscreen)

    // In dev mode, HMR breaks IPC event subscriptions, so we poll instead
    const isDev = import.meta.env.DEV
    if (isDev) {
      const interval = setInterval(() => {
        window.desktopApi?.windowIsFullscreen?.().then(setIsFullscreen)
      }, 300)
      return () => clearInterval(interval)
    }

    // In production, use events (more efficient)
    const unsubscribe = window.desktopApi.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [isDesktop, setIsFullscreen])

  // UPDATES-DISABLED: re-enable to restore update checking
  // Check for updates on mount and periodically
  // useUpdateChecker()

  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [sidebarWidth, setSidebarWidth] = useAtom(agentsSidebarWidthAtom)
  const detailsOpen = useAtomValue(detailsSidebarOpenAtom)
  const [detailsWidth, setDetailsWidth] = useAtom(detailsSidebarWidthAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const desktopView = useAtomValue(desktopViewAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const betaKanbanEnabled = useAtomValue(betaKanbanEnabledAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const claudeLoginModalConfig = useAtomValue(claudeLoginModalConfigAtom)

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  // While loading, trust localStorage value to prevent clearing on app restart
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker and clearing
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Clear invalid project from storage (only after loading completes)
  useEffect(() => {
    if (
      selectedProject &&
      projects &&
      !isLoadingProjects &&
      !validatedProject
    ) {
      setSelectedProject(null)
    }
  }, [
    selectedProject,
    projects,
    isLoadingProjects,
    validatedProject,
    setSelectedProject,
  ])

  // Sync macOS traffic-light visibility with the left sidebar. The native
  // chrome owns the top-left corner; when the sidebar is open it provides the
  // 78px gutter, when closed we hide the lights so the content can flush left.
  // SettingsSidebar manages its own (always hidden) overrides.
  const isSettingsView = desktopView === "settings"
  useEffect(() => {
    if (!isDesktop) return
    if (isSettingsView) return
    if (
      typeof window === "undefined" ||
      !window.desktopApi?.setTrafficLightVisibility
    )
      return

    window.desktopApi.setTrafficLightVisibility(sidebarOpen)
  }, [sidebarOpen, isDesktop, isFullscreen, isSettingsView])

  const setChatId = useAgentSubChatStore((state) => state.setChatId)

  // Track if this is the initial load - skip auto-open on first load to respect saved state
  const isInitialLoadRef = useRef(true)

  // Auto-open sidebar when project is selected, close when no project
  // Skip on initial load to preserve user's saved sidebar preference
  useEffect(() => {
    if (!projects) return // Don't change sidebar state while loading

    // On initial load, just mark as loaded and don't change sidebar state
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      return
    }

    // After initial load, react to project changes
    if (validatedProject) {
      setSidebarOpen(true)
    } else {
      setSidebarOpen(false)
    }
  }, [validatedProject, projects, setSidebarOpen])

  // Worktree setup failures from main process
  useEffect(() => {
    if (typeof window === "undefined") return
    const desktopApi = window.desktopApi as any
    if (!desktopApi?.onWorktreeSetupFailed) return

    const unsubscribe = desktopApi.onWorktreeSetupFailed((payload: { kind: "create-failed" | "setup-failed"; message: string; projectId: string }) => {
      const errorMessage = payload.message.replace(/\s+/g, " ").trim()
      const title =
        payload.kind === "create-failed"
          ? "Worktree creation failed"
          : "Worktree setup failed"

      toast.error(title, {
        description: errorMessage || undefined,
        duration: 10000,
        action: {
          label: "Open settings",
          onClick: () => {
            const projectMatch = projects?.find((project) => project.id === payload.projectId)
            if (projectMatch) {
              setSelectedProject(projectMatch as any)
            }
            setSettingsActiveTab("projects")
            setSettingsDialogOpen(true)
          },
        },
      })
    })

    return unsubscribe
  }, [projects, setSelectedProject, setSettingsActiveTab, setSettingsDialogOpen])

  // Source of truth for the store's "current workspace". Each ChatView
  // used to call setChatId itself, but with multiple WorkspaceDockShells
  // mounted simultaneously that race — so we centralize it here. The
  // store is always scoped to the currently-selected workspace; inactive
  // workspaces' state lives in localStorage until they become active.
  useEffect(() => {
    setChatId(selectedChatId)
  }, [selectedChatId, setChatId])

  // Chat search toggle
  const toggleChatSearch = useSetAtom(toggleSearchAtom)

  // Custom hotkeys config
  const customHotkeysConfig = useAtomValue(customHotkeysAtom)

  // Initialize hotkeys manager
  useAgentsHotkeys({
    setSelectedChatId,
    setSelectedDraftId,
    setShowNewChatForm,
    setDesktopView,
    setSidebarOpen,
    setSettingsActiveTab,
    toggleChatSearch,
    selectedChatId,
    customHotkeysConfig,
    betaKanbanEnabled,
  })

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  // Whether a system-wide view is currently overlaying the dockview.
  // Settings / Usage / Kanban / Automations / Inbox / New Workspace
  // all suppress the workspace surface and the right-rail widgets are
  // workspace-scoped — so we hide the rail in those modes too.
  const layoutSystemView = useEffectiveSystemView()

  // ============================================================================
  // Gridview wiring — outer 3-column shell (left rail / center / right rail).
  // Right rail is added in step 5 when DetailsSidebar is lifted out of ChatView.
  // ============================================================================

  const gridApiRef = useRef<GridviewApi | null>(null)
  const { resolvedTheme } = useTheme()
  const dockviewThemeClass =
    resolvedTheme === "dark" ? "cs-theme-dark" : "cs-theme-light"

  // Apply our custom dockview theme class to <html> so the --dv-* tokens
  // defined in globals.css cascade everywhere — including dockview portals
  // (floating groups, drop-target overlays) that mount outside the dock tree
  // into document.body. The matching class is also passed to DockviewReact
  // via the `theme` prop (see dock-shell.tsx), so dockview applies it to its
  // own .dv-dockview root too. Owning the class name (rather than reusing
  // vendor's `dockview-theme-light/-dark`) is what makes our token overrides
  // stick — see the comment block in dock-shell.tsx for the full reasoning.
  useEffect(() => {
    const html = document.documentElement
    html.classList.remove("cs-theme-light", "cs-theme-dark")
    html.classList.add(dockviewThemeClass)
    return () => {
      html.classList.remove("cs-theme-light", "cs-theme-dark")
    }
  }, [dockviewThemeClass])

  // macOS: re-apply the custom traffic-light position whenever a system
  // view is unmounted (e.g. user navigates back from Settings). Mounting
  // / unmounting the absolute overlay can prompt Electron to reset the
  // lights to their default location; clicking the window content
  // recomputes them but until then they're misplaced. Pinging main on
  // every transition fixes it without waiting for a click.
  useEffect(() => {
    const api = window.desktopApi
    if (!api?.resetTrafficLightPosition) return
    // requestAnimationFrame so the browser settles the layout reflow from
    // the overlay mount/unmount before we ask Electron to re-pin.
    const handle = requestAnimationFrame(() => {
      api.resetTrafficLightPosition().catch(() => {})
    })
    return () => cancelAnimationFrame(handle)
  }, [layoutSystemView])

  // Layout persistence:
  // - Shell snapshot (the outer 3-column gridview) is global, loaded once.
  // - Dock snapshot is per-workspace and owned by each WorkspaceDockShell.
  //   It saves to its own LS key and restores on mount.
  const shellSnapshot = useMemo(() => loadShellSnapshot(), [])

  // Per-workspace dock api registry. Each WorkspaceDockShell calls into
  // this when its dockview becomes ready; the global DockProvider then
  // routes consumers (`usePanelActions`, `addOrFocus`, `useWidgetPanel`)
  // to whichever shell is active.
  const [workspaceDockApis, setWorkspaceDockApis] = useState<
    Record<string, DockviewApi>
  >({})

  const registerWorkspaceDockApi = useCallback(
    (workspaceId: string | null, api: DockviewApi) => {
      const key = workspaceId ?? "__none__"
      setWorkspaceDockApis((prev) => ({ ...prev, [key]: api }))
    },
    [],
  )

  const unregisterWorkspaceDockApi = useCallback(
    (workspaceId: string | null) => {
      const key = workspaceId ?? "__none__"
      setWorkspaceDockApis((prev) => {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    },
    [],
  )

  // Track which workspaces have been visited this session — that's the
  // set whose WorkspaceDockShells stay mounted. Append on first visit;
  // entries persist for the lifetime of the window so terminals / chat
  // streams survive any number of switches.
  const setMountedWorkspaceIds = useSetAtom(mountedWorkspaceIdsAtom)
  useEffect(() => {
    if (!selectedChatId) return
    setMountedWorkspaceIds((prev) =>
      prev.includes(selectedChatId) ? prev : [...prev, selectedChatId],
    )
  }, [selectedChatId, setMountedWorkspaceIds])

  // Debounced shell-only saver. The dock part is handled per workspace
  // inside each WorkspaceDockShell.
  const shellSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleShellSave = useCallback(() => {
    if (shellSaveTimerRef.current) clearTimeout(shellSaveTimerRef.current)
    shellSaveTimerRef.current = setTimeout(() => {
      saveShellSnapshot(captureShell(gridApiRef.current))
    }, 300)
  }, [])

  // Flush any pending shell save on unmount (e.g. window close).
  useEffect(() => {
    return () => {
      if (shellSaveTimerRef.current) {
        clearTimeout(shellSaveTimerRef.current)
        saveShellSnapshot(captureShell(gridApiRef.current))
      }
    }
  }, [])

  const handleGridReady = useCallback(
    ({ api }: GridviewReadyEvent) => {
      gridApiRef.current = api

      const restored = tryRestoreShell(api, shellSnapshot)

      // Re-apply size constraints on every init — restoration from snapshot
      // does not carry minimumWidth/maximumWidth so the user could drag below
      // the floor if we skip this.
      const leftPanel = api.getPanel("left-rail")
      if (leftPanel) {
        leftPanel.api.setConstraints({ minimumWidth: SIDEBAR_MIN_WIDTH, maximumWidth: SIDEBAR_MAX_WIDTH })
      }
      const rightPanel = api.getPanel("right-rail")
      if (rightPanel) {
        rightPanel.api.setConstraints({ minimumWidth: DETAILS_RAIL_MIN_WIDTH, maximumWidth: DETAILS_RAIL_MAX_WIDTH })
        // Clamp the restored size to the new floor in case the snapshot has a smaller value.
        const currentWidth = rightPanel.api.width
        if (currentWidth && currentWidth < DETAILS_RAIL_MIN_WIDTH) {
          rightPanel.api.setSize({ width: DETAILS_RAIL_MIN_WIDTH })
        }
      }

      if (!restored) {
        // First-run / unrestorable: build the default 3-cell layout.
        const initialLeftWidth = Math.min(
          Math.max(sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH),
          SIDEBAR_MAX_WIDTH,
        )
        const initialRightWidth = Math.min(
          Math.max(detailsWidth ?? DETAILS_RAIL_DEFAULT_WIDTH, DETAILS_RAIL_MIN_WIDTH),
          DETAILS_RAIL_MAX_WIDTH,
        )
        api.addPanel({
          id: "left-rail",
          component: "left-rail",
          minimumWidth: SIDEBAR_MIN_WIDTH,
          maximumWidth: SIDEBAR_MAX_WIDTH,
        })
        api.addPanel({
          id: "center",
          component: "center",
          priority: LayoutPriority.High,
          position: { referencePanel: "left-rail", direction: "right" },
        })
        api.addPanel({
          id: "right-rail",
          component: "right-rail",
          minimumWidth: DETAILS_RAIL_MIN_WIDTH,
          maximumWidth: DETAILS_RAIL_MAX_WIDTH,
          position: { referencePanel: "center", direction: "right" },
        })
        const left = api.getPanel("left-rail")
        if (left) {
          left.api.setSize({ width: initialLeftWidth })
          left.api.setVisible(!isMobile && sidebarOpen)
        }
        const right = api.getPanel("right-rail")
        if (right) {
          right.api.setSize({ width: initialRightWidth })
          // Hide the rail unconditionally when there's no chat selected
          // OR a system view is overlaying the dockview — its widgets
          // ("Select a chat to see details" otherwise) are all workspace-
          // scoped, so showing them on the New Workspace / Settings /
          // Kanban / Usage surfaces is just empty noise.
          right.api.setVisible(
            detailsOpen && !!selectedChatId && layoutSystemView === null,
          )
        }
      }

      // Persist width on layout change + schedule a snapshot save.
      api.onDidLayoutChange(() => {
        const left = api.getPanel("left-rail")
        if (left?.api.isVisible) {
          const w = left.api.width
          if (w && w !== sidebarWidth) setSidebarWidth(w)
        }
        const right = api.getPanel("right-rail")
        if (right?.api.isVisible) {
          const w = right.api.width
          const clampedW = w ? Math.max(w, DETAILS_RAIL_MIN_WIDTH) : w
          if (clampedW && clampedW !== detailsWidth) setDetailsWidth(clampedW)
        }
        scheduleShellSave()
      })
    },
    // Intentionally only on mount — subsequent atom changes are pushed via the
    // useEffect below; this callback only runs once when gridview is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shellSnapshot, scheduleShellSave],
  )

  // Sync sidebar open state with the gridview left panel.
  useEffect(() => {
    const api = gridApiRef.current
    if (!api) return
    const left = api.getPanel("left-rail")
    if (!left) return
    const shouldShow = !isMobile && sidebarOpen
    if (left.api.isVisible !== shouldShow) {
      left.api.setVisible(shouldShow)
    }
  }, [isMobile, sidebarOpen])

  // Sync details rail open state with the gridview right panel. The rail
  // is force-hidden when (a) no chat is selected or (b) a system view is
  // overlaying the dockview — its widgets only have meaning while a
  // workspace's chat is in focus. When the user navigates back to a
  // workspace the rail restores to whatever they last set via
  // `detailsOpen`.
  useEffect(() => {
    const api = gridApiRef.current
    if (!api) return
    const right = api.getPanel("right-rail")
    if (!right) return
    const shouldShow =
      detailsOpen && !!selectedChatId && layoutSystemView === null
    if (right.api.isVisible !== shouldShow) {
      right.api.setVisible(shouldShow)
    }
  }, [detailsOpen, selectedChatId, layoutSystemView])

  // The active workspace's dockApi — that's what `usePanelActions`,
  // `addOrFocus`, etc. should target. When the user switches workspaces,
  // the React tree doesn't tear down (each WorkspaceDockShell stays
  // mounted with its own dockview); we just point the global DockProvider
  // at the new active shell.
  const activeDockApi =
    workspaceDockApis[selectedChatId ?? "__none__"] ?? null

  const shellCtxValue = useMemo<ShellContextValue>(
    () => ({
      onToggleSidebar: handleCloseSidebar,
      registerWorkspaceDockApi,
      unregisterWorkspaceDockApi,
      shellSnapshot,
      scheduleShellSave,
    }),
    [
      handleCloseSidebar,
      registerWorkspaceDockApi,
      unregisterWorkspaceDockApi,
      shellSnapshot,
      scheduleShellSave,
    ],
  )

  const dockHandles = useMemo<DockHandles>(
    () => ({ dock: activeDockApi, grid: gridApiRef.current }),
    [activeDockApi],
  )

  return (
    <TooltipProvider delayDuration={300}>
      {/* Global queue processor - handles message queues for all sub-chats */}
      <QueueProcessor />
      <ClaudeLoginModal
        hideCustomModelSettingsLink={
          claudeLoginModalConfig.hideCustomModelSettingsLink
        }
        autoStartAuth={claudeLoginModalConfig.autoStartAuth}
      />
      <CodexLoginModal />
      <SpotlightModal />
      <DockProvider value={dockHandles}>
        {/* ChatPanelSync runs *inside* each WorkspaceDockShell now —
            scoped to that workspace and gated by `active` — so the
            globally-mounted version is gone. */}
        <RenameDispatchHost />
        <ChatTabArchiveHost />
        <TerminalTabCloseHost />
        <DockHotkeysHost />
        <ShellProvider value={shellCtxValue}>
          <div className="flex flex-col w-full h-full relative overflow-hidden bg-background select-none">
            {/* Windows-only custom title bar (frameless window with min/max/close).
                On macOS we let the native chrome show traffic lights over the
                content; per-section drag strips provide the rest of the drag area. */}
            <WindowsTitleBar />
            <div
              className="flex-1 min-h-0"
              style={{
                // Full --shell-gap on all four window edges. Inter-cell gaps
                // are matched by inset padding inside each rail's renderer
                // (see CenterRail/LeftRail/DetailsRail) — gap/2 on each side
                // of the absolutely-positioned sash sums to --shell-gap.
                padding: "var(--shell-gap)",
                // Outer gutter is draggable so users can move the window from
                // the strip around the rails. The inner div below opts back
                // out so the gridview sash + cell contents stay interactive.
                WebkitAppRegion: "drag",
              }}
            >
              <div
                className="h-full w-full"
                style={{
                  WebkitAppRegion: "no-drag",
                }}
              >
                <GridviewReact
                  orientation={Orientation.HORIZONTAL}
                  components={GRID_COMPONENTS}
                  onReady={handleGridReady}
                  proportionalLayout={false}
                  className="h-full w-full"
                />
              </div>
            </div>
            {/* UPDATES-DISABLED: re-enable to restore update banner */}
            {/* <UpdateBanner /> */}
          </div>
        </ShellProvider>
      </DockProvider>
    </TooltipProvider>
  )
}
