"use client"

import { memo, useState, type ReactNode } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Coins, XCircle, Zap } from "lucide-react"
import { toast } from "sonner"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible"
import { Badge } from "../../../components/ui/badge"
import { cn } from "../../../lib/utils"
import { formatCost, formatDuration, formatTokens, humanizeStopReason, isNormalStop } from "./agent-format-utils"
import { formatModelLabel } from "../lib/models"
import type { AgentMessageMetadata } from "./agent-message-usage"

interface AgentTurnRecapProps {
  metadata?: AgentMessageMetadata
  isStreaming?: boolean
}

function statusLabel(subtype?: string): "Success" | "Failed" | "Aborted" {
  if (!subtype || subtype === "success") return "Success"
  if (subtype === "error_max_turns" || subtype === "error_during_execution") return "Failed"
  return "Aborted"
}

export const AgentTurnRecap = memo(function AgentTurnRecap({
  metadata,
  isStreaming,
}: AgentTurnRecapProps) {
  const [open, setOpen] = useState(false)

  if (!metadata || isStreaming) return null
  if (!metadata.resultSubtype) return null

  const {
    model,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens = 0,
    totalCostUsd,
    durationMs,
    sessionId,
    stopReason,
  } = metadata

  const hasUsage = inputTokens > 0 || outputTokens > 0 || totalTokens > 0
  if (!hasUsage) return null

  const status = statusLabel(metadata.resultSubtype)
  const StatusIcon = status === "Success" ? CheckCircle2 : XCircle
  const displayTokens = totalTokens || inputTokens + outputTokens
  const hasCost = typeof totalCostUsd === "number" && totalCostUsd > 0
  const hasCacheStats =
    typeof cacheReadInputTokens === "number" || typeof cacheCreationInputTokens === "number"

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "mt-2 mx-2 rounded-md border border-border/50 bg-muted/20",
          "text-xs text-muted-foreground",
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              "flex w-full items-center gap-2 px-2 py-1.5",
              "transition-[background-color] duration-150 ease-out hover:bg-muted/40",
              "rounded-md",
            )}
          >
            {open ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <Badge
              variant={status === "Success" ? "secondary" : "destructive"}
              className="gap-1 px-1.5 py-0 text-[10px] leading-4"
            >
              <StatusIcon className="w-3 h-3" />
              {status}
            </Badge>
            {durationMs !== undefined && durationMs > 0 && (
              <span className="flex items-center gap-1 tabular-nums">
                <Clock className="w-3 h-3" />
                {formatDuration(durationMs)}
              </span>
            )}
            {displayTokens > 0 && (
              <span className="flex items-center gap-1 tabular-nums">
                <Zap className="w-3 h-3" />
                {formatTokens(displayTokens)}
              </span>
            )}
            {hasCost && (
              <span className="flex items-center gap-1 tabular-nums">
                <Coins className="w-3 h-3" />
                {formatCost(totalCostUsd!)}
              </span>
            )}
            {stopReason && !isNormalStop(stopReason) && (
              <span className="text-[10px] text-muted-foreground/70">
                · {humanizeStopReason(stopReason)}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              {open ? "Hide details" : "Recap"}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/50 px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            {inputTokens > 0 && (
              <Row label="Input tokens" value={inputTokens.toLocaleString()} />
            )}
            {outputTokens > 0 && (
              <Row label="Output tokens" value={outputTokens.toLocaleString()} />
            )}
            {hasCacheStats && (
              <>
                {typeof cacheReadInputTokens === "number" && cacheReadInputTokens > 0 && (
                  <Row label="Cache read" value={cacheReadInputTokens.toLocaleString()} />
                )}
                {typeof cacheCreationInputTokens === "number" && cacheCreationInputTokens > 0 && (
                  <Row label="Cache creation" value={cacheCreationInputTokens.toLocaleString()} />
                )}
              </>
            )}
            {hasCost && (
              <Row label="Cost" value={formatCost(totalCostUsd!)} />
            )}
            {durationMs !== undefined && durationMs > 0 && (
              <Row label="Duration" value={formatDuration(durationMs)} />
            )}
            {model && (
              <Row label="Model" value={formatModelLabel(model)} />
            )}
            {sessionId && (
              <Row
                label="Session"
                value={
                  <button
                    type="button"
                    tabIndex={-1}
                    title="Click to copy"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(sessionId)
                        .then(() => toast.success("Session ID copied"))
                        .catch(() => toast.error("Could not copy session ID"))
                    }}
                    className="font-mono text-[10px] truncate text-foreground/80 hover:text-foreground"
                  >
                    {sessionId.slice(0, 12)}…
                  </button>
                }
                full
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
})

function Row({
  label,
  value,
  full,
}: {
  label: string
  value: ReactNode
  full?: boolean
}) {
  return (
    <div className={cn("flex justify-between gap-2", full && "col-span-2")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground/90 tabular-nums">{value}</span>
    </div>
  )
}
