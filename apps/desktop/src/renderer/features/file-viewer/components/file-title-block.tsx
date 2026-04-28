import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getFileIconByExtension } from "../../agents/mentions/agents-file-mention"
import { getFileName } from "../utils/file-utils"

interface FileTitleBlockProps {
  filePath: string
  onClose: () => void
}

/**
 * Left-side header content for the file viewer when it's NOT inside a
 * dockview tab (where the tab strip already provides title + close).
 * Used by the new-workspace explorer sidebar.
 */
export function FileTitleBlock({ filePath, onClose }: FileTitleBlockProps) {
  const Icon = getFileIconByExtension(filePath)
  const fileName = getFileName(filePath)

  return (
    <div className="flex items-center gap-1 min-w-0 flex-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 flex-shrink-0 hover:bg-foreground/10"
        onClick={onClose}
        aria-label="Close file"
      >
        <X className="size-4 text-muted-foreground" />
      </Button>
      <div className="flex items-center gap-1.5 min-w-0 flex-1 ml-1">
        {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
        <span className="text-sm font-medium truncate" title={filePath}>
          {fileName}
        </span>
      </div>
    </div>
  )
}
