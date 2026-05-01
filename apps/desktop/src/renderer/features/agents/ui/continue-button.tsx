"use client"

import { useAtomValue, useSetAtom } from "jotai"
import { ArrowRight } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { pendingContinueMessageAtom } from "../atoms"
import {
  getPerChatMessageKey,
  messageAtomFamily,
  messageIdsPerChatAtom,
} from "../stores/message-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import type { AgentMessageMetadata } from "./agent-message-usage"

interface ContinueButtonProps {
  subChatId: string
}

function turnHasCompletionSignal(metadata?: AgentMessageMetadata) {
  return Boolean(metadata?.resultSubtype)
}

export function ContinueButton({ subChatId }: ContinueButtonProps) {
  const ids = useAtomValue(messageIdsPerChatAtom(subChatId))
  const lastId = ids.length > 0 ? ids[ids.length - 1] : ""
  const lastMessage = useAtomValue(
    messageAtomFamily(lastId ? getPerChatMessageKey(subChatId, lastId) : ""),
  )
  const isStreaming = useStreamingStatusStore((s) => s.isStreaming(subChatId))
  const setPendingContinueMessage = useSetAtom(pendingContinueMessageAtom)

  if (isStreaming) return null
  if (ids.length === 0) return null
  if (!lastMessage) return null
  if (
    lastMessage.role === "assistant" &&
    turnHasCompletionSignal(lastMessage.metadata)
  ) {
    return null
  }

  return (
    <div className="flex justify-center my-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setPendingContinueMessage({ subChatId })}
      >
        Continue
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
