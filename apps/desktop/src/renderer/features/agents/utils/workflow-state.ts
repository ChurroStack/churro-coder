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
  meta?: { createdAt?: string; approvedAt?: string };
}

export interface ReviewInfo {
  exists: boolean;
  meta?: { createdAt?: string; acceptedAt?: string };
}

export interface TasksInfo {
  exists: boolean;
  total: number;
  completed: number;
  updatedAt: string | null;
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
 *   meta: { createdAt, approvedAt } }` = plan file exists.
 * - `review` — artifact existence from `chats.getCurrentReview`. `null`
 *   = loading; `{ exists: false }` = no review file yet; `{ exists: true,
 *   meta: { createdAt, acceptedAt } }` = review exists.
 * - `tasks` — from `chats.getCurrentTasks`. `null` = loading; `{ exists: false }`
 *   = no tasks file; `{ exists: true, total, completed, updatedAt }` = tasks exist.
 * - `harness` — 'builtin' | 'cli'. CLI harnesses never get plan-mode atoms.
 * - `cliBusy` — true while `terminal.state` is `'running'` for a CLI sub-chat.
 * - `git.headSha` — HEAD commit SHA at snapshot time.
 * - `hasHistory` — true once the AI has completed at least one streaming response.
 */
export interface WorkflowSnapshot {
  mode: 'plan' | 'execute' | 'explore' | 'review';
  activity: WorkflowActivity;
  harness?: 'builtin' | 'cli';
  cliBusy?: boolean;
  plan: PlanInfo | null;
  review: ReviewInfo | null;
  tasks?: TasksInfo | null;
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

// ── Timestamp helpers ────────────────────────────────────────────────────────

// Sentinel: any artifact lacking a timestamp is treated as epoch-0 so that
// newer timestamps always compare as "more recent". This is lenient for legacy
// plans that were written before createdAt was tracked.
const EPOCH = '1970-01-01T00:00:00.000Z';

function ts(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return isNaN(t) ? 0 : t;
}

// T(plan) = plan.meta.createdAt (epoch-0 when missing → always ≤ any real timestamp)
function tPlan(s: WorkflowSnapshot): number {
  return ts(s.plan?.meta?.createdAt ?? EPOCH);
}

// T(tasks) = tasks.updatedAt (epoch-0 when tasks don't exist)
function tTasks(s: WorkflowSnapshot): number {
  return ts(s.tasks?.updatedAt ?? null);
}

// T(approve) = plan.meta.approvedAt
function tApprove(s: WorkflowSnapshot): number {
  return ts(s.plan?.meta?.approvedAt ?? null);
}

// T(review) = review.meta.createdAt
function tReview(s: WorkflowSnapshot): number {
  return ts(s.review?.meta?.createdAt ?? null);
}

// T(accept) = review.meta.acceptedAt
function tAccept(s: WorkflowSnapshot): number {
  return ts(s.review?.meta?.acceptedAt ?? null);
}

// tasksForCurrentPlan: tasks exist AND were written after (or at) the plan
function tasksForCurrentPlan(s: WorkflowSnapshot): boolean {
  return !!s.tasks?.exists && tTasks(s) >= tPlan(s);
}

// reviewForCurrentWork: review exists with a real createdAt AND was written after plan AND tasks.
// Legacy reviews with no createdAt fall through to the legacy done path below.
function reviewForCurrentWork(s: WorkflowSnapshot): boolean {
  if (!s.review?.exists) return false;
  if (!s.review.meta?.createdAt) return false;
  const refTime = Math.max(tPlan(s), tTasks(s));
  return tReview(s) >= refTime;
}

// reviewAcceptedForCurrentReview: acceptedAt is set AND >= review createdAt
function reviewAcceptedForCurrentReview(s: WorkflowSnapshot): boolean {
  if (!s.review?.exists) return false;
  if (!s.review.meta?.acceptedAt) return false; // must have an explicit acceptedAt
  return tAccept(s) >= tReview(s);
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function computeWorkflowState(raw: WorkflowSnapshot): WorkflowState {
  // Normalize: fill in defaults for new optional fields so callers that don't
  // set them (e.g. legacy tests, callers before migration) still work correctly.
  const s: WorkflowSnapshot = {
    harness: 'builtin',
    cliBusy: false,
    tasks: null,
    ...raw
  };

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

// ── Plan ─────────────────────────────────────────────────────────────────────

function computePlan(s: WorkflowSnapshot): MilestoneState {
  const hasPlan = !!s.plan?.exists;

  // in_progress: builtin streaming in plan mode, or CLI busy before tasks appear
  if (s.harness === 'builtin') {
    if (s.mode === 'plan') {
      if (s.activity === 'streaming' || s.activity === 'compacting') {
        return { id: 'plan', status: 'in_progress', label: 'Plan', hint: 'Drafting plan…' };
      }
      // Plan artifact exists but not yet approved → ready to approve.
      if (hasPlan) {
        return {
          id: 'plan',
          status: 'attention',
          label: 'Plan',
          hint: 'Plan ready — review and approve',
          actionKind: 'expandPlan'
        };
      }
      return { id: 'plan', status: 'idle', label: 'Plan', hint: 'Start chatting to begin' };
    }

    // Builtin, not in plan mode: artifact-driven
    if (hasPlan) {
      // Green when: tasks exist for this plan, OR plan was explicitly approved
      if (tasksForCurrentPlan(s) || tApprove(s) >= tPlan(s)) {
        return { id: 'plan', status: 'done', label: 'Plan', hint: 'Plan approved' };
      }
      // Plan written but no tasks and no approval → orange
      return {
        id: 'plan',
        status: 'attention',
        label: 'Plan',
        hint: 'Plan ready — review and approve',
        actionKind: 'expandPlan'
      };
    }
    return { id: 'plan', status: 'idle', label: 'Plan', hint: 'Skipped (execute mode)' };
  }

  // CLI harness: pure artifact + timestamp rules
  if (s.cliBusy && !s.tasks?.exists) {
    return { id: 'plan', status: 'in_progress', label: 'Plan', hint: 'Drafting plan…' };
  }

  if (!hasPlan) {
    return { id: 'plan', status: 'idle', label: 'Plan', hint: 'No plan yet' };
  }

  // Plan written: green when tasks for current plan exist OR approved
  if (tasksForCurrentPlan(s) || tApprove(s) >= tPlan(s)) {
    return { id: 'plan', status: 'done', label: 'Plan', hint: 'Plan approved' };
  }

  // Plan written but no tasks and no approval
  return {
    id: 'plan',
    status: 'attention',
    label: 'Plan',
    hint: 'Plan written — tasks not yet created',
    actionKind: 'expandPlan'
  };
}

// ── Code ─────────────────────────────────────────────────────────────────────

function computeCode(s: WorkflowSnapshot, planStatus: MilestoneStatus): MilestoneState {
  // Code is gated on plan being done or idle (idle = no plan used)
  if (planStatus === 'in_progress' || planStatus === 'attention') {
    return { id: 'code', status: 'idle', label: 'Code', hint: 'Waiting on plan' };
  }

  const hasTasks = tasksForCurrentPlan(s);

  // Tasks-based path: when tasks exist for the current plan, use task completion
  if (hasTasks) {
    const total = s.tasks!.total;
    const completed = s.tasks!.completed;

    // in_progress: CLI busy, or builtin streaming in execute mode
    if (
      (s.harness === 'cli' && s.cliBusy) ||
      (s.harness === 'builtin' && s.activity === 'streaming' && s.mode !== 'plan')
    ) {
      return { id: 'code', status: 'in_progress', label: 'Code', hint: 'Executing tasks…' };
    }

    if (total === 0) {
      return { id: 'code', status: 'attention', label: 'Code', hint: 'Task list is empty' };
    }
    if (completed < total) {
      return {
        id: 'code',
        status: 'attention',
        label: 'Code',
        hint: `${completed}/${total} tasks complete`
      };
    }
    return { id: 'code', status: 'done', label: 'Code', hint: `All ${total} tasks complete` };
  }

  // No-tasks fallback: builtin git-based rules (keeps classic flow working)
  if (s.mode === 'plan') {
    return { id: 'code', status: 'idle', label: 'Code', hint: 'Waiting on plan' };
  }

  if (s.harness === 'builtin' && s.activity === 'streaming') {
    return { id: 'code', status: 'in_progress', label: 'Code', hint: 'Execute mode is editing…' };
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
  if (!s.git.hasRemote) {
    return { id: 'code', status: 'done', label: 'Code', hint: 'Changes ready (no remote)' };
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
  if (s.git.changedFiles === 0 && s.pushCount === 0) {
    if (s.hasHistory) {
      return { id: 'code', status: 'done', label: 'Code', hint: 'Up to date' };
    }
    return { id: 'code', status: 'idle', label: 'Code', hint: 'No changes' };
  }
  return { id: 'code', status: 'done', label: 'Code', hint: 'All changes pushed' };
}

// ── Review ────────────────────────────────────────────────────────────────────

function computeReview(s: WorkflowSnapshot, codeStatus: MilestoneStatus): MilestoneState {
  // Acceptance check is unconditional: once the user clicks Fix, the review stays
  // done even while the fix run is in progress (Code amber, tasks partially complete).
  // A new write_review call resets createdAt to after acceptedAt, naturally un-doing.
  if (reviewAcceptedForCurrentReview(s)) {
    return { id: 'review', status: 'done', label: 'Review', hint: 'Reviewed' };
  }

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
  if (s.pr.state === 'closed' && s.git.changedFiles === 0 && s.pushCount === 0) {
    return { id: 'review', status: 'info', label: 'Review', hint: 'PR closed' };
  }
  if (reviewForCurrentWork(s)) {
    return {
      id: 'review',
      status: 'attention',
      label: 'Review',
      hint: 'Review written — click Fix to accept',
      actionKind: 'reviewLocal'
    };
  }

  // Legacy: review exists with no createdAt timestamp (pre-timestamp artifacts).
  // Treat as done to avoid regressing classic builtin flows. If createdAt exists,
  // the timestamp check already ran above — don't re-admit it here as "done".
  if (s.review?.exists && !s.review.meta?.createdAt && (s.pr.state === 'none' || s.pr.state === 'closed')) {
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

// ── PR ────────────────────────────────────────────────────────────────────────

function computePr(s: WorkflowSnapshot, codeStatus: MilestoneStatus, reviewStatus: MilestoneStatus): MilestoneState {
  if (!s.git.hasRemote) {
    return { id: 'pr', status: 'idle', label: 'PR', hint: 'No remote configured' };
  }
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
    return { id: 'pr', status: 'done', label: 'PR', hint: 'PR merged', actionKind: 'openPr' };
  }
  if (s.pr.state === 'open') {
    return { id: 'pr', status: 'done', label: 'PR', hint: 'PR open', actionKind: 'openPr' };
  }
  if (s.pr.state === 'draft') {
    return { id: 'pr', status: 'info', label: 'PR', hint: 'Draft PR open', actionKind: 'openPr' };
  }
  if (s.pr.state === 'closed' && s.git.changedFiles === 0 && s.pushCount === 0) {
    return { id: 'pr', status: 'info', label: 'PR', hint: 'PR closed', actionKind: 'openPr' };
  }
  if (s.pr.creating) {
    return { id: 'pr', status: 'in_progress', label: 'PR', hint: 'Creating PR…' };
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
  return { id: 'pr', status: 'idle', label: 'PR', hint: 'Waiting on code/review' };
}
