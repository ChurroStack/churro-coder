"use client"

import { useAtom } from "jotai"
import { useCallback } from "react"
import { ResizableSidebar } from "../../../components/ui/resizable-sidebar"
import { cn } from "../../../lib/utils"
import { FilesTab } from "../../details-sidebar/sections/files-tab"
import { SearchTab } from "../../details-sidebar/sections/search-tab"
import { FileViewerSidebar } from "../../file-viewer/components/file-viewer-sidebar"
import {
  newWorkspaceFileViewerWidthAtom,
  newWorkspaceSidePanelModeAtom,
  newWorkspaceSidePanelWidthAtom,
  newWorkspaceViewerFileAtom,
} from "../atoms"

interface NewWorkspaceExplorerProps {
  worktreePath: string | null
}

/**
 * Right-side sidebar pair for the new-workspace page:
 *   [ centered content ] [ FileViewer (when a file is open) ] [ Files | Search ]
 *
 * Side panel keeps FilesTab and SearchTab both mounted (toggled with `hidden`)
 * so expanded folders / search query survive mode switches. Closing the side
 * panel also closes the file viewer; closing only the file viewer leaves the
 * side panel open.
 */
export function NewWorkspaceExplorer({ worktreePath }: NewWorkspaceExplorerProps) {
  const [mode, setMode] = useAtom(newWorkspaceSidePanelModeAtom)
  const [viewerFile, setViewerFile] = useAtom(newWorkspaceViewerFileAtom)

  const handleSelectFile = useCallback(
    (filePath: string) => {
      setViewerFile(filePath)
    },
    [setViewerFile],
  )

  const closeViewer = useCallback(() => {
    setViewerFile(null)
  }, [setViewerFile])

  const closeSidePanel = useCallback(() => {
    setMode(null)
    setViewerFile(null)
  }, [setMode, setViewerFile])

  if (!worktreePath || mode === null) return null

  return (
    <>
      {viewerFile && (
        <ResizableSidebar
          isOpen={true}
          onClose={closeViewer}
          widthAtom={newWorkspaceFileViewerWidthAtom}
          minWidth={320}
          maxWidth={1000}
          side="right"
          initialWidth={560}
          exitWidth={560}
          disableClickToClose={true}
        >
          <div
            className="h-full w-full overflow-hidden border-l bg-background"
            style={{ borderLeftWidth: "0.5px" }}
          >
            <FileViewerSidebar
              filePath={viewerFile}
              projectPath={worktreePath}
              onClose={closeViewer}
              showHeader
            />
          </div>
        </ResizableSidebar>
      )}

      <ResizableSidebar
        isOpen={true}
        onClose={closeSidePanel}
        widthAtom={newWorkspaceSidePanelWidthAtom}
        minWidth={240}
        maxWidth={500}
        side="right"
        initialWidth={280}
        exitWidth={280}
        disableClickToClose={true}
      >
        <div
          className="h-full w-full overflow-hidden flex flex-col border-l bg-background"
          style={{ borderLeftWidth: "0.5px" }}
        >
          <FilesTab
            worktreePath={worktreePath}
            onSelectFile={handleSelectFile}
            currentViewerFilePath={viewerFile}
            showFilterInput
            className={cn("flex-1", mode !== "explore" && "hidden")}
          />
          <SearchTab
            worktreePath={worktreePath}
            onSelectFile={handleSelectFile}
            isActive={mode === "search"}
            className={cn("flex-1", mode !== "search" && "hidden")}
          />
        </div>
      </ResizableSidebar>
    </>
  )
}
