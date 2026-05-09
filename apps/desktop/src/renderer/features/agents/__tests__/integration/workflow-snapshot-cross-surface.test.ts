/**
 * L2 cross-surface drift battery — PR 4.
 *
 * Each test drives `computeWorkflowState(snapshot)` with a parameterized
 * WorkflowSnapshot fixture and asserts that every milestone label + status
 * is self-consistent. This catches the class of bug where one surface (e.g.
 * the notch button) lags behind another (e.g. the status widget pill) because
 * they compute their state independently rather than sharing a single snapshot.
 *
 * Invariant under test: for any given snapshot, `computeWorkflowState`
 * produces a single WorkflowState that all surfaces MUST agree on.
 *
 * These are pure-function tests — no React, no jotai, no tRPC.
 */
import { describe, test, expect } from 'vitest';
import { computeWorkflowState } from '../../utils/workflow-state';
import type { WorkflowSnapshot } from '../../utils/workflow-state';

// ── Snapshot fixtures ────────────────────────────────────────────────────────

const noGit: WorkflowSnapshot['git'] = { changedFiles: 0, headSha: '', hasRemote: false };
const withRemote: WorkflowSnapshot['git'] = { changedFiles: 0, headSha: 'abc', hasRemote: true };
const withChanges: WorkflowSnapshot['git'] = { changedFiles: 3, headSha: 'abc', hasRemote: true };
const noPr: WorkflowSnapshot['pr'] = { state: 'none', reviewDecision: 'none', creating: false };
const openPr: WorkflowSnapshot['pr'] = { state: 'open', reviewDecision: 'none', creating: false };
const mergedPr: WorkflowSnapshot['pr'] = { state: 'merged', reviewDecision: 'none', creating: false };
const closedPr: WorkflowSnapshot['pr'] = { state: 'closed', reviewDecision: 'none', creating: false };

const freshPlanChat: WorkflowSnapshot = {
  mode: 'plan',
  activity: 'idle',
  plan: { exists: false },
  review: { exists: false },
  // hasRemote + hasUpstream: true so code doesn't flip to done/attention prematurely.
  git: { changedFiles: 0, headSha: '', hasRemote: true },
  pushCount: 0,
  hasUpstream: true,
  baseBranchBehind: 0,
  pr: noPr,
  hasHistory: false
};

const planStreaming: WorkflowSnapshot = {
  ...freshPlanChat,
  activity: 'streaming',
  hasHistory: true
};

const planReadyToApprove: WorkflowSnapshot = {
  mode: 'plan',
  activity: 'idle',
  plan: { exists: true },
  review: { exists: false },
  git: withRemote,
  pushCount: 0,
  hasUpstream: true,
  baseBranchBehind: 0,
  pr: noPr,
  hasHistory: true
};

const executeWithApprovedPlan: WorkflowSnapshot = {
  mode: 'execute',
  activity: 'idle',
  plan: { exists: true, meta: { approvedAt: '2026-01-01T00:00:00.000Z' } },
  review: { exists: false },
  git: withChanges,
  pushCount: 0,
  hasUpstream: true,
  baseBranchBehind: 0,
  pr: noPr,
  hasHistory: true
};

const executeWithSkippedPlan: WorkflowSnapshot = {
  mode: 'execute',
  activity: 'idle',
  plan: { exists: false },
  review: { exists: false },
  git: withChanges,
  pushCount: 0,
  hasUpstream: true,
  baseBranchBehind: 0,
  pr: noPr,
  hasHistory: true
};

const codeCleanUpToDate: WorkflowSnapshot = {
  ...executeWithApprovedPlan,
  git: withRemote,
  pushCount: 0
};

const prOpenClean: WorkflowSnapshot = {
  ...codeCleanUpToDate,
  pr: openPr
};

const prMergedClean: WorkflowSnapshot = {
  ...codeCleanUpToDate,
  pr: mergedPr
};

const prOpenStaleChanges: WorkflowSnapshot = {
  ...executeWithApprovedPlan,
  pr: openPr,
  git: withChanges,
  pushCount: 0
};

const behindBase: WorkflowSnapshot = {
  ...executeWithApprovedPlan,
  baseBranchBehind: 2
};

const reviewArtifactExists: WorkflowSnapshot = {
  ...codeCleanUpToDate,
  review: { exists: true }
};

// ── Cross-surface assertions ─────────────────────────────────────────────────

describe('cross-surface drift battery — fresh plan chat (blank)', () => {
  test('all milestones idle, next null', () => {
    const ws = computeWorkflowState(freshPlanChat);
    expect(ws.plan.status).toBe('idle');
    expect(ws.code.status).toBe('idle');
    expect(ws.review.status).toBe('idle');
    expect(ws.pr.status).toBe('idle');
    expect(ws.next).toBeNull();
  });
});

describe('cross-surface drift battery — plan mode with prior chat history but no plan artifact', () => {
  // Reproduces the production bug: an OpenSpec sub-chat where the AI has
  // responded once (hasHistory = true) but no plan artifact exists yet.
  // The kanban groups this workspace under "Planning" (mode === 'plan');
  // the Status widget MUST agree by keeping Code idle "Waiting on plan",
  // not flipping it to "Up to date / done".
  const planWithHistoryNoArtifact: WorkflowSnapshot = {
    ...freshPlanChat,
    hasHistory: true
  };

  test('Code stays idle "Waiting on plan" (no drift vs kanban Planning column)', () => {
    const ws = computeWorkflowState(planWithHistoryNoArtifact);
    expect(ws.plan.status).toBe('idle');
    expect(ws.code.status).toBe('idle');
    expect(ws.code.hint).toBe('Waiting on plan');
    expect(ws.review.status).toBe('idle');
    expect(ws.pr.status).toBe('idle');
    expect(ws.next).toBeNull();
  });
});

describe('cross-surface drift battery — plan streaming', () => {
  test('plan in_progress, rest idle, next null', () => {
    const ws = computeWorkflowState(planStreaming);
    expect(ws.plan.status).toBe('in_progress');
    expect(ws.code.status).toBe('idle');
    expect(ws.review.status).toBe('idle');
    expect(ws.pr.status).toBe('idle');
    expect(ws.next).toBeNull();
  });

  test('plan in_progress implies code hint is "Waiting on plan"', () => {
    const ws = computeWorkflowState(planStreaming);
    expect(ws.code.hint).toBe('Waiting on plan');
  });
});

describe('cross-surface drift battery — plan artifact exists, awaiting approval', () => {
  test('plan attention with expandPlan, code/review/pr blocked', () => {
    const ws = computeWorkflowState(planReadyToApprove);
    expect(ws.plan.status).toBe('attention');
    expect(ws.plan.actionKind).toBe('expandPlan');
    expect(ws.code.status).toBe('idle');
    expect(ws.code.hint).toBe('Waiting on plan');
    expect(ws.review.status).toBe('idle');
    expect(ws.pr.status).toBe('idle');
  });

  test('next points to plan expandPlan — all surfaces agree', () => {
    const ws = computeWorkflowState(planReadyToApprove);
    expect(ws.next?.milestone).toBe('plan');
    expect(ws.next?.actionKind).toBe('expandPlan');
    expect(ws.next?.label).toBe('Plan ready — review and approve');
  });
});

describe('cross-surface drift battery — execute with approved plan, changes uncommitted', () => {
  test('plan done, code done (changes = committed target), review attention', () => {
    const ws = computeWorkflowState(executeWithApprovedPlan);
    expect(ws.plan.status).toBe('done');
    expect(ws.plan.hint).toBe('Plan approved');
    // changedFiles > 0 → code is done (treated as ready to commit/push)
    expect(ws.code.status).toBe('done');
    expect(ws.review.status).toBe('attention');
    expect(ws.review.actionKind).toBe('reviewLocal');
  });

  test('next points to review — plan done frees code', () => {
    const ws = computeWorkflowState(executeWithApprovedPlan);
    expect(ws.next?.milestone).toBe('review');
    expect(ws.next?.actionKind).toBe('reviewLocal');
  });
});

describe('cross-surface drift battery — execute with skipped plan', () => {
  test('plan idle (Skipped), code done, review attention', () => {
    const ws = computeWorkflowState(executeWithSkippedPlan);
    expect(ws.plan.status).toBe('idle');
    expect(ws.plan.hint).toContain('Skipped');
    expect(ws.code.status).toBe('done');
    expect(ws.review.status).toBe('attention');
  });
});

describe('cross-surface drift battery — code up to date, no PR', () => {
  test('plan done, code done, review attention (no artifact yet), pr attention', () => {
    const ws = computeWorkflowState(codeCleanUpToDate);
    expect(ws.plan.status).toBe('done');
    expect(ws.code.status).toBe('done');
    expect(ws.code.hint).toBe('Up to date');
    // review.exists === false → not done
    expect(ws.review.status).toBe('attention');
    expect(ws.review.actionKind).toBe('reviewLocal');
  });
});

describe('cross-surface drift battery — review artifact exists', () => {
  test('plan done, code done, review done, pr attention createPr — all surfaces agree', () => {
    const ws = computeWorkflowState(reviewArtifactExists);
    expect(ws.plan.status).toBe('done');
    expect(ws.code.status).toBe('done');
    expect(ws.review.status).toBe('done');
    expect(ws.review.hint).toBe('Reviewed');
    expect(ws.pr.status).toBe('attention');
    expect(ws.pr.actionKind).toBe('createPr');
    expect(ws.next?.milestone).toBe('pr');
  });
});

describe('cross-surface drift battery — PR open clean', () => {
  test('all four milestones done, next null', () => {
    const ws = computeWorkflowState(prOpenClean);
    expect(ws.plan.status).toBe('done');
    expect(ws.code.status).toBe('done');
    expect(ws.review.status).toBe('done');
    expect(ws.pr.status).toBe('done');
    expect(ws.next).toBeNull();
  });
});

describe('cross-surface drift battery — PR merged clean', () => {
  test('all four milestones done, next null', () => {
    const ws = computeWorkflowState(prMergedClean);
    expect(ws.plan.status).toBe('done');
    expect(ws.code.status).toBe('done');
    expect(ws.review.status).toBe('done');
    expect(ws.pr.status).toBe('done');
    expect(ws.next).toBeNull();
  });
});

describe('cross-surface drift battery — PR open but stale (new local changes)', () => {
  test('pr attention, review attention (review delta), code done', () => {
    const ws = computeWorkflowState(prOpenStaleChanges);
    expect(ws.pr.status).toBe('attention');
    expect(ws.pr.actionKind).toBe('createPr');
    expect(ws.review.status).toBe('attention');
    expect(ws.review.actionKind).toBe('reviewLocal');
    expect(ws.code.status).toBe('done');
  });

  test('PR-stale wins next over review — cascade reorder applied', () => {
    const ws = computeWorkflowState(prOpenStaleChanges);
    expect(ws.next?.milestone).toBe('pr');
    expect(ws.next?.actionKind).toBe('createPr');
  });
});

describe('cross-surface drift battery — behind base branch', () => {
  test('code attention mergeBase, review + pr blocked', () => {
    const ws = computeWorkflowState(behindBase);
    expect(ws.code.status).toBe('attention');
    expect(ws.code.actionKind).toBe('mergeBase');
    // review is blocked (code not done)
    expect(ws.review.status).toBe('idle');
    expect(ws.review.hint).toBe('Waiting on code');
    expect(ws.next?.milestone).toBe('code');
    expect(ws.next?.actionKind).toBe('mergeBase');
  });
});

describe('cross-surface drift battery — no remote configured', () => {
  test('code done no-remote, pr idle, review can still be attention', () => {
    const noRemoteSnap: WorkflowSnapshot = {
      ...executeWithApprovedPlan,
      git: noGit,
      pushCount: 0,
      hasUpstream: false
    };
    const ws = computeWorkflowState(noRemoteSnap);
    expect(ws.code.status).toBe('done');
    expect(ws.code.hint).toBe('Changes ready (no remote)');
    expect(ws.pr.status).toBe('idle');
    expect(ws.pr.hint).toBe('No remote configured');
  });
});

describe('cross-surface drift battery — plan mode wins next even with PR stale', () => {
  test('plan attention beats PR amber-stale in cascade', () => {
    const midPlanWithStalePr: WorkflowSnapshot = {
      ...planReadyToApprove,
      pr: openPr,
      git: withChanges
    };
    const ws = computeWorkflowState(midPlanWithStalePr);
    expect(ws.plan.status).toBe('attention');
    expect(ws.pr.status).toBe('attention');
    // Plan wins over PR stale
    expect(ws.next?.milestone).toBe('plan');
    expect(ws.next?.actionKind).toBe('expandPlan');
  });
});

describe('cross-surface drift battery — PR closed recovery path', () => {
  test('closed PR + clean code → review info, pr info', () => {
    const snap: WorkflowSnapshot = { ...codeCleanUpToDate, pr: closedPr };
    const ws = computeWorkflowState(snap);
    expect(ws.review.status).toBe('info');
    expect(ws.review.hint).toBe('PR closed');
    expect(ws.pr.status).toBe('info');
    expect(ws.pr.hint).toBe('PR closed');
  });

  test('closed PR + uncommitted changes → attention path for review + pr', () => {
    const snap: WorkflowSnapshot = { ...executeWithApprovedPlan, pr: closedPr, git: withChanges };
    const ws = computeWorkflowState(snap);
    expect(ws.review.status).toBe('attention');
    expect(ws.review.actionKind).toBe('reviewLocal');
    expect(ws.pr.status).toBe('attention');
    expect(ws.pr.actionKind).toBe('createPr');
  });
});
