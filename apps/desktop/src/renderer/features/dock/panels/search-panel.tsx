import { useCallback } from "react"
import { useAtomValue } from "jotai"
import type { IDockviewPanelProps } from "dockview-react"
import { SearchTab } from "../../details-sidebar/sections/search-tab"
import { selectedProjectAtom } from "../../agents/atoms"
import { useDockApi } from "../dock-context"
import { addOrFocus } from "../add-or-focus"
import type { SearchPanelEntity } from "../atoms"

/**
 * SearchPanel — full-pane code search across the project. Clicking a result
 * opens the matching file as a dockview file panel via addOrFocus.
 */
export function SearchPanel({ params }: IDockviewPanelProps<SearchPanelEntity>) {
  const project = useAtomValue(selectedProjectAtom)
  const worktreePath = project?.path ?? null
  const dockApi = useDockApi()

  const handleSelectFile = useCallback(
    (filePath: string) => {
      if (!dockApi) return
      addOrFocus(dockApi, {
        kind: "file",
        data: { absolutePath: filePath },
      })
    },
    [dockApi],
  )

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-background">
      <SearchTab
        worktreePath={worktreePath}
        onSelectFile={handleSelectFile}
        isActive
      />
    </div>
  )
}
