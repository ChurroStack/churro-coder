import { app, BrowserWindow, dialog, Menu, nativeImage } from "electron"
import { existsSync, readFileSync, readlinkSync, unlinkSync } from "fs"
import { createServer } from "http"
import { join } from "path"
import { AuthManager, initAuthManager, getAuthManager as getAuthManagerFromModule } from "./auth-manager"
import {
  initAnalytics,
  shutdown as shutdownAnalytics,
  trackAppOpened,
} from "./lib/analytics"
import {
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  setupFocusUpdateCheck,
} from "./lib/auto-updater"
import { closeDatabase, initDatabase } from "./lib/db"
import {
  getLaunchDirectory,
  isCliInstalled,
  installCli,
  uninstallCli,
  parseLaunchDirectory,
} from "./lib/cli"
import { cleanupGitWatchers } from "./lib/git/watcher"
import { cancelAllPendingOAuth, handleMcpOAuthCallback } from "./lib/mcp-auth"
import { getAllMcpConfigHandler, hasActiveClaudeSessions, abortAllClaudeSessions } from "./lib/trpc/routers/claude"
import { getAllCodexMcpConfigHandler, hasActiveCodexStreams, abortAllCodexStreams } from "./lib/trpc/routers/codex"
import {
  createMainWindow,
  createWindow,
  getWindow,
  getAllWindows,
  setIsQuitting,
} from "./windows/main"
import { windowManager } from "./windows/window-manager"

import { IS_DEV, AUTH_SERVER_PORT } from "./constants"

// Deep link protocol (must match package.json build.protocols.schemes)
// Use different protocol in dev to avoid conflicts with production app
const PROTOCOL = IS_DEV ? "cscode-dev" : "cscode"

// Set dev mode userData path BEFORE requestSingleInstanceLock()
// This ensures dev and prod have separate instance locks
if (IS_DEV) {
  const { join } = require("path")
  const devUserData = join(app.getPath("userData"), "..", "CS Coder Dev")
  app.setPath("userData", devUserData)
  console.log("[Dev] Using separate userData path:", devUserData)
}

// Increase V8 old-space limit for renderer/main processes to reduce OOM frequency
// under heavy multi-chat workloads. Must be set before app readiness/window creation.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192")

// URL configuration — kept as empty string since remote calls are removed
export function getBaseUrl(): string {
  return ""
}

export function getAppUrl(): string {
  return process.env.ELECTRON_RENDERER_URL || ""
}

// Auth manager singleton (use the one from auth-manager module)
let authManager: AuthManager

export function getAuthManager(): AuthManager {
  // First try to get from module, fallback to local variable for backwards compat
  return getAuthManagerFromModule() || authManager
}

// Handle deep link — only MCP OAuth is supported (remote auth removed)
function handleDeepLink(url: string): void {
  console.log("[DeepLink] Received:", url)

  try {
    const parsed = new URL(url)

    // Handle MCP OAuth callback: cscode://mcp-oauth?code=xxx&state=yyy
    if (parsed.pathname === "/mcp-oauth" || parsed.host === "mcp-oauth") {
      const code = parsed.searchParams.get("code")
      const state = parsed.searchParams.get("state")
      if (code && state) {
        handleMcpOAuthCallback(code, state)
        return
      }
    }
  } catch (e) {
    console.error("[DeepLink] Failed to parse:", e)
  }
}

// Register protocol BEFORE app is ready
console.log("[Protocol] ========== PROTOCOL REGISTRATION ==========")
console.log("[Protocol] Protocol:", PROTOCOL)
console.log("[Protocol] Is dev mode (process.defaultApp):", process.defaultApp)
console.log("[Protocol] process.execPath:", process.execPath)
console.log("[Protocol] process.argv:", process.argv)

/**
 * Register the app as the handler for our custom protocol.
 * On macOS, this may not take effect immediately on first install -
 * Launch Services caches protocol handlers and may need time to update.
 */
function registerProtocol(): boolean {
  let success = false

  if (process.defaultApp) {
    // Dev mode: need to pass execPath and script path
    if (process.argv.length >= 2) {
      success = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1]!,
      ])
      console.log(
        `[Protocol] Dev mode registration:`,
        success ? "success" : "failed",
      )
    } else {
      console.warn("[Protocol] Dev mode: insufficient argv for registration")
    }
  } else {
    // Production mode
    success = app.setAsDefaultProtocolClient(PROTOCOL)
    console.log(
      `[Protocol] Production registration:`,
      success ? "success" : "failed",
    )
  }

  return success
}

// Store initial registration result (set in app.whenReady())
let initialRegistration = false

// Verify registration (this checks if OS recognizes us as the handler)
function verifyProtocolRegistration(): void {
  const isDefault = process.defaultApp
    ? app.isDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1]!,
      ])
    : app.isDefaultProtocolClient(PROTOCOL)

  console.log(`[Protocol] Verification - isDefaultProtocolClient: ${isDefault}`)

  if (!isDefault && initialRegistration) {
    console.warn(
      "[Protocol] Registration returned success but verification failed.",
    )
    console.warn(
      "[Protocol] This is common on first install - macOS Launch Services may need time to update.",
    )
    console.warn("[Protocol] The protocol should work after app restart.")
  }
}

console.log("[Protocol] =============================================")

// Note: app.on("open-url") will be registered in app.whenReady()

// Start local HTTP server for MCP OAuth callbacks only
const server = createServer((req, res) => {
    const url = new URL(req.url || "", `http://localhost:${AUTH_SERVER_PORT}`)

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      console.log(
        "[Auth Server] Received MCP OAuth callback with code:",
        code?.slice(0, 8) + "...",
        "state:",
        state?.slice(0, 8) + "...",
      )

      if (code && state) {
        handleMcpOAuthCallback(code, state)
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CS Coder - MCP Authentication</title></head><body><h1 style="font-family:system-ui;text-align:center;margin-top:40px">MCP Server authenticated — you can close this tab</h1><script>setTimeout(()=>window.close(),1000)</script></body></html>`)
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Missing code or state parameter")
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not found")
    }
  })

server.listen(AUTH_SERVER_PORT, () => {
  console.log(`[Auth Server] Listening on http://localhost:${AUTH_SERVER_PORT}`)
})

// Clean up stale lock files from crashed instances
// Returns true if locks were cleaned, false otherwise
function cleanupStaleLocks(): boolean {
  const userDataPath = app.getPath("userData")
  const lockPath = join(userDataPath, "SingletonLock")

  if (!existsSync(lockPath)) return false

  try {
    // SingletonLock is a symlink like "hostname-pid"
    const lockTarget = readlinkSync(lockPath)
    const match = lockTarget.match(/-(\d+)$/)
    if (match) {
      const pid = parseInt(match[1], 10)
      try {
        // Check if process is running (signal 0 doesn't kill, just checks)
        process.kill(pid, 0)
        // Process exists, lock is valid
        console.log("[App] Lock held by running process:", pid)
        return false
      } catch {
        // Process doesn't exist, clean up stale locks
        console.log("[App] Cleaning stale locks (pid", pid, "not running)")
        const filesToRemove = ["SingletonLock", "SingletonSocket", "SingletonCookie"]
        for (const file of filesToRemove) {
          const filePath = join(userDataPath, file)
          if (existsSync(filePath)) {
            try {
              unlinkSync(filePath)
            } catch (e) {
              console.warn("[App] Failed to remove", file, e)
            }
          }
        }
        return true
      }
    }
  } catch (e) {
    console.warn("[App] Failed to check lock file:", e)
  }
  return false
}

// Prevent multiple instances
let gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Maybe stale lock - try cleanup and retry once
  const cleaned = cleanupStaleLocks()
  if (cleaned) {
    gotTheLock = app.requestSingleInstanceLock()
  }
  if (!gotTheLock) {
    app.quit()
  }
}

if (gotTheLock) {
  // Handle second instance launch (also handles deep links on Windows/Linux)
  app.on("second-instance", (_event, commandLine) => {
    // Check for deep link in command line args
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleDeepLink(url)
    }

    // Focus on the first available window
    const windows = getAllWindows()
    if (windows.length > 0) {
      const window = windows[0]!
      if (window.isMinimized()) window.restore()
      window.focus()
    } else {
      // No windows open, create a new one
      createMainWindow()
    }
  })

  // App ready
  app.whenReady().then(async () => {
    // Set dev mode app name (userData path was already set before requestSingleInstanceLock)
    // if (IS_DEV) {
    //   app.name = "Agents Dev"
    // }


    // Register protocol handler (must be after app is ready)
    initialRegistration = registerProtocol()

    // Handle deep link on macOS (app already running)
    app.on("open-url", (event, url) => {
      console.log("[Protocol] open-url event received:", url)
      event.preventDefault()
      handleDeepLink(url)
    })

    // Set app user model ID for Windows (different in dev to avoid taskbar conflicts)
    if (process.platform === "win32") {
      app.setAppUserModelId(IS_DEV ? "com.churrostack.code.dev" : "com.churrostack.code")
    }

    console.log(`[App] Starting CS Coder${IS_DEV ? " (DEV)" : ""}...`)

    // Verify protocol registration after app is ready
    // This helps diagnose first-install issues where the protocol isn't recognized yet
    verifyProtocolRegistration()

    // Get Claude Code version for About panel
    let claudeCodeVersion = "unknown"
    try {
      const isDev = !app.isPackaged
      const versionPath = isDev
        ? join(app.getAppPath(), "resources/bin/VERSION")
        : join(process.resourcesPath, "bin/VERSION")

      if (existsSync(versionPath)) {
        const versionContent = readFileSync(versionPath, "utf-8")
        claudeCodeVersion = versionContent.split("\n")[0]?.trim() || "unknown"
      }
    } catch (error) {
      console.warn("[App] Failed to read Claude Code version:", error)
    }

    // Set About panel options with Claude Code version
    app.setAboutPanelOptions({
      applicationName: "CS Coder",
      applicationVersion: app.getVersion(),
      version: `Claude Code ${claudeCodeVersion}`,
      copyright: "Copyright © 2026 ChurroStack",
    })

    // Track update availability for menu
    let updateAvailable = false
    let availableVersion: string | null = null
    // Track devtools unlock state (hidden feature - 5 clicks on Beta tab)
    let devToolsUnlocked = false

    // Menu icons: PNG template for settings (auto light/dark via "Template" suffix),
    // macOS native SF Symbol for terminal
    const settingsMenuIcon = nativeImage.createFromPath(
      join(__dirname, "../../build/settingsTemplate.png")
    )
    const terminalMenuIcon = process.platform === "darwin"
      ? nativeImage.createFromNamedImage("terminal")?.resize({ width: 12, height: 12 })
      : null

    // Function to build and set application menu
    const buildMenu = () => {
      const showDevTools = true
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: app.name,
          submenu: [
            {
              label: "About CS Coder",
              click: () => app.showAboutPanel(),
            },
            // UPDATES-DISABLED: re-enable to restore "Check for Updates..." menu item
            /*
            {
              label: updateAvailable
                ? `Update to v${availableVersion}...`
                : "Check for Updates...",
              click: () => {
                // Send event to renderer to clear dismiss state
                const win = getWindow()
                if (win) {
                  win.webContents.send("update:manual-check")
                }
                // If update is already available, start downloading immediately
                if (updateAvailable) {
                  downloadUpdate()
                } else {
                  checkForUpdates(true)
                }
              },
            },
            */
            { type: "separator" },
            {
              label: "Settings...",
              ...(settingsMenuIcon && { icon: settingsMenuIcon }),
              accelerator: "CmdOrCtrl+,",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.webContents.send("shortcut:open-settings")
                }
              },
            },
            { type: "separator" },
            {
              label: isCliInstalled()
                ? "Uninstall 'cscode' Command..."
                : "Install 'cscode' Command in PATH...",
              ...(terminalMenuIcon && { icon: terminalMenuIcon }),
              click: async () => {
                const { dialog } = await import("electron")
                if (isCliInstalled()) {
                  const result = await uninstallCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command uninstalled",
                      detail: "The 'cscode' command has been removed from your PATH.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Uninstallation Failed", result.error || "Unknown error")
                  }
                } else {
                  const result = await installCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command installed",
                      detail:
                        "You can now use 'cscode .' in any terminal to open CS Coder in that directory.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Installation Failed", result.error || "Unknown error")
                  }
                }
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            {
              label: "Quit",
              accelerator: "CmdOrCtrl+Q",
              click: async () => {
                if (hasActiveClaudeSessions() || hasActiveCodexStreams()) {
                  const { dialog } = await import("electron")
                  const { response } = await dialog.showMessageBox({
                    type: "warning",
                    buttons: ["Cancel", "Quit Anyway"],
                    defaultId: 0,
                    cancelId: 0,
                    title: "Active Sessions",
                    message: "There are active agent sessions running.",
                    detail: "Quitting now will interrupt them. Are you sure you want to quit?",
                  })
                  if (response === 1) {
                    abortAllClaudeSessions()
                    abortAllCodexStreams()
                    setIsQuitting(true)
                    app.quit()
                  }
                } else {
                  app.quit()
                }
              },
            },
          ],
        },
        {
          label: "File",
          submenu: [
            {
              label: "New Chat",
              accelerator: "CmdOrCtrl+N",
              click: () => {
                console.log("[Menu] New Chat clicked (Cmd+N)")
                const win = getWindow()
                if (win) {
                  console.log("[Menu] Sending shortcut:new-agent to renderer")
                  win.webContents.send("shortcut:new-agent")
                } else {
                  console.log("[Menu] No window found!")
                }
              },
            },
            {
              label: "New Window",
              accelerator: "CmdOrCtrl+Shift+N",
              click: () => {
                console.log("[Menu] New Window clicked (Cmd+Shift+N)")
                createWindow()
              },
            },
            { type: "separator" },
            {
              label: "Close Window",
              accelerator: "CmdOrCtrl+W",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.close()
                }
              },
            },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            // Cmd+R is disabled to prevent accidental page refresh
            // Cmd+Shift+R reloads but warns if there are active streams
            {
              label: "Force Reload",
              accelerator: "CmdOrCtrl+Shift+R",
              click: () => {
                const win = BrowserWindow.getFocusedWindow()
                if (!win) return
                if (hasActiveClaudeSessions() || hasActiveCodexStreams()) {
                  dialog
                    .showMessageBox(win, {
                      type: "warning",
                      buttons: ["Cancel", "Reload Anyway"],
                      defaultId: 0,
                      cancelId: 0,
                      title: "Active Sessions",
                      message: "There are active agent sessions running.",
                      detail:
                        "Reloading will interrupt them. The current progress will be saved. Are you sure you want to reload?",
                    })
                    .then(({ response }) => {
                      if (response === 1) {
                        abortAllClaudeSessions()
                        abortAllCodexStreams()
                        win.webContents.reloadIgnoringCache()
                      }
                    })
                } else {
                  win.webContents.reloadIgnoringCache()
                }
              },
            },
            // Only show DevTools in dev mode or when unlocked via hidden feature
            ...(showDevTools ? [{ role: "toggleDevTools" as const }] : []),
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        },
        {
          role: "help",
          submenu: [
            {
              label: "Learn More",
              click: async () => {
                const { shell } = await import("electron")
                await shell.openExternal("https://www.churrostack.com")
              },
            },
          ],
        },
      ]
      Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }

    // macOS: Set dock menu (right-click on dock icon)
    if (process.platform === "darwin") {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: "New Window",
          click: () => {
            console.log("[Dock] New Window clicked")
            createWindow()
          },
        },
      ])
      app.dock.setMenu(dockMenu)
    }

    // Set update state and rebuild menu
    const setUpdateAvailable = (available: boolean, version?: string) => {
      // UPDATES-DISABLED: re-enable to restore update menu state updates
      void available
      void version
      /*
      updateAvailable = available
      availableVersion = version || null
      buildMenu()
      */
    }

    // Unlock devtools and rebuild menu (called from renderer via IPC)
    const unlockDevTools = () => {
      if (!devToolsUnlocked) {
        devToolsUnlocked = true
        console.log("[App] DevTools unlocked via hidden feature")
        buildMenu()
      }
    }

    // UPDATES-DISABLED: re-enable to restore update state exposure
    // Expose setUpdateAvailable globally for auto-updater
    // ;(global as any).__setUpdateAvailable = setUpdateAvailable
    void setUpdateAvailable
    // Expose unlockDevTools globally for IPC handler
    ;(global as any).__unlockDevTools = unlockDevTools

    // Build initial menu
    buildMenu()

    // Initialize auth manager stub
    authManager = initAuthManager(!!process.env.ELECTRON_RENDERER_URL)
    console.log("[App] Auth manager initialized")

    // Track app opened
    initAnalytics()
    trackAppOpened()

    // Initialize database
    try {
      initDatabase()
      console.log("[App] Database initialized")
    } catch (error) {
      console.error("[App] Failed to initialize database:", error)
    }

    // Worktree orphan cleanup is intentionally NOT auto-run. Any automatic
    // deletion risks destroying uncommitted source code if the DB is empty,
    // stale, or transiently errors. Worktrees are only deleted via explicit
    // user opt-in (archive dialog → "Delete worktree" checkbox).

    // Create main window
    createMainWindow()

    // UPDATES-DISABLED: re-enable to restore auto-updater startup
    /*
    // Initialize auto-updater (production only)
    if (app.isPackaged) {
      await initAutoUpdater(getAllWindows)
      // Setup update check on window focus (instead of periodic interval)
      setupFocusUpdateCheck(getAllWindows)
      // Check for updates 5 seconds after startup (force to bypass interval check)
      setTimeout(() => {
        checkForUpdates(true)
      }, 5000)
    }
    */
    void initAutoUpdater
    void setupFocusUpdateCheck
    void checkForUpdates
    void downloadUpdate

    // Warm up MCP cache 3 seconds after startup (background, non-blocking)
    // This populates the cache so all future sessions can use filtered MCP servers
    setTimeout(async () => {
      try {
        const results = await Promise.allSettled([
          getAllMcpConfigHandler(),
          getAllCodexMcpConfigHandler(),
        ])

        if (results[0].status === "rejected") {
          console.error("[App] Claude MCP warmup failed:", results[0].reason)
        }
        if (results[1].status === "rejected") {
          console.error("[App] Codex MCP warmup failed:", results[1].reason)
        }
      } catch (error) {
        console.error("[App] MCP warmup failed:", error)
      }
    }, 3000)

    // Handle directory argument from CLI (e.g., `cscode /path/to/project`)
    parseLaunchDirectory()

    // Handle deep link from app launch (Windows/Linux)
    const deepLinkUrl = process.argv.find((arg) =>
      arg.startsWith(`${PROTOCOL}://`),
    )
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    }

    // macOS: Re-create window when dock icon is clicked
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  // Quit when all windows are closed (except on macOS)
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Cleanup before quit
  app.on("before-quit", async () => {
    console.log("[App] Shutting down...")
    cancelAllPendingOAuth()

    // Kill all live terminals and their child processes (e.g. dev servers
    // spawned via `bun run dev`) so we don't leak orphans after Electron exits.
    // Bounded so a stuck pty can't block the whole quit.
    const TERMINAL_CLEANUP_TIMEOUT_MS = 2000
    try {
      const { terminalManager } = await import("./lib/terminal/manager")
      await Promise.race([
        terminalManager.cleanup(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn(
              "[App] terminalManager.cleanup() exceeded timeout; continuing shutdown",
            )
            resolve()
          }, TERMINAL_CLEANUP_TIMEOUT_MS),
        ),
      ])
    } catch (err) {
      console.warn("[App] terminalManager.cleanup() threw during shutdown:", err)
    }

    // Bound the watcher cleanup so a hung chokidar instance can't block quit.
    // 1500ms is enough for well-behaved close handlers; OS will reclaim handles
    // if we have to move on without them.
    const WATCHER_CLEANUP_TIMEOUT_MS = 1500
    try {
      await Promise.race([
        cleanupGitWatchers(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn(
              "[App] cleanupGitWatchers() exceeded timeout; continuing shutdown",
            )
            resolve()
          }, WATCHER_CLEANUP_TIMEOUT_MS),
        ),
      ])
    } catch (err) {
      console.warn("[App] cleanupGitWatchers() threw during shutdown:", err)
    }

    await shutdownAnalytics()

    // Auto-delete sub-chats that were never named and never used (messages = "[]").
    // Conservative: keeps anything the user invested effort in (named or messaged).
    try {
      const { getDatabase, subChats } = await import("./lib/db")
      const { and, eq, isNull } = await import("drizzle-orm")
      const db = getDatabase()
      const result = db
        .delete(subChats)
        .where(and(eq(subChats.messages, "[]"), isNull(subChats.name)))
        .returning()
        .all()
      if (result.length > 0) {
        console.log(`[App] Cleaned up ${result.length} empty unnamed sub-chats`)
      }
    } catch (error) {
      console.warn("[App] Empty sub-chat cleanup failed:", error)
    }

    await closeDatabase()
  })

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("[App] Uncaught exception:", error)
  })

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[App] Unhandled rejection at:", promise, "reason:", reason)
  })
}
