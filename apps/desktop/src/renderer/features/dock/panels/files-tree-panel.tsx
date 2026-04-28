import { useCallback, useRef } from "react"
import { useAtomValue } from "jotai"
import type { IDockviewPanelProps } from "dockview-react"
import { FilesTab, type FilesTabHandle } from "../../details-sidebar/sections/files-tab"
import { selectedProjectAtom } from "../../agents/atoms"
import { useDockApi } from "../dock-context"
import { addOrFocus } from "../add-or-focus"
import type { FilesTreePanelEntity } from "../atoms"

/**
 * FilesTreePanel — full-pane file explorer. Clicking a file opens it as a
 * dockview file panel via addOrFocus; passing the line number through to the
 * file panel's params lets the editor scroll to it on mount.
 */
export function FilesTreePanel({ params }: IDockviewPanelProps<FilesTreePanelEntity>) {
  const project = useAtomValue(selectedProjectAtom)
  const worktreePath = project?.path ?? null
  const dockApi = useDockApi()
  const filesTabRef = useRef<FilesTabHandle>(null)

  const handleSelectFile = useCallback(
    (filePath: string, line?: number) => {
      if (!dockApi) return
      addOrFocus(dockApi, {
        kind: "file",
        data: { absolutePath: filePath, initialLine: line },
      })
    },
    [dockApi],
  )

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-background">
      <FilesTab
        ref={filesTabRef}
        worktreePath={worktreePath}
        onSelectFile={handleSelectFile}
      />
    </div>
  )
}
