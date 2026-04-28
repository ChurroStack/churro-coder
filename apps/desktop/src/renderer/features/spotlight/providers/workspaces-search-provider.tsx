import { useMemo } from "react"
import { useSetAtom } from "jotai"
import { LayoutGrid } from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { selectedAgentChatIdAtom, desktopViewAtom } from "../../agents/atoms"
import type { SpotlightItem, SpotlightProviderResult } from "../types"

const MAX_RESULTS = 8

function GitHubProjectIcon({ owner }: { owner: string }) {
  return (
    <img
      src={`https://github.com/${owner}.png?size=32`}
      alt=""
      className="h-4 w-4 rounded-sm object-cover"
      onError={(e) => {
        e.currentTarget.style.display = "none"
      }}
    />
  )
}

export function useWorkspacesSearchProvider(
  query: string,
  enabled: boolean,
): SpotlightProviderResult {
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)

  const trimmed = query.trim()

  const { data: chats, isFetching, isError } = trpc.chats.list.useQuery(
    {},
    {
      enabled,
      staleTime: 5_000,
    },
  )

  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
  })

  const projectMap = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, p] as const)),
    [projects],
  )

  const items = useMemo<SpotlightItem[]>(() => {
    if (!enabled) return []
    if (isError) {
      console.warn("[Spotlight] WorkspacesSearchProvider failed")
      return []
    }
    if (!chats) return []

    const q = trimmed.toLowerCase()
    const filtered = q
      ? chats.filter((chat) => (chat.name ?? "").toLowerCase().includes(q))
      : chats

    return filtered.slice(0, MAX_RESULTS).map((chat) => {
      const project = projectMap.get(chat.projectId)
      const icon =
        project?.gitProvider === "github" && project.gitOwner ? (
          <GitHubProjectIcon owner={project.gitOwner} />
        ) : (
          <LayoutGrid className="h-4 w-4" />
        )
      return {
        id: `workspace:${chat.id}`,
        icon,
        title: chat.name || "Untitled workspace",
        description: chat.branch || project?.name || undefined,
        action: () => {
          setSelectedChatId(chat.id)
          setDesktopView(null)
        },
      }
    })
  }, [enabled, chats, isError, trimmed, projectMap, setSelectedChatId, setDesktopView])

  return {
    groupTitle: trimmed ? "Workspaces" : "Recent workspaces",
    items,
    loading: enabled && isFetching && !chats,
  }
}
