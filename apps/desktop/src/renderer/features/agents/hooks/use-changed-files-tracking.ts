import { useSetAtom } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import { subChatFilesAtom, subChatToChatMapAtom, type SubChatFileChange } from "../atoms"
// import { REPO_ROOT_PATH } from "@/lib/codesandbox-constants"
const REPO_ROOT_PATH = "/workspace" // Desktop mock

interface MessagePart {
  type: string
  input?: {
    file_path?: string
    old_string?: string
    new_string?: string
    content?: string
  }
}

interface Message {
  role: string
  parts?: MessagePart[]
  metadata?: {
    changedFiles?: Array<{
      filePath?: string
      additions?: number
      deletions?: number
      status?: string
    }>
  }
}

// Strip session/plan files stored in app's local storage (never user-facing).
function isSessionFile(filePath: string): boolean {
  if (filePath.includes("claude-sessions")) return true
  if (filePath.includes("Application Support")) return true
  return false
}

// Display path = path with sandbox / worktree / absolute prefixes stripped.
function getDisplayPath(filePath: string, projectPath?: string): string {
  if (!filePath) return ""

  // Strip project path prefix first (most reliable for desktop)
  if (projectPath && filePath.startsWith(projectPath)) {
    const relative = filePath.slice(projectPath.length)
    return relative.startsWith("/") ? relative.slice(1) : relative
  }

  const prefixes = [`${REPO_ROOT_PATH}/`, "/project/sandbox/", "/project/"]
  for (const prefix of prefixes) {
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length)
    }
  }

  // Worktree paths: /Users/.../.churrostack/worktrees/ or legacy /.21st/worktrees/.
  // Extract everything after the subChatId directory.
  const worktreeMatch = filePath.match(/\.(?:churrostack|21st)\/worktrees\/[^/]+\/[^/]+\/(.+)$/)
  if (worktreeMatch) {
    return worktreeMatch[1]
  }

  // Heuristic: find common root directories.
  if (filePath.startsWith("/")) {
    const parts = filePath.split("/")
    const rootIndicators = ["apps", "packages", "src", "lib", "components"]
    const rootIndex = parts.findIndex((p) => rootIndicators.includes(p))
    if (rootIndex > 0) {
      return parts.slice(rootIndex).join("/")
    }
  }

  return filePath
}

// For Edit: old_string lines are deletions, new_string lines are additions.
// For Write: counts lines in new content as additions.
function calculateDiffStats(
  oldStr: string,
  newStr: string,
): { additions: number; deletions: number } {
  if (oldStr === newStr) return { additions: 0, deletions: 0 }

  const oldLines = oldStr ? oldStr.split("\n").length : 0
  const newLines = newStr ? newStr.split("\n").length : 0

  if (!oldStr) {
    return { additions: newLines, deletions: 0 }
  }

  return {
    additions: newLines,
    deletions: oldLines,
  }
}

/**
 * Pure compute: derive a sub-chat's tracked file list from its message history.
 *
 * Two sources are merged, with metadata winning over tool-call inference:
 * 1. `metadata.changedFiles` — emitted by the Codex tRPC router after each
 *    turn, comparing git snapshots before/after. Authoritative when present.
 * 2. `tool-Edit` / `tool-Write` parts — Claude's edit tools, where we
 *    reconstruct net additions/deletions from the first/last seen content.
 *
 * Bash-only edits (mv/rm/sed/echo) are not tracked — that's a known limitation
 * surfaced in the "This chat" tooltip.
 */
export function computeSubChatFiles(
  messages: Message[],
  projectPath?: string,
): SubChatFileChange[] {
  const fileStates = new Map<
    string,
    {
      originalContent: string | null
      currentContent: string
      displayPath: string
    }
  >()
  const attributedFiles = new Map<string, SubChatFileChange>()

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    for (const changedFile of msg.metadata?.changedFiles || []) {
      const filePath = changedFile.filePath
      if (!filePath || isSessionFile(filePath)) continue
      attributedFiles.set(filePath, {
        filePath,
        displayPath: getDisplayPath(filePath, projectPath),
        additions: Math.max(0, changedFile.additions || 0),
        deletions: Math.max(0, changedFile.deletions || 0),
      })
    }

    for (const part of msg.parts || []) {
      if (part.type === "tool-Edit" || part.type === "tool-Write") {
        const filePath = part.input?.file_path
        if (!filePath) continue
        if (attributedFiles.has(filePath)) continue
        if (isSessionFile(filePath)) continue

        const oldString = part.input?.old_string || ""
        const newString = part.input?.new_string || part.input?.content || ""

        const existing = fileStates.get(filePath)
        if (existing) {
          existing.currentContent = newString
        } else {
          fileStates.set(filePath, {
            originalContent: part.type === "tool-Write" ? null : oldString,
            currentContent: newString,
            displayPath: getDisplayPath(filePath, projectPath),
          })
        }
      }
    }
  }

  const result: SubChatFileChange[] = [...attributedFiles.values()]
  for (const [filePath, state] of fileStates) {
    if (attributedFiles.has(filePath)) continue
    const originalContent = state.originalContent || ""

    if (originalContent === state.currentContent) {
      continue
    }

    const stats = calculateDiffStats(originalContent, state.currentContent)
    result.push({
      filePath,
      displayPath: state.displayPath,
      additions: stats.additions,
      deletions: stats.deletions,
    })
  }

  return result
}

/**
 * Hook for the *active* sub-chat's ChatViewInner: keeps the badge fresh as
 * soon as a streaming turn ends, without waiting for the parent's `chats.get`
 * refetch. Workspace-level seeding for *all* sub-chats is done by
 * `<SubChatFilesTracker>` in active-chat.tsx — that handles sub-chats whose
 * ChatViewInner isn't mounted (e.g. chat tab hidden behind the Changes tab
 * in the same dockview group).
 */
export function useChangedFilesTracking(
  messages: Message[],
  subChatId: string,
  isStreaming: boolean = false,
  chatId?: string,
  projectPath?: string,
) {
  const setSubChatFiles = useSetAtom(subChatFilesAtom)
  const setSubChatToChatMap = useSetAtom(subChatToChatMapAtom)

  const [changedFiles, setChangedFiles] = useState<SubChatFileChange[]>([])
  const wasStreamingRef = useRef(false)
  const isInitializedRef = useRef(false)

  const recomputeChangedFiles = useCallback(
    (overrideMessages?: Message[]) => {
      const next = computeSubChatFiles(overrideMessages ?? messages, projectPath)
      setChangedFiles(next)
      isInitializedRef.current = true
    },
    [messages, projectPath],
  )

  // Recalculate on streaming end OR initial mount with messages.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setChangedFiles(computeSubChatFiles(messages, projectPath))
      isInitializedRef.current = true
    } else if (!isInitializedRef.current && !isStreaming && messages.length > 0) {
      setChangedFiles(computeSubChatFiles(messages, projectPath))
      isInitializedRef.current = true
    }

    wasStreamingRef.current = isStreaming
  }, [isStreaming, messages, projectPath])

  useEffect(() => {
    setSubChatFiles((prev) => {
      const next = new Map(prev)
      next.set(subChatId, changedFiles)
      return next
    })
  }, [subChatId, changedFiles, setSubChatFiles])

  useEffect(() => {
    if (chatId) {
      setSubChatToChatMap((prev) => {
        const next = new Map(prev)
        next.set(subChatId, chatId)
        return next
      })
    }
  }, [subChatId, chatId, setSubChatToChatMap])

  return { changedFiles, recomputeChangedFiles }
}
