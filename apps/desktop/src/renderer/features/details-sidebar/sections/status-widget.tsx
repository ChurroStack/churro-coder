"use client"

import { Fragment, memo } from "react"
import {
  Check,
  ChevronRight,
  Code2,
  Eye,
  FileText,
  GitPullRequest,
  type LucideIcon,
} from "lucide-react"
import { IconSpinner } from "@/components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  MilestoneId,
  MilestoneState,
  WorkflowActionKind,
  WorkflowState,
} from "@/features/agents/utils/workflow-state"

interface StatusWidgetProps {
  workflow: WorkflowState
  onAction: (kind: WorkflowActionKind, milestone: MilestoneId) => void
}

const MILESTONE_ICONS: Record<MilestoneId, LucideIcon> = {
  plan: FileText,
  code: Code2,
  review: Eye,
  pr: GitPullRequest,
}

export const StatusWidget = memo(function StatusWidget({
  workflow,
  onAction,
}: StatusWidgetProps) {
  const milestones: MilestoneState[] = [
    workflow.plan,
    workflow.code,
    workflow.review,
    workflow.pr,
  ]

  return (
    <div className="flex items-center justify-between gap-1 px-2 py-2.5">
      {milestones.map((m, idx) => {
        const Icon = MILESTONE_ICONS[m.id]
        const isClickable = !!m.actionKind
        const isNext =
          workflow.next?.milestone === m.id && m.status === "attention"

        return (
          <Fragment key={m.id}>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  // Use aria-disabled (not native disabled) so the button stays
                  // focusable / hoverable for the tooltip; the click handler
                  // already short-circuits when actionKind is missing.
                  aria-disabled={!isClickable || undefined}
                  onClick={() => {
                    if (!isClickable) return
                    if (m.actionKind) onAction(m.actionKind, m.id)
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md px-2 py-1.5 min-w-[52px]",
                    "transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                    isClickable
                      ? "hover:bg-muted/60 cursor-pointer"
                      : "cursor-default",
                  )}
                  aria-label={m.hint ?? m.label}
                >
                  <span
                    className={cn(
                      "relative flex h-6 w-6 items-center justify-center rounded-full ring-2",
                      m.status === "idle" &&
                        "ring-muted text-muted-foreground/70",
                      m.status === "in_progress" &&
                        "ring-blue-500 text-blue-500 animate-pulse",
                      m.status === "attention" &&
                        "ring-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/10",
                      m.status === "info" &&
                        "ring-blue-500 text-blue-500 bg-blue-500/10",
                      m.status === "done" &&
                        "ring-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
                      isNext && "ring-offset-1 ring-offset-background",
                    )}
                  >
                    {m.status === "done" ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    ) : m.status === "in_progress" ? (
                      <IconSpinner className="h-3.5 w-3.5" />
                    ) : (
                      <Icon className="h-3 w-3" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-medium tracking-tight leading-none",
                      m.status === "idle"
                        ? "text-muted-foreground/70"
                        : "text-foreground",
                    )}
                  >
                    {m.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {m.hint ?? m.label}
              </TooltipContent>
            </Tooltip>
            {idx < milestones.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            )}
          </Fragment>
        )
      })}
    </div>
  )
})
