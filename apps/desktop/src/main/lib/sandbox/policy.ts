import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { existsSync, realpathSync } from "fs"
import { execSync } from "child_process"
import { getDatabase, chats, projects, sandboxSettings } from "../db"
import { eq } from "drizzle-orm"

export interface SandboxPolicy {
  enabled: boolean
  // User-facing writable roots (resolved, no symlink expansion). Used for
  // display, the SDK settings file, and as the canonical paths.
  writableRoots: string[]
  // Pre-expanded set including both `path.resolve` and `fs.realpath` forms of
  // every writable root, so symlinked roots (e.g. macOS /tmp -> /private/tmp,
  // $TMPDIR -> /private/var/folders/...) match either way. Used by
  // `pathIsInsideAny` for enforcement.
  writableRootsExpanded: string[]
  deniedReads: string[]
  osSandboxAvailable: boolean
}

interface SandboxCapabilities {
  macSeatbelt: boolean
  linuxBwrap: boolean
  winNative: boolean
}

let cachedCapabilities: SandboxCapabilities | null = null

export function detectSandboxCapabilities(): SandboxCapabilities {
  if (cachedCapabilities) return cachedCapabilities

  let macSeatbelt = false
  let linuxBwrap = false
  const winNative = process.platform === "win32"

  if (process.platform === "darwin") {
    macSeatbelt = existsSync("/usr/bin/sandbox-exec")
  } else if (process.platform === "linux") {
    try {
      execSync("which bwrap", { stdio: "pipe" })
      linuxBwrap = true
    } catch {
      linuxBwrap = false
    }
  }

  cachedCapabilities = { macSeatbelt, linuxBwrap, winNative }
  return cachedCapabilities
}

export function osSandboxAvailable(): boolean {
  const caps = detectSandboxCapabilities()
  return caps.macSeatbelt || caps.linuxBwrap || caps.winNative
}

/**
 * Realpath that tolerates non-existent paths by walking up to the nearest
 * existing parent and reattaching the trailing segments. Required because
 * write-tool checks happen before the file exists.
 */
function realpathOrWalkUp(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    // Path doesn't exist — find the longest existing prefix and realpath that.
    const parts = p.split(path.sep)
    for (let i = parts.length - 1; i > 0; i--) {
      const prefix = parts.slice(0, i).join(path.sep) || path.sep
      try {
        const real = realpathSync(prefix)
        return path.join(real, ...parts.slice(i))
      } catch {
        continue
      }
    }
    return p
  }
}

/**
 * Returns true if targetPath is inside any of the roots. Compares both the
 * resolved path and its realpath form against each root (also pre-expanded
 * with realpath in the policy), so symlinked locations like macOS /tmp ->
 * /private/tmp match correctly. Uses trailing-separator guard to prevent
 * /foo matching /foobar.
 */
export function pathIsInsideAny(targetPath: string, roots: string[]): boolean {
  const resolved = path.resolve(targetPath)
  const real = realpathOrWalkUp(resolved)
  const candidates = real === resolved ? [resolved] : [resolved, real]

  for (const root of roots) {
    const resolvedRoot = path.resolve(root)
    for (const c of candidates) {
      if (c === resolvedRoot || c.startsWith(resolvedRoot + path.sep)) {
        return true
      }
    }
  }
  return false
}

function expandRootsWithRealpath(roots: string[]): string[] {
  const expanded = new Set<string>()
  for (const root of roots) {
    const resolved = path.resolve(root)
    expanded.add(resolved)
    try {
      expanded.add(realpathSync(resolved))
    } catch {
      // Root doesn't exist (e.g. ~/.cargo on a machine without Rust) — skip.
    }
  }
  return [...expanded]
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

function buildWritableRoots(
  worktreePath: string,
  projectPath: string,
  allowToolchainCaches: boolean,
  extraWritablePaths: string[],
): string[] {
  const home = os.homedir()
  const tmpdir = os.tmpdir()

  const roots = [
    worktreePath,
    path.join(home, ".claude"),
    path.join(home, ".codex"),
    path.join(home, ".churrostack"),
    tmpdir,
    "/tmp",
    path.join(home, ".gitconfig"),
    path.join(home, ".gitconfig.d"),
    path.join(home, ".config", "gh"),
    path.join(projectPath, ".git"),
  ]

  // Windows gh CLI config
  if (process.platform === "win32" && process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "GitHub CLI"))
  }

  if (allowToolchainCaches) {
    roots.push(
      path.join(home, ".npm"),
      path.join(home, ".cache"),
      path.join(home, ".cargo"),
      path.join(home, ".rustup"),
      path.join(home, ".local", "share", "pnpm"),
      path.join(home, ".bun"),
      path.join(home, "go", "pkg", "mod"),
    )
    if (process.platform === "darwin") {
      roots.push(path.join(home, "Library", "Caches"))
    }
  }

  for (const extra of extraWritablePaths) {
    roots.push(expandHome(extra))
  }

  return [...new Set(roots.map(r => path.resolve(r)))]
}

function buildDeniedReads(extraDeniedPaths: string[]): string[] {
  const home = os.homedir()
  const denied = [
    path.join(home, ".aws", "credentials"),
    path.join(home, ".ssh", "id_rsa"),
    path.join(home, ".ssh", "id_ed25519"),
    path.join(home, ".ssh", "id_ecdsa"),
    path.join(home, ".netrc"),
  ]
  for (const extra of extraDeniedPaths) {
    denied.push(expandHome(extra))
  }
  return [...new Set(denied.map(r => path.resolve(r)))]
}

export async function resolveSandboxPolicy(
  chatId: string,
  worktreePath: string,
  projectPath: string,
): Promise<SandboxPolicy> {
  const db = getDatabase()

  // Load chat override
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get()
  let enabledOverride: boolean | null = null

  if (chat && chat.sandboxEnabled !== null && chat.sandboxEnabled !== undefined) {
    enabledOverride = chat.sandboxEnabled as unknown as boolean
  } else if (chat?.projectId) {
    const project = db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
    if (project && project.sandboxEnabled !== null && project.sandboxEnabled !== undefined) {
      enabledOverride = project.sandboxEnabled as unknown as boolean
    }
  }

  // Global settings
  const globalSettings = db.select().from(sandboxSettings).where(eq(sandboxSettings.id, "singleton")).get()

  let extraWritablePaths: string[] = []
  let extraDeniedPaths: string[] = []
  let allowToolchainCaches = true
  const globalDefault = globalSettings ? globalSettings.sandboxEnabled !== false : true

  if (globalSettings) {
    try { extraWritablePaths = JSON.parse(globalSettings.extraWritablePaths) } catch {}
    try { extraDeniedPaths = JSON.parse(globalSettings.extraDeniedPaths) } catch {}
    allowToolchainCaches = globalSettings.allowToolchainCaches !== false
  }

  const enabled = enabledOverride !== null ? enabledOverride : globalDefault

  const writableRoots = buildWritableRoots(worktreePath, projectPath, allowToolchainCaches, extraWritablePaths)
  const deniedReads = buildDeniedReads(extraDeniedPaths)

  return {
    enabled,
    writableRoots,
    writableRootsExpanded: expandRootsWithRealpath(writableRoots),
    deniedReads,
    osSandboxAvailable: osSandboxAvailable(),
  }
}

const CHURRO_WORKTREES_DIR = path.join(os.homedir(), ".churrostack", "worktrees")
const MANAGED_SENTINEL = "__churro_managed"

// Refcount of in-flight turns per managed settings file. The Claude SDK only
// looks at .claude/settings.local.json by name, so multiple chats sharing a
// worktree all point at the same file. Writes are idempotent (content is a
// pure function of the worktree + global settings), but cleanup must wait for
// the last in-flight turn to finish or we'll yank the policy out from under a
// concurrent session.
const activeRefs = new Map<string, number>()

/**
 * Writes a managed .claude/settings.local.json inside the worktree cwd.
 * Only operates when cwd is inside ~/.churrostack/worktrees/ to avoid
 * polluting arbitrary project directories.
 * Returns the path to the written file, or null if skipped.
 */
export async function writeSandboxSettingsFile(
  cwd: string,
  policy: SandboxPolicy,
): Promise<string | null> {
  const resolvedCwd = path.resolve(cwd)
  if (!resolvedCwd.startsWith(CHURRO_WORKTREES_DIR + path.sep)) {
    return null
  }

  const claudeDir = path.join(resolvedCwd, ".claude")
  const settingsPath = path.join(claudeDir, "settings.local.json")

  // Check if file exists and wasn't written by us. If a sibling turn already
  // wrote our managed file (refcount > 0), it's safe to overwrite — content
  // is identical for a given worktree.
  if (existsSync(settingsPath) && (activeRefs.get(settingsPath) ?? 0) === 0) {
    try {
      const existing = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
      if (!existing[MANAGED_SENTINEL]) {
        // User-authored file — don't overwrite
        return null
      }
    } catch {
      // Corrupt JSON — safe to overwrite
    }
  }

  await fs.mkdir(claudeDir, { recursive: true })

  // Paths relative to HOME for sandbox config (SDK resolves ~ internally)
  const home = os.homedir()
  const toSandboxPath = (p: string) => {
    if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length)
    return p
  }

  const sandboxConfig = {
    [MANAGED_SENTINEL]: true,
    permissions: {
      additionalDirectories: policy.writableRoots
        .filter(r => r !== resolvedCwd)
        .map(toSandboxPath),
      deny: policy.deniedReads.map(p => `Read(${toSandboxPath(p)})`),
    },
  }

  await fs.writeFile(settingsPath, JSON.stringify(sandboxConfig, null, 2), "utf-8")
  activeRefs.set(settingsPath, (activeRefs.get(settingsPath) ?? 0) + 1)
  return settingsPath
}

export async function cleanupSandboxSettingsFile(filePath: string): Promise<void> {
  const remaining = (activeRefs.get(filePath) ?? 1) - 1
  if (remaining > 0) {
    activeRefs.set(filePath, remaining)
    return
  }
  activeRefs.delete(filePath)

  try {
    if (!existsSync(filePath)) return
    const content = JSON.parse(await fs.readFile(filePath, "utf-8"))
    if (content[MANAGED_SENTINEL]) {
      await fs.unlink(filePath)
    }
  } catch {
    // Best-effort cleanup
  }
}
