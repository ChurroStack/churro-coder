/**
 * Aggregate +/- line counts and file count for a sub-chat's messages array.
 *
 * Mirrors the logic that `getFileStats` used to run on every read; called from
 * every messages-write path so the cached columns on `sub_chats` stay in sync.
 *
 * Returns zeros for unparseable JSON or message arrays without changed-file data.
 */
export interface SubChatFileStats {
  fileStatsAdditions: number
  fileStatsDeletions: number
  fileStatsFileCount: number
}

const ZERO: SubChatFileStats = {
  fileStatsAdditions: 0,
  fileStatsDeletions: 0,
  fileStatsFileCount: 0,
}

export function computeFileStatsFromMessages(messagesJson: string | null | undefined): SubChatFileStats {
  if (!messagesJson) return ZERO

  // Cheap pre-filter: skip the JSON parse if there are no edit/write tool
  // calls and no app-server git attribution metadata.
  if (
    !messagesJson.includes("tool-Edit") &&
    !messagesJson.includes("tool-Write") &&
    !messagesJson.includes("changedFiles")
  ) {
    return ZERO
  }

  let messages: Array<{
    role: string
    metadata?: {
      changedFiles?: Array<{
        filePath?: string
        additions?: number
        deletions?: number
        status?: string
      }>
    }
    parts?: Array<{
      type: string
      input?: {
        file_path?: string
        old_string?: string
        new_string?: string
        content?: string
      }
    }>
  }>
  try {
    messages = JSON.parse(messagesJson)
  } catch {
    return ZERO
  }

  const legacyFileStates = new Map<
    string,
    { originalContent: string | null; currentContent: string }
  >()
  const fileStats = new Map<
    string,
    { additions: number; deletions: number }
  >()

  const isSessionFile = (filePath: string) =>
    filePath.includes("claude-sessions") ||
    filePath.includes("Application Support")

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    for (const changedFile of msg.metadata?.changedFiles || []) {
      const filePath = changedFile.filePath
      if (!filePath || isSessionFile(filePath)) continue
      fileStats.set(filePath, {
        additions: Math.max(0, changedFile.additions || 0),
        deletions: Math.max(0, changedFile.deletions || 0),
      })
    }

    for (const part of msg.parts || []) {
      if (part.type !== "tool-Edit" && part.type !== "tool-Write") continue
      const filePath = part.input?.file_path
      if (!filePath) continue
      // Skip session/internal files
      if (isSessionFile(filePath)) continue

      const oldString = part.input?.old_string || ""
      const newString = part.input?.new_string || part.input?.content || ""

      const existing = legacyFileStates.get(filePath)
      if (existing) {
        existing.currentContent = newString
      } else {
        legacyFileStates.set(filePath, {
          originalContent: part.type === "tool-Write" ? null : oldString,
          currentContent: newString,
        })
      }
    }
  }

  for (const [filePath, state] of legacyFileStates) {
    if (fileStats.has(filePath)) continue

    const original = state.originalContent || ""
    if (original === state.currentContent) continue
    const oldLines = original ? original.split("\n").length : 0
    const newLines = state.currentContent ? state.currentContent.split("\n").length : 0
    if (!original) {
      fileStats.set(filePath, { additions: newLines, deletions: 0 })
    } else {
      fileStats.set(filePath, { additions: newLines, deletions: oldLines })
    }
  }

  let additions = 0
  let deletions = 0
  for (const stats of fileStats.values()) {
    additions += stats.additions
    deletions += stats.deletions
  }

  return {
    fileStatsAdditions: additions,
    fileStatsDeletions: deletions,
    fileStatsFileCount: fileStats.size,
  }
}
