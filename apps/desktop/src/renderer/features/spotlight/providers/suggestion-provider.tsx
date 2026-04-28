import { useMemo } from "react"
import { useAtomValue } from "jotai"
import {
  MessageSquarePlus,
  TerminalSquare,
  ListChecks,
} from "lucide-react"
import { selectedAgentChatIdAtom, currentPlanPathAtomFamily } from "../../agents/atoms"
import { useAgentSubChatStore } from "../../agents/stores/sub-chat-store"
import { trpc } from "../../../lib/trpc"
import type { SpotlightItem, SpotlightProviderResult } from "../types"

function matches(query: string, item: { title: string; description?: string }) {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    item.title.toLowerCase().includes(q) ||
    (item.description?.toLowerCase().includes(q) ?? false)
  )
}

function dispatch(eventName: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

export function useSuggestionProvider(
  query: string,
  enabled: boolean,
): SpotlightProviderResult {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const planPath = useAtomValue(
    currentPlanPathAtomFamily(activeSubChatId ?? chatId ?? ""),
  )
  const { data: chat } = trpc.chats.get.useQuery(
    { id: chatId ?? "" },
    { enabled: enabled && !!chatId },
  )
  const worktreePath = chat?.worktreePath ?? null

  const items = useMemo<SpotlightItem[]>(() => {
    if (!enabled || !chatId) return []

    const all: SpotlightItem[] = [
      {
        id: "suggestion:new-chat",
        icon: <MessageSquarePlus className="h-4 w-4" />,
        title: "New chat",
        description: "Open a new chat tab in this workspace",
        kbd: "⌘T",
        action: () => dispatch("dock:new-subchat"),
      },
    ]

    if (worktreePath) {
      all.push({
        id: "suggestion:new-terminal",
        icon: <TerminalSquare className="h-4 w-4" />,
        title: "New terminal",
        description: "Open a terminal panel",
        kbd: "⌘⇧T",
        action: () => dispatch("dock:new-terminal"),
      })
    }

    if (planPath) {
      all.push({
        id: "suggestion:view-plan",
        icon: <ListChecks className="h-4 w-4" />,
        title: "View plan",
        description: "Open the active plan file",
        action: () => dispatch("dock:open-plan"),
      })
    }

    return all.filter((item) => matches(query, item))
  }, [enabled, chatId, worktreePath, planPath, query])

  return { groupTitle: "Suggestions", items }
}
