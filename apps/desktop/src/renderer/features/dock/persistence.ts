import type { DockviewApi, GridviewApi } from "dockview-react"

/**
 * Layout persistence is split into two stores:
 *
 * - **Shell** (`agents:shell:v3`) — the outer 3-column gridview (left rail /
 *   center / right rail). Workspace-agnostic, one global value per window.
 * - **Dock** (`agents:dock:project:${workspaceId}` or
 *   `agents:dock:no-workspace`) — the dockview center cell's panel
 *   arrangement (chat / terminal / file / plan / diff / search / files-tree).
 *   Each workspace gets its own snapshot so opening workspace A doesn't drag
 *   in workspace B's terminals and files.
 *
 * Schema bumps invalidate older saved layouts. v2 used a single combined
 * snapshot under `agents:layout:global`; v3 splits the two and keys dock
 * per workspace. Old v2 entries are simply ignored (the user falls back to
 * defaults on first launch after the upgrade).
 */
const SCHEMA_VERSION = 3

export interface ShellSnapshot {
  version: typeof SCHEMA_VERSION
  /** Result of gridApi.toJSON(). */
  shell: unknown | null
}

export interface DockSnapshot {
  version: typeof SCHEMA_VERSION
  /** Result of dockApi.toJSON(). */
  dock: unknown | null
}

const SHELL_KEY = "agents:shell:v3"

export function shellStorageKey(): string {
  return SHELL_KEY
}

export function dockStorageKeyForWorkspace(workspaceId: string | null): string {
  return workspaceId
    ? `agents:dock:project:${workspaceId}`
    : "agents:dock:no-workspace"
}

/**
 * Back-compat alias used by the [+] menu's "Reset layout" action — clearing
 * just this one key drops the global shell layout, which is enough to land
 * the user back on defaults on next reload. Per-workspace dock keys are
 * pruned lazily; a stale dock snapshot for a workspace whose entities don't
 * exist anymore is harmless because tryRestoreDock filters unknown panels.
 */
export function layoutStorageKey(): string {
  return SHELL_KEY
}

export function loadShellSnapshot(): ShellSnapshot | null {
  try {
    const raw = localStorage.getItem(SHELL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ShellSnapshot
    if (parsed?.version !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function saveShellSnapshot(snapshot: ShellSnapshot): void {
  try {
    localStorage.setItem(SHELL_KEY, JSON.stringify(snapshot))
  } catch (err) {
    console.warn("[layout] Failed to persist shell snapshot:", err)
  }
}

export function loadDockSnapshotForWorkspace(
  workspaceId: string | null,
): DockSnapshot | null {
  const key = dockStorageKeyForWorkspace(workspaceId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DockSnapshot
    if (parsed?.version !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDockSnapshotForWorkspace(
  workspaceId: string | null,
  snapshot: DockSnapshot,
): void {
  const key = dockStorageKeyForWorkspace(workspaceId)
  try {
    localStorage.setItem(key, JSON.stringify(snapshot))
  } catch (err) {
    console.warn("[layout] Failed to persist dock snapshot:", err)
  }
}

export function captureShell(grid: GridviewApi | null): ShellSnapshot {
  return {
    version: SCHEMA_VERSION,
    shell: grid ? grid.toJSON() : null,
  }
}

export function captureDock(dock: DockviewApi | null): DockSnapshot {
  return {
    version: SCHEMA_VERSION,
    dock: dock ? dock.toJSON() : null,
  }
}

export function tryRestoreShell(
  grid: GridviewApi | null,
  snapshot: ShellSnapshot | null,
): boolean {
  if (!snapshot?.shell || !grid) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grid.fromJSON(snapshot.shell as any)
    return true
  } catch (err) {
    console.warn("[layout] Failed to restore gridview layout:", err)
    return false
  }
}

export function tryRestoreDock(
  dock: DockviewApi | null,
  snapshot: DockSnapshot | null,
): boolean {
  if (!snapshot?.dock || !dock) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dock.fromJSON(snapshot.dock as any)
    return true
  } catch (err) {
    console.warn("[layout] Failed to restore dockview layout:", err)
    return false
  }
}

/**
 * Returns a debounced layout-saver. Each `schedule(grid, dock, workspaceId)`
 * call buffers the latest state and writes after `delayMs` ms of quiet —
 * shell goes to the global key, dock goes to the workspace-specific key.
 *
 * The workspaceId argument is captured per-call so a save scheduled before
 * a workspace switch still writes to the *outgoing* workspace's key, not
 * the new one. (Workspace transitions also flush synchronously — see the
 * AgentsLayout transition effect — so this matters for in-flight debounced
 * saves only.)
 */
export function makeDebouncedSaver(delayMs = 300): {
  schedule: (
    grid: GridviewApi | null,
    dock: DockviewApi | null,
    workspaceId: string | null,
  ) => void
  flush: () => void
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingGrid: GridviewApi | null = null
  let pendingDock: DockviewApi | null = null
  let pendingWorkspaceId: string | null = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    saveShellSnapshot(captureShell(pendingGrid))
    saveDockSnapshotForWorkspace(pendingWorkspaceId, captureDock(pendingDock))
  }

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (
    grid: GridviewApi | null,
    dock: DockviewApi | null,
    workspaceId: string | null,
  ) => {
    pendingGrid = grid
    pendingDock = dock
    pendingWorkspaceId = workspaceId
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  return { schedule, flush, cancel }
}

// ---------------------------------------------------------------------------
// Back-compat shim for the previous combined snapshot type. Some callers in
// agents-layout.tsx (the ShellContext) still talk in terms of a single
// snapshot at mount; keep the type exported and the read function shaped
// identically so we don't ripple changes across unrelated files. New code
// should prefer the split functions above.
// ---------------------------------------------------------------------------

export interface AgentsLayoutSnapshot {
  version: typeof SCHEMA_VERSION
  shell: unknown | null
  dock: unknown | null
}

export function loadLayoutSnapshot(): AgentsLayoutSnapshot | null {
  const shell = loadShellSnapshot()
  if (!shell) return null
  return { version: SCHEMA_VERSION, shell: shell.shell, dock: null }
}

export function saveLayoutSnapshot(snapshot: AgentsLayoutSnapshot): void {
  saveShellSnapshot({ version: SCHEMA_VERSION, shell: snapshot.shell })
}

export function captureSnapshot(
  grid: GridviewApi | null,
  dock: DockviewApi | null,
): AgentsLayoutSnapshot {
  return {
    version: SCHEMA_VERSION,
    shell: grid ? grid.toJSON() : null,
    dock: dock ? dock.toJSON() : null,
  }
}

export function tryRestore(
  grid: GridviewApi | null,
  dock: DockviewApi | null,
  snapshot: AgentsLayoutSnapshot | null,
): { shell: boolean; dock: boolean } {
  let restoredShell = false
  let restoredDock = false
  if (snapshot?.shell && grid) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      grid.fromJSON(snapshot.shell as any)
      restoredShell = true
    } catch (err) {
      console.warn("[layout] Failed to restore gridview layout:", err)
    }
  }
  if (snapshot?.dock && dock) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dock.fromJSON(snapshot.dock as any)
      restoredDock = true
    } catch (err) {
      console.warn("[layout] Failed to restore dockview layout:", err)
    }
  }
  return { shell: restoredShell, dock: restoredDock }
}
