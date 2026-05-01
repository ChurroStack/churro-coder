export type MilestoneStatus =
  | "idle"
  | "in_progress"
  | "attention"
  | "done"
  | "info"

export type MilestoneId = "plan" | "code" | "review" | "pr"

export type WorkflowActionKind =
  | "expandPlan"
  | "mergeBase"
  | "pushBranch"
  | "reviewLocal"
  | "reviewPr"
  | "createPr"
  | "openPr"

export interface MilestoneState {
  id: MilestoneId
  status: MilestoneStatus
  label: string
  hint?: string
  actionKind?: WorkflowActionKind
}

export interface WorkflowState {
  plan: MilestoneState
  code: MilestoneState
  review: MilestoneState
  pr: MilestoneState
  next: {
    milestone: MilestoneId
    label: string
    actionKind: WorkflowActionKind
  } | null
}

export interface WorkflowInputs {
  mode: "plan" | "agent"
  isStreaming: boolean
  isCompacting: boolean
  planEverGenerated: boolean
  changedFilesCount: number
  pushCount: number
  hasUpstream: boolean
  hasRemote: boolean
  baseBranchBehind: number
  prState: "none" | "draft" | "open" | "merged" | "closed"
  reviewDecision: "none" | "pending" | "approved" | "changes_requested"
  localReviewCompleted: boolean
  prCreating: boolean
}

export function computeWorkflowState(i: WorkflowInputs): WorkflowState {
  const plan = computePlan(i)
  const code = computeCode(i, plan.status)
  const review = computeReview(i, code.status)
  const pr = computePr(i, code.status, review.status)

  const order: MilestoneState[] = [plan, code, review, pr]
  const nextSource =
    order.find((m) => m.status === "attention" && m.actionKind) ??
    order.find((m) => m.status === "in_progress" && m.actionKind) ??
    null

  const next =
    nextSource && nextSource.actionKind
      ? {
          milestone: nextSource.id,
          label: nextSource.hint ?? nextSource.label,
          actionKind: nextSource.actionKind,
        }
      : null

  return { plan, code, review, pr, next }
}

function computePlan(i: WorkflowInputs): MilestoneState {
  // mode is the persisted source of truth — same atom that gates the Approve button.
  // As long as mode === "plan" the plan has not been approved yet.
  if (i.mode !== "plan") {
    return i.planEverGenerated
      ? { id: "plan", status: "done", label: "Plan", hint: "Plan approved" }
      : { id: "plan", status: "idle", label: "Plan", hint: "Skipped (agent mode)" }
  }

  // Streaming in plan mode → AI is still drafting
  if (i.isStreaming) {
    return { id: "plan", status: "in_progress", label: "Plan", hint: "Drafting plan…" }
  }

  // mode === "plan", not streaming → plan exists and is awaiting approval.
  // The persisted mode atom is the source of truth — it only flips to "agent"
  // once the user approves, so as long as we're in plan mode we know the
  // plan is awaiting approval and Code stays blocked.
  return {
    id: "plan",
    status: "attention",
    label: "Plan",
    hint: "Plan ready — review and approve",
    actionKind: "expandPlan",
  }
}

function computeCode(
  i: WorkflowInputs,
  planStatus: MilestoneStatus,
): MilestoneState {
  if (planStatus === "in_progress" || planStatus === "attention") {
    return {
      id: "code",
      status: "idle",
      label: "Code",
      hint: "Waiting on plan",
    }
  }
  if (i.isStreaming && !i.isCompacting) {
    return {
      id: "code",
      status: "in_progress",
      label: "Code",
      hint: "Agent is editing…",
    }
  }
  if (i.baseBranchBehind > 0) {
    return {
      id: "code",
      status: "attention",
      label: "Code",
      hint: `Base branch has ${i.baseBranchBehind} new commit${i.baseBranchBehind === 1 ? "" : "s"}`,
      actionKind: "mergeBase",
    }
  }
  // No remote at all → can't push; treat as done and let the user proceed to Review
  if (!i.hasRemote) {
    return {
      id: "code",
      status: "done",
      label: "Code",
      hint: "Changes ready (no remote)",
    }
  }
  if (!i.hasUpstream) {
    return {
      id: "code",
      status: "attention",
      label: "Code",
      hint: "Push branch to origin",
      actionKind: "pushBranch",
    }
  }
  if (i.pushCount > 0) {
    return {
      id: "code",
      status: "attention",
      label: "Code",
      hint: `Push ${i.pushCount} commit${i.pushCount === 1 ? "" : "s"} to origin`,
      actionKind: "pushBranch",
    }
  }
  // baseBranchBehind === 0 already guaranteed by the early return above.
  if (i.changedFilesCount === 0 && i.pushCount === 0) {
    return {
      id: "code",
      status: "idle",
      label: "Code",
      hint: "No changes",
    }
  }
  return {
    id: "code",
    status: "done",
    label: "Code",
    hint: "All changes pushed",
  }
}

function computeReview(
  i: WorkflowInputs,
  codeStatus: MilestoneStatus,
): MilestoneState {
  if (codeStatus !== "done") {
    return {
      id: "review",
      status: "idle",
      label: "Review",
      hint: "Waiting on code",
    }
  }
  if (i.reviewDecision === "changes_requested") {
    return {
      id: "review",
      status: "attention",
      label: "Review",
      hint: "Changes requested on PR",
      actionKind: "reviewPr",
    }
  }
  if (i.reviewDecision === "approved") {
    return {
      id: "review",
      status: "done",
      label: "Review",
      hint: "PR approved",
    }
  }
  if (i.prState === "open" || i.prState === "draft") {
    return {
      id: "review",
      status: "attention",
      label: "Review",
      hint: "Review pull request",
      actionKind: "reviewPr",
    }
  }
  if (i.localReviewCompleted && i.prState === "none") {
    return {
      id: "review",
      status: "done",
      label: "Review",
      hint: "Reviewed",
    }
  }
  return {
    id: "review",
    status: "attention",
    label: "Review",
    hint: "Ready for review",
    actionKind: "reviewLocal",
  }
}

function computePr(
  i: WorkflowInputs,
  codeStatus: MilestoneStatus,
  reviewStatus: MilestoneStatus,
): MilestoneState {
  // A PR requires a remote — show idle immediately if none is configured.
  if (!i.hasRemote) {
    return {
      id: "pr",
      status: "idle",
      label: "PR",
      hint: "No remote configured",
    }
  }
  if (i.prState === "merged") {
    return {
      id: "pr",
      status: "done",
      label: "PR",
      hint: "PR merged",
      actionKind: "openPr",
    }
  }
  if (i.prState === "open" || i.prState === "draft") {
    return {
      id: "pr",
      status: "info",
      label: "PR",
      hint: i.prState === "draft" ? "Draft PR open" : "PR open",
      actionKind: "openPr",
    }
  }
  if (i.prCreating) {
    return {
      id: "pr",
      status: "in_progress",
      label: "PR",
      hint: "Creating PR…",
    }
  }
  if (
    codeStatus === "done" &&
    (reviewStatus === "done" || reviewStatus === "attention")
  ) {
    return {
      id: "pr",
      status: "attention",
      label: "PR",
      hint: "Ready to open PR",
      actionKind: "createPr",
    }
  }
  return {
    id: "pr",
    status: "idle",
    label: "PR",
    hint: "Waiting on code/review",
  }
}
