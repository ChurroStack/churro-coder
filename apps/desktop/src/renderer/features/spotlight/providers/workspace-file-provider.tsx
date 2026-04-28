import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { FileText } from "lucide-react"
import { selectedAgentChatIdAtom, recentlyOpenedFilesAtom } from "../../agents/atoms"
import { trpc } from "../../../lib/trpc"
import { useDebouncedQuery } from "../use-debounced-query"
import { getFileIconByExtension } from "../../agents/mentions/agents-file-mention"
import type { SpotlightItem, SpotlightProviderResult } from "../types"

function dispatch(eventName: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

function relativePath(absolute: string, root: string | null): string {
  if (!root) return absolute
  if (absolute.startsWith(root)) {
    const rest = absolute.slice(root.length)
    return rest.startsWith("/") ? rest.slice(1) : rest
  }
  return absolute
}

function makeFileItem(absolutePath: string, worktreePath: string | null): SpotlightItem {
  const label = absolutePath.split("/").pop() || absolutePath
  const IconComp = getFileIconByExtension(label, true)
  const icon = IconComp ? (
    <IconComp className="h-4 w-4" />
  ) : (
    <FileText className="h-4 w-4" />
  )
  return {
    id: `file:${absolutePath}`,
    icon,
    title: label,
    description: relativePath(absolutePath, worktreePath),
    action: () => dispatch("dock:open-file", { absolutePath }),
  }
}

export function useWorkspaceFileProvider(
  query: string,
  enabled: boolean,
): SpotlightProviderResult {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const recentlyOpened = useAtomValue(recentlyOpenedFilesAtom)
  const debounced = useDebouncedQuery(query, 120)

  const { data: chat } = trpc.chats.get.useQuery(
    { id: chatId ?? "" },
    { enabled: enabled && !!chatId },
  )
  const worktreePath = chat?.worktreePath ?? null

  const trimmedQuery = debounced.trim()
  const shouldSearch = enabled && !!worktreePath && trimmedQuery.length > 0

  const { data, isFetching, isError } = trpc.files.search.useQuery(
    {
      projectPath: worktreePath ?? "",
      query: debounced,
      limit: 5,
      typeFilter: "file" as const,
    },
    {
      enabled: shouldSearch,
      keepPreviousData: true,
      staleTime: 5_000,
    },
  )

  const items = useMemo<SpotlightItem[]>(() => {
    if (!enabled || !worktreePath) return []

    if (trimmedQuery.length === 0) {
      // Empty query: show recent files scoped to the current worktree.
      const prefix = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`
      return recentlyOpened
        .filter((p) => p.startsWith(prefix))
        .slice(0, 5)
        .map((p) => makeFileItem(p, worktreePath))
    }

    if (isError) {
      console.warn("[Spotlight] WorkspaceFileProvider failed")
      return []
    }
    if (!data) return []

    return data.map((entry) => makeFileItem(entry.path, worktreePath))
  }, [enabled, worktreePath, trimmedQuery, recentlyOpened, data, isError])

  return {
    groupTitle: trimmedQuery.length === 0 ? "Recent files" : "Files",
    items,
    loading: shouldSearch && isFetching && !data,
  }
}
