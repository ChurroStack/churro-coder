import { useMemo } from "react"
import type { ReactNode } from "react"
import { useAtomValue } from "jotai"
import {
  MessageSquare,
  TerminalSquare,
  FileText,
  ListChecks,
  GitCompare,
  Search,
  FolderTree,
  House,
  LayoutGrid,
} from "lucide-react"
import { dockPanelsAtom } from "../../dock/atoms"
import { getFileIconByExtension } from "../../agents/mentions/agents-file-mention"
import type { SpotlightItem, SpotlightProviderResult } from "../types"

function dispatch(eventName: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

function iconForPanel(kind: string, title: string): ReactNode {
  switch (kind) {
    case "chat":
    case "chat-new":
      return <MessageSquare className="h-4 w-4" />
    case "terminal":
      return <TerminalSquare className="h-4 w-4" />
    case "file": {
      const IconComp = getFileIconByExtension(title, true)
      return IconComp ? (
        <IconComp className="h-4 w-4" />
      ) : (
        <FileText className="h-4 w-4" />
      )
    }
    case "plan":
      return <ListChecks className="h-4 w-4" />
    case "diff":
      return <GitCompare className="h-4 w-4" />
    case "search":
      return <Search className="h-4 w-4" />
    case "files-tree":
      return <FolderTree className="h-4 w-4" />
    case "main":
      return <House className="h-4 w-4" />
    default:
      return <LayoutGrid className="h-4 w-4" />
  }
}

function descriptionForPanel(kind: string): string | undefined {
  switch (kind) {
    case "chat":
    case "chat-new":
      return "Chat"
    case "terminal":
      return "Terminal"
    case "file":
      return "File"
    case "plan":
      return "Plan"
    case "diff":
      return "Diff"
    case "search":
      return "Search"
    case "files-tree":
      return "Files tree"
    case "main":
      return "Workspace"
    default:
      return undefined
  }
}

export function useWorkspaceTabsProvider(
  query: string,
  enabled: boolean,
): SpotlightProviderResult {
  const panels = useAtomValue(dockPanelsAtom)

  const items = useMemo<SpotlightItem[]>(() => {
    if (!enabled) return []

    const q = query.trim().toLowerCase()
    const filtered = q
      ? panels.filter((p) => (p.title ?? p.id).toLowerCase().includes(q))
      : panels

    // De-prioritize the currently active tab — it's already focused.
    const sorted = [...filtered].sort((a, b) => {
      if (a.isActive && !b.isActive) return 1
      if (!a.isActive && b.isActive) return -1
      return 0
    })

    return sorted.map((panel) => ({
      id: `tab:${panel.id}`,
      icon: iconForPanel(panel.kind, panel.title),
      title: panel.title || panel.id,
      description: descriptionForPanel(panel.kind),
      action: () => dispatch("dock:activate-panel", { panelId: panel.id }),
    }))
  }, [enabled, panels, query])

  return { groupTitle: "Open tabs", items }
}
