"use client"

import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ArrowUpRight, Info } from "lucide-react"
import { DiffIcon } from "@/components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { useResolvedHotkeyDisplay } from "@/lib/hotkeys"
import { viewedFilesAtomFamily, fileViewerOpenAtomFamily, diffSidebarOpenAtomFamily, subChatFilesAtom } from "@/features/agents/atoms"
import { useAgentSubChatStore } from "@/features/agents/stores/sub-chat-store"
import { getSyncActionKind, matchesFilePath } from "@/features/changes/utils"
import {
  FileListItem,
  getFileName,
  getFileDir,
} from "@/features/changes/components/file-list-item"
import { trpc } from "@/lib/trpc"
import { preferredEditorAtom } from "@/lib/atoms"
import { APP_META } from "../../../../shared/external-apps"
import type { ParsedDiffFile } from "../types"
import { BranchSwitcherPopover } from "@/features/changes/components/branch-switcher/branch-switcher-popover"
import { useWidgetPanel } from "../../dock"
import { PromotedToPanelStub } from "./promoted-to-panel-stub"

interface ChangesWidgetProps {
  chatId: string
  worktreePath?: string | null
  diffStats?: { additions: number; deletions: number; fileCount: number } | null
  parsedFileDiffs?: ParsedDiffFile[] | null
  onCommit?: (selectedPaths: string[]) => void
  onCommitAndPush?: (selectedPaths: string[]) => void
  isCommitting?: boolean
  pushCount?: number
  pullCount?: number
  hasUpstream?: boolean
  isSyncStatusLoading?: boolean
  currentBranch?: string
  onExpand?: () => void
  /** Called when a file is clicked - should open diff sidebar with this file selected */
  onFileSelect?: (filePath: string) => void
  /** Diff display mode - affects tooltip text */
  diffDisplayMode?: "side-peek" | "center-peek" | "full-page"
}

/**
 * Map parsed diff file status to FileStatus type for getStatusIndicator
 */
function getFileStatus(file: ParsedDiffFile): "added" | "modified" | "deleted" | "renamed" {
  if (file.isNewFile) return "added"
  if (file.isDeletedFile) return "deleted"
  // Check for rename: oldPath and newPath are different and neither is /dev/null
  if (
    file.oldPath &&
    file.newPath &&
    file.oldPath !== "/dev/null" &&
    file.newPath !== "/dev/null" &&
    file.oldPath !== file.newPath
  ) {
    return "renamed"
  }
  return "modified"
}

/**
 * Changes Widget for Overview Sidebar
 * Shows file list exactly like the Changes tab in diff sidebar
 * Memoized to prevent unnecessary re-renders when parent updates
 */
export const ChangesWidget = memo(function ChangesWidget({
  chatId,
  worktreePath,
  diffStats,
  parsedFileDiffs,
  onCommit,
  onCommitAndPush,
  isCommitting = false,
  pushCount = 0,
  pullCount = 0,
  hasUpstream = true,
  isSyncStatusLoading = false,
  currentBranch,
  onExpand,
  onFileSelect,
  diffDisplayMode = "side-peek",
}: ChangesWidgetProps) {
  // Widget ↔ panel mutex: when promoted to a dockview panel, hide the summary
  // and render a small "return to summary" stub instead.
  const widgetPanel = useWidgetPanel("diff", {
    kind: "diff",
    data: { chatId },
  })

  const handleExpand = useCallback(() => {
    if (widgetPanel.available) {
      widgetPanel.openAsPanel()
    } else {
      onExpand?.()
    }
  }, [widgetPanel, onExpand])

  // Data is now cached at the ActiveChat level via workspaceDiffCacheAtomFamily
  // So parsedFileDiffs and diffStats persist across workspace switches
  const allFiles = parsedFileDiffs ?? []
  const allStats = diffStats

  // Always-scoped: narrow to files the active sub-chat has edited. This widget
  // is the "what I did in this chat" summary. Files modified only via Bash
  // (mv/rm/sed -i) aren't tracked and won't appear here — open the full
  // Changes panel to see those.
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const subChatFiles = useAtomValue(subChatFilesAtom)
  const scopedPathSet = useMemo(() => {
    if (!activeSubChatId) return null
    const entries = subChatFiles.get(activeSubChatId)
    if (!entries || entries.length === 0) return new Set<string>()
    const set = new Set<string>()
    for (const e of entries) {
      if (e.displayPath) set.add(e.displayPath)
      if (e.filePath) set.add(e.filePath)
    }
    return set
  }, [activeSubChatId, subChatFiles])

  const matchesScope = useCallback(
    (path: string): boolean => {
      if (!scopedPathSet || scopedPathSet.size === 0) return false
      if (scopedPathSet.has(path)) return true
      // Tolerate prefix mismatches (worktree-absolute vs repo-relative).
      // matchesFilePath requires a `/` boundary so "auth.ts" doesn't match
      // "oauth.ts" and "lib/foo.ts" doesn't match "mylib/foo.ts".
      for (const scoped of scopedPathSet) {
        if (matchesFilePath(scoped, path)) return true
      }
      return false
    },
    [scopedPathSet],
  )

  const displayFiles = useMemo(() => {
    if (scopedPathSet === null) return allFiles
    return allFiles.filter((f) => {
      const newPath = f.newPath && f.newPath !== "/dev/null" ? f.newPath : null
      const oldPath = f.oldPath && f.oldPath !== "/dev/null" ? f.oldPath : null
      return (newPath && matchesScope(newPath)) || (oldPath && matchesScope(oldPath))
    })
  }, [allFiles, scopedPathSet, matchesScope])

  // Recompute stats from the scoped file set so header counts match the list.
  const displayStats = useMemo(() => {
    if (scopedPathSet === null) return allStats
    let additions = 0
    let deletions = 0
    for (const f of displayFiles) {
      additions += f.additions
      deletions += f.deletions
    }
    return { additions, deletions, fileCount: displayFiles.length }
  }, [scopedPathSet, allStats, displayFiles])

  const hasChanges = displayStats && displayStats.fileCount > 0
  const branchHasChanges = !!allStats && allStats.fileCount > 0
  const isScopedEmptyButBranchHasChanges =
    scopedPathSet !== null && !hasChanges && branchHasChanges

  // Get tooltip text based on diff display mode
  const expandTooltip = diffDisplayMode === "side-peek"
    ? "Open in sidebar"
    : diffDisplayMode === "center-peek"
      ? "Open in dialog"
      : "Open fullscreen"

  // Resolved hotkey for tooltip
  const openDiffHotkey = useResolvedHotkeyDisplay("open-diff")

  // Viewed files state (same atom as diff sidebar)
  const [viewedFiles] = useAtom(viewedFilesAtomFamily(chatId))

  // Mutations for context menu actions
  const openInFinderMutation = trpc.external.openInFinder.useMutation()
  const openInAppMutation = trpc.external.openInApp.useMutation()

  const syncActionKind = getSyncActionKind({
    hasUpstream,
    pullCount,
    pushCount,
    isSyncStatusLoading,
  })

  const shouldCommitAndPush = !!worktreePath && !!onCommitAndPush && !isSyncStatusLoading && syncActionKind !== "pull" && syncActionKind !== "loading"

  // Preferred editor
  const preferredEditor = useAtomValue(preferredEditorAtom)
  const editorMeta = APP_META[preferredEditor]
  // File viewer (file preview sidebar)
  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const setFileViewerPath = useSetAtom(fileViewerAtom)

  // Diff sidebar state (to close dialog/fullscreen when opening file preview)
  const diffSidebarAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const setDiffSidebarOpen = useSetAtom(diffSidebarAtom)

  // Selection state - all files selected by default
  const [selectedForCommit, setSelectedForCommit] = useState<Set<string>>(new Set())
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false)
  const prevAllPathsRef = useRef<Set<string>>(new Set())

  // Helper to get display path (handles /dev/null for deleted files)
  const getDisplayPath = useCallback((file: ParsedDiffFile): string => {
    if (file.newPath && file.newPath !== "/dev/null") {
      return file.newPath
    }
    if (file.oldPath && file.oldPath !== "/dev/null") {
      return file.oldPath
    }
    return file.newPath || file.oldPath
  }, [])

  // Initialize selection, then auto-select newly added paths on subsequent updates
  useEffect(() => {
    const allPaths = new Set(displayFiles.map((f) => getDisplayPath(f)))

    if (!hasInitializedSelection && displayFiles.length > 0) {
      setSelectedForCommit(allPaths)
      setHasInitializedSelection(true)
      prevAllPathsRef.current = allPaths
      return
    }

    const prevPaths = prevAllPathsRef.current
    const newPaths: string[] = []
    for (const path of allPaths) {
      if (!prevPaths.has(path)) {
        newPaths.push(path)
      }
    }

    if (newPaths.length > 0) {
      setSelectedForCommit((prev) => {
        const next = new Set(prev)
        for (const path of newPaths) {
          next.add(path)
        }
        return next
      })
    }

    prevAllPathsRef.current = allPaths
  }, [displayFiles, hasInitializedSelection, getDisplayPath])

  // Reset selection when files change significantly
  useEffect(() => {
    if (displayFiles.length === 0) {
      setHasInitializedSelection(false)
      setSelectedForCommit(new Set())
      prevAllPathsRef.current = new Set()
    }
  }, [displayFiles.length])

  // Check if file is marked as viewed using its diff key directly
  const isFileViewed = useCallback(
    (file: ParsedDiffFile): boolean => {
      // Use the actual key from the parsed diff (oldPath->newPath) for exact match
      const viewedState = viewedFiles[file.key]
      if (viewedState?.viewed) {
        return true
      }
      return false
    },
    [viewedFiles],
  )

  // Toggle individual file selection
  const handleCheckboxChange = useCallback((filePath: string) => {
    setSelectedForCommit((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }, [])

  // Selection stats - use getDisplayPath consistently for all path operations
  const selectedCount = displayFiles.filter((f) =>
    selectedForCommit.has(getDisplayPath(f)),
  ).length
  const allSelected = displayFiles.length > 0 && selectedCount === displayFiles.length
  const someSelected = selectedCount > 0 && selectedCount < displayFiles.length
  const commitLabelSuffix = selectedCount > 0
    ? ` ${selectedCount} file${selectedCount !== 1 ? "s" : ""}`
    : ""

  // Toggle all files selection
  const handleSelectAllChange = useCallback(() => {
    if (allSelected) {
      setSelectedForCommit(new Set())
    } else {
      const allPaths = new Set(displayFiles.map((f) => getDisplayPath(f)))
      setSelectedForCommit(allPaths)
    }
  }, [allSelected, displayFiles, getDisplayPath])

  // Handle commit
  const handleCommit = useCallback(() => {
    const selectedPaths = displayFiles
      .filter((f) => selectedForCommit.has(getDisplayPath(f)))
      .map((f) => getDisplayPath(f))
    if (shouldCommitAndPush && onCommitAndPush) {
      onCommitAndPush(selectedPaths)
    } else {
      onCommit?.(selectedPaths)
    }
  }, [displayFiles, selectedForCommit, onCommit, onCommitAndPush, getDisplayPath, shouldCommitAndPush])

  // Promoted to a dockview panel — render the stub instead of the summary.
  if (widgetPanel.isOpen) {
    return (
      <PromotedToPanelStub label="Changes" onReturnToSummary={widgetPanel.closePanel} />
    )
  }

  return (
    <div className="mx-2 mb-2">
      <div className={cn("rounded-lg border border-border/50 overflow-hidden")}>
        {/* Widget Header with stats - fixed height h-8 for consistency */}
        <div className="flex items-center gap-2 px-2 h-8 select-none group bg-muted/30">
          {/* Icon */}
          <DiffIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

          {/* Title + branch */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-xs font-medium text-foreground">Changes</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="About this view"
                  className="inline-flex items-center justify-center size-3.5 rounded text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <Info className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                Showing files this chat edited. Bash-only edits (mv/rm/sed) aren't
                tracked. Open the full Changes panel to see all branch changes.
              </TooltipContent>
            </Tooltip>
            {currentBranch && worktreePath ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                <span className="shrink-0">on</span>
                <BranchSwitcherPopover
                  worktreePath={worktreePath}
                  currentBranch={currentBranch}
                  compact
                />
              </span>
            ) : currentBranch ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                <span className="shrink-0">on</span>
                <span className="truncate max-w-[120px] text-foreground">
                  {currentBranch}
                </span>
              </span>
            ) : null}
          </div>

          {/* Stats in header - total lines changed */}
          {hasChanges && displayStats && (
            <span className="text-xs text-muted-foreground">
              <span className="text-green-500">+{displayStats.additions}</span>
              {" "}
              <span className="text-red-500">-{displayStats.deletions}</span>
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Expand to panel — same hover-revealed top-right pattern as
              the rest of the widgets in WidgetCard. Was previously gated
              on an `onExpand` prop, but the dockview always provides a
              target via `widgetPanel.openAsPanel()`. */}
          {(widgetPanel.available || onExpand) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleExpand}
                  className="h-5 w-5 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground rounded-md opacity-0 group-hover:opacity-100 transition-[background-color,opacity,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0"
                  aria-label="Expand changes"
                >
                  <ArrowUpRight className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {expandTooltip}
                {openDiffHotkey && <Kbd>{openDiffHotkey}</Kbd>}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Content */}
        {hasChanges ? (
          <>
            {/* Select all header - like in changes-view */}
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border/50">
              <Checkbox
                checked={someSelected ? "indeterminate" : allSelected}
                onCheckedChange={handleSelectAllChange}
                className="size-4 border-muted-foreground/50"
              />
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {displayFiles.length} file
                {displayFiles.length !== 1 ? "s" : ""} selected
              </span>
            </div>

            {/* File list - using shared FileListItem component */}
            <div className="max-h-[300px] overflow-y-auto">
              {displayFiles.map((file) => {
                const filePath = getDisplayPath(file)
                const absolutePath = worktreePath ? `${worktreePath}/${filePath}` : null

                return (
                  <FileListItem
                    key={file.key}
                    filePath={filePath}
                    fileName={getFileName(filePath)}
                    dirPath={getFileDir(filePath)}
                    status={getFileStatus(file)}
                    isChecked={selectedForCommit.has(filePath)}
                    isViewed={isFileViewed(file)}
                    isUntracked={file.isNewFile ?? false}
                    showContextMenu={!!worktreePath}
                    onSelect={() => {
                      if (onFileSelect) {
                        onFileSelect(filePath)
                      } else {
                        handleExpand()
                      }
                    }}
                    onCheckboxChange={() => handleCheckboxChange(filePath)}
                    onCopyPath={absolutePath ? async () => {
                      await navigator.clipboard.writeText(absolutePath)
                    } : undefined}
                    onCopyRelativePath={async () => {
                      await navigator.clipboard.writeText(filePath)
                    }}
                    onRevealInFinder={absolutePath ? () => {
                      openInFinderMutation.mutate(absolutePath)
                    } : undefined}
                    onOpenInFilePreview={absolutePath ? () => {
                      setFileViewerPath(absolutePath)
                      if (diffDisplayMode !== "side-peek") {
                        setDiffSidebarOpen(false)
                      }
                    } : undefined}
                    onOpenInEditor={absolutePath ? () => {
                      openInAppMutation.mutate({ path: absolutePath, app: preferredEditor })
                    } : undefined}
                    editorLabel={editorMeta.label}
                  />
                )
              })}
            </div>

            {/* Action buttons. The previous "View Diff" button is gone —
                the top-right ↗ icon (revealed on header hover) opens the
                full Changes panel, matching the rest of the widgets. */}
            {onCommit && (
              <div className="flex gap-2 p-2 border-t border-border/50">
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1 h-7 text-xs"
                  onClick={handleCommit}
                  disabled={isCommitting || selectedCount === 0}
                >
                  {isCommitting
                    ? (shouldCommitAndPush ? "Committing & pushing..." : "Committing...")
                    : (shouldCommitAndPush
                      ? `Commit & Push${commitLabelSuffix}`
                      : `Commit${commitLabelSuffix}`)}
                </Button>
              </div>
            )}
          </>
        ) : isScopedEmptyButBranchHasChanges ? (
          <div className="text-xs text-muted-foreground px-2 py-2">
            This chat hasn&apos;t edited any files yet. Open the full Changes
            panel to see all branch changes.
          </div>
        ) : (
          <div className="text-xs text-muted-foreground px-2 py-2">
            No changes
          </div>
        )}
      </div>
    </div>
  )
})
