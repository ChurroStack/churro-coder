/**
 * Terminal utility functions.
 */

/**
 * Compute the terminal scope key for a chat/workspace.
 * - Local mode (no branch): shared across all local workspaces on the same project path
 * - Worktree mode (has branch): isolated per workspace
 */
export function getTerminalScopeKey(chat: {
  branch: string | null
  worktreePath: string | null
  id: string
}): string {
  if (chat.branch) {
    return `ws:${chat.id}`
  }
  if (chat.worktreePath) {
    return `path:${chat.worktreePath}`
  }
  return `ws:${chat.id}`
}

/**
 * Check if a scope key represents a shared (local-mode) terminal scope.
 */
export function isSharedTerminalScope(scopeKey: string): boolean {
  return scopeKey.startsWith("path:")
}

/**
 * Sanitize an arbitrary script name into a stable id segment for paneIds.
 * Lowercase, alphanumeric and hyphens only. Empty strings collapse to "script".
 */
export function sanitizeScriptId(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return safe || "script"
}

/**
 * Build a deterministic paneId for a script terminal so the widget can locate
 * and kill the terminal it spawned (and so a second Run click is a no-op).
 */
export function getScriptPaneId(scopeKey: string, scriptName: string): string {
  return `${scopeKey}:term:script-${sanitizeScriptId(scriptName)}`
}

/**
 * Build the renderer-side TerminalInstance.id for a script terminal.
 * Uses the same sanitized form so a script's tab is also stable across reloads.
 */
export function getScriptTerminalId(scriptName: string): string {
  return `script-${sanitizeScriptId(scriptName)}`
}

/**
 * Generate an ad-hoc terminal id (used for non-script terminals created via
 * the [+] menu / Terminal quick-launch). Just an 8-char uuid slice.
 */
export function generateTerminalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * Build the paneId for a generic (non-script) terminal in a chat scope.
 * Mirrors what TerminalSection / terminal-sidebar previously used so the
 * backend already-spawned PTY (if any) is reachable on rehydrate.
 */
export function buildTerminalPaneId(scopeKey: string, terminalId: string): string {
  return `${scopeKey}:term:${terminalId}`
}

/**
 * Pick a free "Terminal N" label for a freshly-minted terminal in a list.
 */
export function getNextTerminalName(
  existing: { name: string }[],
): string {
  const numbers = existing
    .map((t) => {
      const match = t.name.match(/^Terminal (\d+)$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)
  const max = numbers.length > 0 ? Math.max(...numbers) : 0
  return `Terminal ${max + 1}`
}

/**
 * Escape file paths for shell usage.
 * Wraps paths containing spaces in quotes.
 *
 * @param paths - Array of file paths
 * @returns Space-separated string of escaped paths
 */
export function shellEscapePaths(paths: string[]): string {
  return paths
    .map((p) => {
      // If path contains spaces, special chars, or is empty, quote it
      if (!p || /[\s'"\\$`!]/.test(p)) {
        // Escape any existing double quotes and wrap in double quotes
        return `"${p.replace(/"/g, '\\"')}"`
      }
      return p
    })
    .join(" ")
}

/**
 * Debounce a function call.
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function with cancel method
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }) as T & { cancel: () => void }

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}
