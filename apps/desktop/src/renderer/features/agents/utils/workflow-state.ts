export type MilestoneStatus = 'idle' | 'in_progress' | 'attention' | 'done' | 'info';

export type MilestoneId = 'plan' | 'code' | 'review' | 'pr';

export type WorkflowActionKind =
  | 'expandPlan'
  | 'mergeBase'
  | 'pushBranch'
  | 'reviewLocal'
  | 'reviewPr'
  | 'createPr'
  | 'openPr';

export interface MilestoneState {
  id: MilestoneId;
  status: MilestoneStatus;
  label: string;
  hint?: string;
  actionKind?: WorkflowActionKind;
}

export interface WorkflowState {
  plan: MilestoneState;
  code: MilestoneState;
  review: MilestoneState;
  pr: MilestoneState;
  next: {
    milestone: MilestoneId;
    label: string;
    actionKind: WorkflowActionKind;
  } | null;
}

export interface WorkflowInputs {
  mode: 'plan' | 'execute';
  isStreaming: boolean;
  isCompacting: boolean;
  planEverGenerated: boolean;
  /** True once the AI has completed at least one streaming response in this sub-chat. */
  hasAiResponded: boolean;
  changedFilesCount: number;
  pushCount: number;
  hasUpstream: boolean;
  hasRemote: boolean;
  baseBranchBehind: number;
  prState: 'none' | 'draft' | 'open' | 'merged' | 'closed';
  reviewDecision: 'none' | 'pending' | 'approved' | 'changes_requested';
  localReviewCompleted: boolean;
  prCreating: boolean;
}

export function computeWorkflowState(i: WorkflowInputs): WorkflowState {
  const plan = computePlan(i);
  const code = computeCode(i, plan.status);
  const review = computeReview(i, code.status);
  const pr = computePr(i, code.status, review.status);

  // When PR is amber-stale, it owns the primary action. The single `createPr`
  // prompt handles commit+push+(maybe-create) end-to-end, so prompting the
  // user toward "pushBranch" or "reviewLocal" first would just delay the same
  // work. PR-stale beats Code/Review attention when "PR exists, but local
  // has new work." Plan-attention always wins regardless — the user is still
  // mid-planning and shouldn't be redirected to PR work.
  const prIsStale =
    plan.status !== 'attention' &&
    pr.status === 'attention' &&
    pr.actionKind === 'createPr' &&
    (i.prState === 'open' || i.prState === 'merged');

  const order: MilestoneState[] = prIsStale ? [pr, plan, code, review] : [plan, code, review, pr];
  const nextSource =
    order.find((m) => m.status === 'attention' && m.actionKind) ??
    order.find((m) => m.status === 'in_progress' && m.actionKind) ??
    null;

  const next =
    nextSource && nextSource.actionKind
      ? {
          milestone: nextSource.id,
          label: nextSource.hint ?? nextSource.label,
          actionKind: nextSource.actionKind
        }
      : null;

  return { plan, code, review, pr, next };
}

function computePlan(i: WorkflowInputs): MilestoneState {
  // mode is the persisted source of truth — same atom that gates the Approve button.
  // As long as mode === "plan" the plan has not been approved yet.
  if (i.mode !== 'plan') {
    return i.planEverGenerated
      ? { id: 'plan', status: 'done', label: 'Plan', hint: 'Plan approved' }
      : { id: 'plan', status: 'idle', label: 'Plan', hint: 'Skipped (execute mode)' };
  }

  // Streaming in plan mode → AI is still drafting
  if (i.isStreaming) {
    return { id: 'plan', status: 'in_progress', label: 'Plan', hint: 'Drafting plan…' };
  }

  // mode === "plan", not streaming, AI hasn't responded yet → brand-new / empty chat.
  // Don't claim a plan is ready to approve when no plan has been drafted.
  if (!i.hasAiResponded) {
    return { id: 'plan', status: 'idle', label: 'Plan', hint: 'Start chatting to begin' };
  }

  // mode === "plan", not streaming, AI has responded → plan awaits approval.
  return {
    id: 'plan',
    status: 'attention',
    label: 'Plan',
    hint: 'Plan ready — review and approve',
    actionKind: 'expandPlan'
  };
}

function computeCode(i: WorkflowInputs, planStatus: MilestoneStatus): MilestoneState {
  if (planStatus === 'in_progress' || planStatus === 'attention') {
    return {
      id: 'code',
      status: 'idle',
      label: 'Code',
      hint: 'Waiting on plan'
    };
  }
  if (i.isStreaming && !i.isCompacting) {
    return {
      id: 'code',
      status: 'in_progress',
      label: 'Code',
      hint: 'Execute mode is editing…'
    };
  }
  if (i.baseBranchBehind > 0) {
    return {
      id: 'code',
      status: 'attention',
      label: 'Code',
      hint: `Base branch has ${i.baseBranchBehind} new commit${i.baseBranchBehind === 1 ? '' : 's'}`,
      actionKind: 'mergeBase'
    };
  }
  // No remote at all → can't push; treat as done and let the user proceed to Review
  if (!i.hasRemote) {
    return {
      id: 'code',
      status: 'done',
      label: 'Code',
      hint: 'Changes ready (no remote)'
    };
  }
  if (!i.hasUpstream) {
    return {
      id: 'code',
      status: 'attention',
      label: 'Code',
      hint: 'Push branch to origin',
      actionKind: 'pushBranch'
    };
  }
  if (i.pushCount > 0) {
    return {
      id: 'code',
      status: 'attention',
      label: 'Code',
      hint: `Push ${i.pushCount} commit${i.pushCount === 1 ? '' : 's'} to origin`,
      actionKind: 'pushBranch'
    };
  }
  // baseBranchBehind === 0 already guaranteed by the early return above.
  if (i.changedFilesCount === 0 && i.pushCount === 0) {
    // Clean tree once the AI has done work → done. Use "Up to date" rather than
    // "All changes pushed" because a text-only AI response leaves the tree clean
    // without anything actually being pushed. Only show idle when no AI run yet.
    if (i.hasAiResponded) {
      return { id: 'code', status: 'done', label: 'Code', hint: 'Up to date' };
    }
    return { id: 'code', status: 'idle', label: 'Code', hint: 'No changes' };
  }
  return {
    id: 'code',
    status: 'done',
    label: 'Code',
    hint: 'All changes pushed'
  };
}

function computeReview(i: WorkflowInputs, codeStatus: MilestoneStatus): MilestoneState {
  if (codeStatus !== 'done') {
    return { id: 'review', status: 'idle', label: 'Review', hint: 'Waiting on code' };
  }
  // Stale-PR mirror: when a PR exists but the tree has new work, the previous
  // review only covered what's already in the PR. Surface review as attention
  // so the user re-reviews the delta locally before commit+push.
  if (
    (i.prState === 'open' || i.prState === 'merged') &&
    (i.changedFilesCount > 0 || (i.hasUpstream && i.pushCount > 0))
  ) {
    return {
      id: 'review',
      status: 'attention',
      label: 'Review',
      hint: 'Review delta before pushing',
      actionKind: 'reviewLocal'
    };
  }
  if (i.reviewDecision === 'changes_requested') {
    return {
      id: 'review',
      status: 'attention',
      label: 'Review',
      hint: 'Changes requested on PR',
      actionKind: 'reviewPr'
    };
  }
  if (i.reviewDecision === 'approved') {
    return { id: 'review', status: 'done', label: 'Review', hint: 'PR approved' };
  }
  if (i.prState === 'merged') {
    return { id: 'review', status: 'done', label: 'Review', hint: 'PR merged' };
  }
  if (i.prState === 'open') {
    // A PR being open means the author has reviewed the work and it is ready for
    // external review. Reviewer activity surfaces via reviewDecision (changes_requested /
    // approved) which are handled above — no need to prompt again here.
    return { id: 'review', status: 'done', label: 'Review', hint: 'PR open' };
  }
  if (i.prState === 'draft') {
    return {
      id: 'review',
      status: 'attention',
      label: 'Review',
      hint: 'Review pull request',
      actionKind: 'reviewPr'
    };
  }
  // prState === 'closed' with no new work → informational; the closed PR is the latest signal.
  // With new work (unpushed commits or unstaged changes), treat as 'none' so the user can
  // re-review and open a fresh PR — falling through to the localReviewCompleted / reviewLocal paths.
  if (i.prState === 'closed' && i.changedFilesCount === 0 && i.pushCount === 0) {
    return { id: 'review', status: 'info', label: 'Review', hint: 'PR closed' };
  }
  if (i.localReviewCompleted && (i.prState === 'none' || i.prState === 'closed')) {
    return { id: 'review', status: 'done', label: 'Review', hint: 'Reviewed' };
  }
  return {
    id: 'review',
    status: 'attention',
    label: 'Review',
    hint: 'Ready for review',
    actionKind: 'reviewLocal'
  };
}

function computePr(i: WorkflowInputs, codeStatus: MilestoneStatus, reviewStatus: MilestoneStatus): MilestoneState {
  // A PR requires a remote — show idle immediately if none is configured.
  if (!i.hasRemote) {
    return {
      id: 'pr',
      status: 'idle',
      label: 'PR',
      hint: 'No remote configured'
    };
  }
  // Stale PR: a PR exists (open or merged) but the local tree has new work
  // that isn't yet in the PR. Surfacing as `done` would falsely imply the
  // PR contains everything; surface as attention with the same `createPr`
  // actionKind. The dispatch handler reuses the message pattern to commit+
  // push instead of opening a duplicate PR (it's a no-op when the PR already
  // exists).
  //
  // Note: pushCount is only meaningful with hasUpstream. Without an upstream
  // we can't measure unpushed commits, so only consider changedFilesCount in
  // that case. (hasRemote === false is filtered above.)
  if (i.prState === 'open' || i.prState === 'merged') {
    const hasUncommitted = i.changedFilesCount > 0;
    const hasUnpushed = i.hasUpstream && i.pushCount > 0;
    if (hasUncommitted || hasUnpushed) {
      const prLabel = i.prState === 'merged' ? 'PR merged' : 'PR open';
      let hint: string;
      if (hasUncommitted && hasUnpushed) {
        hint = `${prLabel} — commit & push pending`;
      } else if (hasUncommitted) {
        const fileWord = i.changedFilesCount === 1 ? 'file' : 'files';
        hint = `${prLabel} — commit ${i.changedFilesCount} ${fileWord}`;
      } else {
        const commitWord = i.pushCount === 1 ? 'commit' : 'commits';
        hint = `${prLabel} — push ${i.pushCount} ${commitWord}`;
      }
      return { id: 'pr', status: 'attention', label: 'PR', hint, actionKind: 'createPr' };
    }
  }
  if (i.prState === 'merged') {
    return {
      id: 'pr',
      status: 'done',
      label: 'PR',
      hint: 'PR merged',
      actionKind: 'openPr'
    };
  }
  if (i.prState === 'open') {
    // PR exists and is ready for review — the author's work on this step is done.
    return { id: 'pr', status: 'done', label: 'PR', hint: 'PR open', actionKind: 'openPr' };
  }
  if (i.prState === 'draft') {
    return { id: 'pr', status: 'info', label: 'PR', hint: 'Draft PR open', actionKind: 'openPr' };
  }
  // Closed PR with no new work → terminal info state. With unpushed/uncommitted work,
  // fall through so the user can open a fresh PR from this branch.
  if (i.prState === 'closed' && i.changedFilesCount === 0 && i.pushCount === 0) {
    return { id: 'pr', status: 'info', label: 'PR', hint: 'PR closed', actionKind: 'openPr' };
  }
  if (i.prCreating) {
    return {
      id: 'pr',
      status: 'in_progress',
      label: 'PR',
      hint: 'Creating PR…'
    };
  }
  if (codeStatus === 'done' && (reviewStatus === 'done' || reviewStatus === 'attention')) {
    return {
      id: 'pr',
      status: 'attention',
      label: 'PR',
      hint: 'Ready to open PR',
      actionKind: 'createPr'
    };
  }
  return {
    id: 'pr',
    status: 'idle',
    label: 'PR',
    hint: 'Waiting on code/review'
  };
}
