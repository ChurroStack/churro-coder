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

// ── Snapshot sub-types ──────────────────────────────────────────────────────

export interface PlanInfo {
  exists: boolean;
  meta?: { approvedAt?: string };
}

export interface ReviewInfo {
  exists: boolean;
}

export type WorkflowActivity = 'idle' | 'streaming' | 'compacting';

/**
 * Single typed input for `computeWorkflowState`. Built once per render by
 * `useWorkflowSnapshot()` and passed to the pure function. Every UI surface
 * (notch, status widget, sidebar widgets) reads through `useWorkflowState()`,
 * which is `computeWorkflowState(useWorkflowSnapshot())`.
 *
 * Fields:
 * - `plan` — artifact existence from `chats.getCurrentPlan`. `null` = query
 *   still loading; `{ exists: false }` = no plan file on disk; `{ exists: true,
 *   meta: { approvedAt } }` = plan file exists.
 * - `review` — artifact existence from `chats.getCurrentReview` (PR 5). `null`
 *   = loading; `{ exists: false }` = no review file yet.
 * - `git.headSha` — HEAD commit SHA at snapshot time, used by the Review
 *   milestone staleness check (PR 5).
 * - `hasHistory` — true once the AI has completed at least one streaming response
 *   in this sub-chat. Prevents the Code milestone from showing "Up to date"
 *   before any AI work has occurred.
 */
export interface WorkflowSnapshot {
  mode: 'plan' | 'execute' | 'explore' | 'review';
  activity: WorkflowActivity;
  plan: PlanInfo | null;
  review: ReviewInfo | null;
  git: {
    changedFiles: number;
    headSha: string;
    hasRemote: boolean;
  };
  pushCount: number;
  hasUpstream: boolean;
  baseBranchBehind: number;
  pr: {
    state: 'none' | 'draft' | 'open' | 'merged' | 'closed';
    reviewDecision: 'none' | 'pending' | 'approved' | 'changes_requested';
    creating: boolean;
  };
  hasHistory: boolean;
}

export function computeWorkflowState(s: WorkflowSnapshot): WorkflowState {
  const plan = computePlan(s);
  const code = computeCode(s, plan.status);
  const review = computeReview(s, code.status);
  const pr = computePr(s, code.status, review.status);

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
    (s.pr.state === 'open' || s.pr.state === 'merged');

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

function computePlan(s: WorkflowSnapshot): MilestoneState {
  if (s.mode !== 'plan') {
    // Artifact-driven: done when the plan file exists and we've left plan mode.
    // approvedAt is set by the approval flow for new plans; older plans that lack
    // it are still considered done because exiting plan mode is the approval act.
    if (s.plan?.exists) {
      return { id: 'plan', status: 'done', label: 'Plan', hint: 'Plan approved' };
    }
    return { id: 'plan', status: 'idle', label: 'Plan', hint: 'Skipped (execute mode)' };
  }

  // mode === 'plan'. Treat compacting as in-progress too — the user expects the
  // Plan pill to stay animated while the AI is doing work behind the scenes,
  // not flip back to "Start chatting" mid-flight.
  if (s.activity === 'streaming' || s.activity === 'compacting') {
    return { id: 'plan', status: 'in_progress', label: 'Plan', hint: 'Drafting plan…' };
  }

  // Plan artifact exists but not yet approved → ready to approve.
  if (s.plan?.exists) {
    return {
      id: 'plan',
      status: 'attention',
      label: 'Plan',
      hint: 'Plan ready — review and approve',
      actionKind: 'expandPlan'
    };
  }

  // No plan artifact yet, not streaming → blank/new chat.
  return { id: 'plan', status: 'idle', label: 'Plan', hint: 'Start chatting to begin' };
}

function computeCode(s: WorkflowSnapshot, planStatus: MilestoneStatus): MilestoneState {
  // While the workspace is still in plan mode, nothing downstream can be
  // "done". The kanban groups this workspace under "Planning" — keeping Code
  // idle here keeps the Status widget consistent with that grouping.
  // (planStatus alone is insufficient: when the user has chatted in plan mode
  // without producing a plan artifact, planStatus is 'idle' and we'd otherwise
  // wrongly fall through to the "Up to date" branch.)
  if (s.mode === 'plan' || planStatus === 'in_progress' || planStatus === 'attention') {
    return {
      id: 'code',
      status: 'idle',
      label: 'Code',
      hint: 'Waiting on plan'
    };
  }
  if (s.activity === 'streaming') {
    return {
      id: 'code',
      status: 'in_progress',
      label: 'Code',
      hint: 'Execute mode is editing…'
    };
  }
  if (s.baseBranchBehind > 0) {
    return {
      id: 'code',
      status: 'attention',
      label: 'Code',
      hint: `Base branch has ${s.baseBranchBehind} new commit${s.baseBranchBehind === 1 ? '' : 's'}`,
      actionKind: 'mergeBase'
    };
  }
  // No remote at all → can't push; treat as done and let the user proceed to Review
  if (!s.git.hasRemote) {
    return {
      id: 'code',
      status: 'done',
      label: 'Code',
      hint: 'Changes ready (no remote)'
    };
  }
  if (!s.hasUpstream) {
    return {
      id: 'code',
      status: 'attention',
      label: 'Code',
      hint: 'Push branch to origin',
      actionKind: 'pushBranch'
    };
  }
  if (s.pushCount > 0) {
    return {
      id: 'code',
      status: 'attention',
      label: 'Code',
      hint: `Push ${s.pushCount} commit${s.pushCount === 1 ? '' : 's'} to origin`,
      actionKind: 'pushBranch'
    };
  }
  // baseBranchBehind === 0 already guaranteed by the early return above.
  if (s.git.changedFiles === 0 && s.pushCount === 0) {
    // Clean tree once the AI has done work → done. Use "Up to date" rather than
    // "All changes pushed" because a text-only AI response leaves the tree clean
    // without anything actually being pushed. Only show idle when no AI run yet.
    if (s.hasHistory) {
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

function computeReview(s: WorkflowSnapshot, codeStatus: MilestoneStatus): MilestoneState {
  if (codeStatus !== 'done') {
    return { id: 'review', status: 'idle', label: 'Review', hint: 'Waiting on code' };
  }
  // Stale-PR mirror: when a PR exists but the tree has new work, the previous
  // review only covered what's already in the PR. Surface review as attention
  // so the user re-reviews the delta locally before commit+push.
  if (
    (s.pr.state === 'open' || s.pr.state === 'merged') &&
    (s.git.changedFiles > 0 || (s.hasUpstream && s.pushCount > 0))
  ) {
    return {
      id: 'review',
      status: 'attention',
      label: 'Review',
      hint: 'Review delta before pushing',
      actionKind: 'reviewLocal'
    };
  }
  if (s.pr.reviewDecision === 'changes_requested') {
    return {
      id: 'review',
      status: 'attention',
      label: 'Review',
      hint: 'Changes requested on PR',
      actionKind: 'reviewPr'
    };
  }
  if (s.pr.reviewDecision === 'approved') {
    return { id: 'review', status: 'done', label: 'Review', hint: 'PR approved' };
  }
  if (s.pr.state === 'merged') {
    return { id: 'review', status: 'done', label: 'Review', hint: 'PR merged' };
  }
  if (s.pr.state === 'open') {
    // A PR being open means the author has reviewed the work and it is ready for
    // external review. Reviewer activity surfaces via reviewDecision (changes_requested /
    // approved) which are handled above — no need to prompt again here.
    return { id: 'review', status: 'done', label: 'Review', hint: 'PR open' };
  }
  if (s.pr.state === 'draft') {
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
  // re-review and open a fresh PR — falling through to the review.exists / reviewLocal paths.
  if (s.pr.state === 'closed' && s.git.changedFiles === 0 && s.pushCount === 0) {
    return { id: 'review', status: 'info', label: 'Review', hint: 'PR closed' };
  }
  // Artifact-driven: review artifact (PR 5) or fallback to session-local signal.
  if (s.review?.exists && (s.pr.state === 'none' || s.pr.state === 'closed')) {
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

function computePr(s: WorkflowSnapshot, codeStatus: MilestoneStatus, reviewStatus: MilestoneStatus): MilestoneState {
  // A PR requires a remote — show idle immediately if none is configured.
  if (!s.git.hasRemote) {
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
  if (s.pr.state === 'open' || s.pr.state === 'merged') {
    const hasUncommitted = s.git.changedFiles > 0;
    const hasUnpushed = s.hasUpstream && s.pushCount > 0;
    if (hasUncommitted || hasUnpushed) {
      const prLabel = s.pr.state === 'merged' ? 'PR merged' : 'PR open';
      let hint: string;
      if (hasUncommitted && hasUnpushed) {
        hint = `${prLabel} — commit & push pending`;
      } else if (hasUncommitted) {
        const fileWord = s.git.changedFiles === 1 ? 'file' : 'files';
        hint = `${prLabel} — commit ${s.git.changedFiles} ${fileWord}`;
      } else {
        const commitWord = s.pushCount === 1 ? 'commit' : 'commits';
        hint = `${prLabel} — push ${s.pushCount} ${commitWord}`;
      }
      return { id: 'pr', status: 'attention', label: 'PR', hint, actionKind: 'createPr' };
    }
  }
  if (s.pr.state === 'merged') {
    return {
      id: 'pr',
      status: 'done',
      label: 'PR',
      hint: 'PR merged',
      actionKind: 'openPr'
    };
  }
  if (s.pr.state === 'open') {
    // PR exists and is ready for review — the author's work on this step is done.
    return { id: 'pr', status: 'done', label: 'PR', hint: 'PR open', actionKind: 'openPr' };
  }
  if (s.pr.state === 'draft') {
    return { id: 'pr', status: 'info', label: 'PR', hint: 'Draft PR open', actionKind: 'openPr' };
  }
  // Closed PR with no new work → terminal info state. With unpushed/uncommitted work,
  // fall through so the user can open a fresh PR from this branch.
  if (s.pr.state === 'closed' && s.git.changedFiles === 0 && s.pushCount === 0) {
    return { id: 'pr', status: 'info', label: 'PR', hint: 'PR closed', actionKind: 'openPr' };
  }
  if (s.pr.creating) {
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
