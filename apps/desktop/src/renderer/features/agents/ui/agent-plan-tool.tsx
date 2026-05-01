"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { ChatMarkdownRenderer } from "../../../components/chat-markdown-renderer"
import { Button } from "../../../components/ui/button"
import {
  CheckIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  IconSpinner,
  PlanIcon,
} from "../../../components/ui/icons"
import { Kbd } from "../../../components/ui/kbd"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { cn } from "../../../lib/utils"
import { useChatAttentionStore } from "../stores/chat-attention-store"
import {
  pendingBuildPlanSubChatIdAtom,
  subChatModeAtomFamily,
} from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { getToolStatus } from "./agent-tool-registry"
import { areToolPropsEqual } from "./agent-tool-utils"

interface PlanStep {
  id: string
  title: string
  description?: string
  files?: readonly string[] | string[]
  estimatedComplexity?: "low" | "medium" | "high"
  status: "pending" | "in_progress" | "completed" | "skipped"
}

interface Plan {
  id: string
  title: string
  summary?: string
  steps: readonly PlanStep[] | PlanStep[]
  status: "draft" | "awaiting_approval" | "approved" | "in_progress" | "completed"
}

interface AgentPlanToolProps {
  part: {
    type: string
    toolCallId: string
    state?: string
    input?: {
      action?: "create" | "update" | "approve" | "complete"
      plan?: Plan
    }
    output?: {
      success?: boolean
      message?: string
    }
  }
  chatStatus?: string
  subChatId?: string
}

function formatPlanAsMarkdown(plan: Plan): string {
  const lines: string[] = []
  const steps = Array.isArray(plan.steps) ? plan.steps : []

  if (plan.title) {
    lines.push(`## ${plan.title}`)
  }

  if (plan.summary) {
    lines.push(plan.summary)
  }

  if (steps.length > 0) {
    lines.push(
      steps
        .map((step, index) => {
          const stepLines = [`${index + 1}. ${step.title}`]
          if (step.description) {
            stepLines.push(`   ${step.description}`)
          }
          if (step.files && step.files.length > 0) {
            stepLines.push(
              `   Files: ${step.files.map((file) => `\`${file}\``).join(", ")}`,
            )
          }
          return stepLines.join("\n")
        })
        .join("\n\n"),
    )
  }

  return lines.join("\n\n")
}

export const AgentPlanTool = memo(function AgentPlanTool({
  part,
  chatStatus,
  subChatId,
}: AgentPlanToolProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const { isPending } = getToolStatus(part, chatStatus)

  const plan = part.input?.plan
  const subChatModeAtom = useMemo(
    () => subChatModeAtomFamily(subChatId || ""),
    [subChatId],
  )
  const subChatMode = useAtomValue(subChatModeAtom)
  const setPendingBuildPlanSubChatId = useSetAtom(pendingBuildPlanSubChatIdAtom)
  const buildDisabled =
    isPending || chatStatus === "streaming" || chatStatus === "submitted"
  const canApprovePlan =
    plan?.status === "awaiting_approval" && subChatMode === "plan"
  const planContent = useMemo(
    () => (plan ? formatPlanAsMarkdown(plan) : ""),
    [plan],
  )

  const handleApprovePlan = useCallback((event: MouseEvent) => {
    event.stopPropagation()
    const targetSubChatId =
      subChatId || useAgentSubChatStore.getState().activeSubChatId
    if (targetSubChatId) {
      setPendingBuildPlanSubChatId(targetSubChatId)
    }
  }, [setPendingBuildPlanSubChatId, subChatId])

  const handleCopy = useCallback((event: MouseEvent) => {
    event.stopPropagation()
    if (!planContent) return
    navigator.clipboard.writeText(planContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [planContent])

  useEffect(() => {
    if (!subChatId) return
    if (plan?.status === "awaiting_approval") {
      useChatAttentionStore.getState().setAttention(subChatId, "plan-approval")
    } else {
      useChatAttentionStore.getState().clearAttention(subChatId, "plan-approval")
    }
    return () => {
      useChatAttentionStore.getState().clearAttention(subChatId, "plan-approval")
    }
  }, [subChatId, plan?.status])

  if (!plan) {
    return null
  }

  const shouldShowShimmer = isPending

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden mx-2">
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center justify-between pl-2.5 pr-0.5 h-7 cursor-pointer hover:bg-muted/50 transition-colors duration-150"
      >
        <div className="flex items-center gap-1.5 text-xs truncate flex-1 min-w-0">
          <PlanIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
          {shouldShowShimmer ? (
            <TextShimmer as="span" duration={1.2} className="truncate">
              Creating plan...
            </TextShimmer>
          ) : (
            <span className="truncate text-foreground font-medium">Plan</span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {shouldShowShimmer && <IconSpinner className="w-3 h-3 text-muted-foreground mr-1" />}

          {planContent && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCopy}
                  className="group p-1 rounded-md hover:bg-accent transition-[background-color,transform] duration-150 ease-out active:scale-95"
                >
                  <div className="relative w-3.5 h-3.5">
                    <CopyIcon
                      className={cn(
                        "absolute inset-0 w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out",
                        copied ? "opacity-0 scale-50" : "opacity-100 scale-100",
                      )}
                    />
                    <CheckIcon
                      className={cn(
                        "absolute inset-0 w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out",
                        copied ? "opacity-100 scale-100" : "opacity-0 scale-50",
                      )}
                    />
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" showArrow={false}>
                Copy plan
              </TooltipContent>
            </Tooltip>
          )}

          <button
            onClick={(event) => {
              event.stopPropagation()
              setIsExpanded((prev) => !prev)
            }}
            className="group p-1 rounded-md hover:bg-accent transition-[background-color,transform] duration-150 ease-out active:scale-95"
          >
            <div className="relative w-4 h-4">
              <ExpandIcon
                className={cn(
                  "absolute inset-0 w-4 h-4 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out",
                  isExpanded ? "opacity-0 scale-75" : "opacity-100 scale-100",
                )}
              />
              <CollapseIcon
                className={cn(
                  "absolute inset-0 w-4 h-4 text-muted-foreground group-hover:text-foreground transition-[opacity,transform,color] duration-200 ease-out",
                  isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75",
                )}
              />
            </div>
          </button>
        </div>
      </div>

      <div
        onClick={() => !isExpanded && setIsExpanded(true)}
        className={cn(
          "text-xs overflow-hidden transition-all duration-200 border-t border-border/50",
          isExpanded
            ? "max-h-[300px] overflow-y-auto"
            : "h-[72px] cursor-pointer hover:bg-muted/50",
        )}
      >
        <div className="px-3 py-2">
          <ChatMarkdownRenderer content={planContent} size="sm" />
        </div>
      </div>

      <div className="flex items-center justify-between p-1.5">
        <span className="px-2 text-xs text-muted-foreground">
          {plan.status === "awaiting_approval"
            ? "Awaiting approval"
            : plan.status === "approved"
              ? "Approved"
              : plan.status}
        </span>

        {canApprovePlan && (
          <Button
            size="sm"
            onClick={handleApprovePlan}
            disabled={buildDisabled}
            className="h-6 px-3 text-xs font-medium rounded-md transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
          >
            Approve
            <Kbd className="ml-1.5 text-primary-foreground/70">⌘↵</Kbd>
          </Button>
        )}
      </div>
    </div>
  )
}, areToolPropsEqual)
