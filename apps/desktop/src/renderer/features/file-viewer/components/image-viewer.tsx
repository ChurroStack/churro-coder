import { useMemo, useCallback } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { useAtomValue } from "jotai"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { trpc } from "@/lib/trpc"
import { preferredEditorAtom } from "@/lib/atoms"
import { useResolvedHotkeyDisplay } from "@/lib/hotkeys"
import { APP_META } from "../../../../shared/external-apps"
import { EDITOR_ICONS } from "@/lib/editor-icons"
import { getFileName } from "../utils/file-utils"
import { FileTitleBlock } from "./file-title-block"

interface ImageViewerProps {
  filePath: string
  projectPath: string
  onClose: () => void
  showHeader?: boolean
}

export function ImageViewer({
  filePath,
  projectPath,
  onClose,
  showHeader = false,
}: ImageViewerProps) {
  const fileName = getFileName(filePath)
  const preferredEditor = useAtomValue(preferredEditorAtom)
  const editorMeta = APP_META[preferredEditor]
  const openInAppMutation = trpc.external.openInApp.useMutation()
  const openInEditorHotkey = useResolvedHotkeyDisplay("open-in-editor")

  const absolutePath = useMemo(() => {
    return filePath.startsWith("/") ? filePath : `${projectPath}/${filePath}`
  }, [filePath, projectPath])

  const handleOpenInEditor = useCallback(() => {
    if (absolutePath) {
      openInAppMutation.mutate({ path: absolutePath, app: preferredEditor })
    }
  }, [absolutePath, preferredEditor, openInAppMutation])

  const { data, isLoading, error } = trpc.files.readBinaryFile.useQuery(
    { filePath: absolutePath },
    { staleTime: 60000 },
  )

  return (
    <div className="flex flex-col h-full bg-background">
      <div
        className={`@container flex items-center ${showHeader ? "justify-between" : "justify-end"} px-2 h-10 border-b border-border/50 bg-background flex-shrink-0`}
        style={{
          WebkitAppRegion: "no-drag",
        }}
      >
        {showHeader && (
          <FileTitleBlock filePath={filePath} onClose={onClose} />
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleOpenInEditor}
                className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer rounded-md px-1.5 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <span className="hidden @[400px]:inline">Open in</span>
                {EDITOR_ICONS[preferredEditor] && (
                  <img
                    src={EDITOR_ICONS[preferredEditor]}
                    alt=""
                    className="h-3.5 w-3.5 flex-shrink-0"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" showArrow={false}>
              Open in {editorMeta.label}
              {openInEditorHotkey && <Kbd className="normal-case font-sans">{openInEditorHotkey}</Kbd>}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-muted/20 p-4">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading image...</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 text-center max-w-[300px]">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-foreground">Failed to load image</p>
          </div>
        )}

        {data && !data.ok && (
          <div className="flex flex-col items-center gap-3 text-center max-w-[300px]">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-foreground">
              {data.reason === "too-large" ? "Image too large" : "Image not found"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {data.reason === "too-large"
                ? "The image exceeds the 20MB size limit."
                : "The file could not be found."}
            </p>
          </div>
        )}

        {data?.ok && (
          <img
            src={`data:${data.mimeType};base64,${data.data}`}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-sm"
            style={{ imageRendering: "auto" }}
          />
        )}
      </div>
    </div>
  )
}
