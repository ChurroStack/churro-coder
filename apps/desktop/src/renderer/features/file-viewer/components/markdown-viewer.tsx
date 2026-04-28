import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import Editor from "@monaco-editor/react"
import { useTheme } from "next-themes"
import { useAtom } from "jotai"
import { useAtomValue } from "jotai"
import { Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MarkdownIcon, CodeIcon } from "@/components/ui/icons"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { trpc } from "@/lib/trpc"
import { preferredEditorAtom } from "@/lib/atoms"
import { useResolvedHotkeyDisplay } from "@/lib/hotkeys"
import { APP_META } from "../../../../shared/external-apps"
import { ChatMarkdownRenderer } from "@/components/chat-markdown-renderer"
import { CopyButton } from "../../agents/ui/message-action-buttons"
import { EDITOR_ICONS } from "@/lib/editor-icons"
import { fileViewerWordWrapAtom } from "../../agents/atoms"
import { defaultEditorOptions, getMonacoTheme } from "./monaco-config"
import { FileTitleBlock } from "./file-title-block"

interface MarkdownViewerProps {
  filePath: string
  projectPath: string
  onClose: () => void
  showHeader?: boolean
}

export function MarkdownViewer({
  filePath,
  projectPath,
  onClose,
  showHeader = false,
}: MarkdownViewerProps) {
  const { resolvedTheme } = useTheme()
  const monacoTheme = getMonacoTheme(resolvedTheme || "dark")

  const [showPreview, setShowPreview] = useState(true)
  const [wordWrap] = useAtom(fileViewerWordWrapAtom)

  const handleToggleView = useCallback(() => {
    setShowPreview((prev) => !prev)
  }, [])

  const absolutePath = useMemo(() => {
    return filePath.startsWith("/") ? filePath : `${projectPath}/${filePath}`
  }, [filePath, projectPath])

  const { data, isLoading, error, refetch } = trpc.files.readTextFile.useQuery(
    { filePath: absolutePath },
    { staleTime: 30000 },
  )

  const refetchRef = useRef(refetch)
  useEffect(() => {
    refetchRef.current = refetch
  }, [refetch])

  const relativePath = useMemo(() => {
    if (!filePath.startsWith("/")) return filePath
    if (filePath.startsWith(projectPath)) {
      return filePath.slice(projectPath.length + 1)
    }
    return filePath
  }, [projectPath, filePath])

  trpc.files.watchChanges.useSubscription(
    { projectPath },
    {
      enabled: !!projectPath && !!relativePath,
      onData: (change) => {
        if (change.filename === relativePath) {
          refetchRef.current()
        }
      },
    },
  )

  const editorOptions = useMemo(
    () => ({
      ...defaultEditorOptions,
      wordWrap: wordWrap ? ("on" as const) : ("off" as const),
    }),
    [wordWrap],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <Header
          filePath={filePath}
          showPreview={showPreview}
          onToggleView={handleToggleView}
          showHeader={showHeader}
          onClose={onClose}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading file...</span>
          </div>
        </div>
      </div>
    )
  }

  if (error || (data && !data.ok)) {
    let errorMessage = "Failed to load file"
    if (data && !data.ok) {
      errorMessage = data.reason === "too-large"
        ? "File too large"
        : data.reason === "binary"
        ? "Binary file"
        : "File not found"
    }

    return (
      <div className="flex flex-col h-full bg-background">
        <Header
          filePath={filePath}
          showPreview={showPreview}
          onToggleView={handleToggleView}
          showHeader={showHeader}
          onClose={onClose}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-[300px]">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-foreground">{errorMessage}</p>
          </div>
        </div>
      </div>
    )
  }

  const content = data?.ok ? data.content : ""

  return (
    <div className="flex flex-col h-full bg-background">
      <Header
        filePath={filePath}
        showPreview={showPreview}
        onToggleView={handleToggleView}
        content={content}
        showHeader={showHeader}
        onClose={onClose}
      />
      <div
        className="flex-1 min-h-0 overflow-hidden allow-text-selection"
        data-file-viewer-path={filePath}
      >
        {showPreview ? (
          <div className="h-full overflow-auto p-6">
            <ChatMarkdownRenderer
              content={content}
              size="md"
            />
          </div>
        ) : (
          <Editor
            height="100%"
            language="markdown"
            value={content}
            theme={monacoTheme}
            options={editorOptions}
            loading={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

function Header({
  filePath,
  showPreview,
  onToggleView,
  content,
  showHeader = false,
  onClose,
}: {
  filePath: string
  showPreview: boolean
  onToggleView: () => void
  content?: string
  showHeader?: boolean
  onClose?: () => void
}) {
  const preferredEditor = useAtomValue(preferredEditorAtom)
  const editorMeta = APP_META[preferredEditor]
  const openInAppMutation = trpc.external.openInApp.useMutation()
  const openInEditorHotkey = useResolvedHotkeyDisplay("open-in-editor")

  const handleOpenInEditor = useCallback(() => {
    const absolutePath = filePath.startsWith("/") ? filePath : undefined
    if (absolutePath) {
      openInAppMutation.mutate({ path: absolutePath, app: preferredEditor })
    }
  }, [filePath, preferredEditor, openInAppMutation])

  return (
    <div
      className={`@container flex items-center ${showHeader ? "justify-between" : "justify-end"} px-2 h-10 border-b border-border/50 bg-background flex-shrink-0`}
      style={{
        // @ts-expect-error - WebKit-specific property
        WebkitAppRegion: "no-drag",
      }}
    >
      {showHeader && onClose && (
        <FileTitleBlock filePath={filePath} onClose={onClose} />
      )}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Open in editor */}
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

        {/* View mode toggle */}
        {content && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleView}
                className="h-6 w-6 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                aria-label={showPreview ? "Show source" : "Show rendered"}
              >
                <div className="relative w-4 h-4">
                  <MarkdownIcon
                    className={cn(
                      "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                      showPreview ? "opacity-100 scale-100" : "opacity-0 scale-75",
                    )}
                  />
                  <CodeIcon
                    className={cn(
                      "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                      !showPreview ? "opacity-100 scale-100" : "opacity-0 scale-75",
                    )}
                  />
                </div>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" showArrow={false}>
              {showPreview ? "View source" : "View rendered"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Copy button */}
        {content && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <CopyButton text={content} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" showArrow={false}>
              Copy file content
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
