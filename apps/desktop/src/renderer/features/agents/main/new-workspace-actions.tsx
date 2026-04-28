"use client"

import { useAtom, useSetAtom } from "jotai"
import { FolderTree, Search } from "lucide-react"
import { Button } from "../../../components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import {
  newWorkspaceSidePanelModeAtom,
  newWorkspaceViewerFileAtom,
  type NewWorkspaceSidePanelMode,
} from "../atoms"

interface NewWorkspaceActionsProps {
  visible: boolean
}

/**
 * Top-right toggle pair on the new-workspace page (Explore / Search).
 * Visual style mirrors `dock-header-actions.tsx` so the icons line up with
 * the rest of the app's top-row buttons.
 */
export function NewWorkspaceActions({ visible }: NewWorkspaceActionsProps) {
  const [mode, setMode] = useAtom(newWorkspaceSidePanelModeAtom)
  const setViewerFile = useSetAtom(newWorkspaceViewerFileAtom)

  if (!visible) return null

  const toggle = (target: NonNullable<NewWorkspaceSidePanelMode>) => {
    if (mode === target) {
      // Closing the side panel also closes the file viewer (per spec).
      setMode(null)
      setViewerFile(null)
    } else {
      setMode(target)
    }
  }

  return (
    <div
      className="flex items-center gap-0.5"
      style={{
        // @ts-expect-error - WebKit-specific property
        WebkitAppRegion: "no-drag",
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Explore files"
            aria-pressed={mode === "explore"}
            onClick={() => toggle("explore")}
            data-active={mode === "explore"}
            className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground data-[active=true]:bg-foreground/10 data-[active=true]:text-foreground"
          >
            <FolderTree className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Explore files</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search files"
            aria-pressed={mode === "search"}
            onClick={() => toggle("search")}
            data-active={mode === "search"}
            className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground data-[active=true]:bg-foreground/10 data-[active=true]:text-foreground"
          >
            <Search className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Search files</TooltipContent>
      </Tooltip>
    </div>
  )
}
