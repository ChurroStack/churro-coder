import { memo, useEffect, useMemo } from "react"
import { useSetAtom } from "jotai"
import {
  subChatFilesAtom,
  subChatToChatMapAtom,
  type SubChatFileChange,
} from "../atoms"
import { computeSubChatFiles } from "../hooks/use-changed-files-tracking"

interface SubChatRow {
  id: string
  messages?: unknown
}

interface Props {
  chatId: string
  subChats: SubChatRow[] | null | undefined
  projectPath?: string
}

function parseMessages(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== "string") return []
  // Cheap pre-filter mirroring file-stats.ts — skip JSON.parse if there's
  // nothing for the algorithm to find.
  if (
    !raw.includes("tool-Edit") &&
    !raw.includes("tool-Write") &&
    !raw.includes("changedFiles")
  ) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Workspace-level seeder for `subChatFilesAtom`. Mounted once per active chat
 * (in active-chat.tsx) so every sub-chat's file list is computed regardless of
 * whether its dockview chat panel is currently visible.
 *
 * Why this exists: `useChangedFilesTracking` only runs inside `ChatViewInner`,
 * which only mounts when its dockview chat panel is the active tab in its
 * group. When the user views the Changes tab in the same group as the chat
 * tab, `ChatViewInner` unmounts and the per-sub-chat file list never gets
 * populated — making the "This chat" badge read 0 even when there are edits.
 *
 * This component reads `agentChat.subChats[].messages` (already in renderer
 * memory via `chats.get`) and writes the result for every sub-chat in one
 * batched atom update — no N-instance render cascade.
 */
export const SubChatFilesTracker = memo(function SubChatFilesTracker({
  chatId,
  subChats,
  projectPath,
}: Props) {
  const setSubChatFiles = useSetAtom(subChatFilesAtom)
  const setSubChatToChatMap = useSetAtom(subChatToChatMapAtom)

  const computed = useMemo(() => {
    if (!subChats || subChats.length === 0) {
      return [] as Array<[string, SubChatFileChange[]]>
    }
    return subChats.map((sc) => {
      const messages = parseMessages(sc.messages)
      return [sc.id, computeSubChatFiles(messages, projectPath)] as [
        string,
        SubChatFileChange[],
      ]
    })
  }, [subChats, projectPath])

  useEffect(() => {
    if (computed.length === 0) return
    setSubChatFiles((prev) => {
      const next = new Map(prev)
      for (const [id, files] of computed) {
        next.set(id, files)
      }
      return next
    })
  }, [computed, setSubChatFiles])

  useEffect(() => {
    if (!chatId || computed.length === 0) return
    setSubChatToChatMap((prev) => {
      const next = new Map(prev)
      for (const [id] of computed) {
        next.set(id, chatId)
      }
      return next
    })
  }, [chatId, computed, setSubChatToChatMap])

  return null
})
