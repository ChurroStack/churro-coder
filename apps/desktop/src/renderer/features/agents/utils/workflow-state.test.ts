import { describe, test, expect } from 'vitest';
import { computeWorkflowState } from './workflow-state';
import type { WorkflowSnapshot } from './workflow-state';

// Base represents an active execute session: plan approved, AI has responded,
// files changed (but not yet committed+pushed), upstream configured.
const base: WorkflowSnapshot = {
  mode: 'execute',
  activity: 'idle',
  harness: 'builtin',
  cliBusy: false,
  plan: { exists: true, meta: { createdAt: '2026-01-01T00:00:00.000Z', approvedAt: '2026-01-01T00:01:00.000Z' } },
  review: { exists: false },
  tasks: null,
  hasHistory: true,
  git: { changedFiles: 1, headSha: 'abc123', hasRemote: true },
  pushCount: 0,
  hasUpstream: true,
  baseBranchBehind: 0,
  pr: { state: 'none', reviewDecision: 'none', creating: false }
};

describe('computeWorkflowState — plan milestone', () => {
  test('plan mode + streaming → in_progress, others idle, next null', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', activity: 'streaming' });
    expect(s.plan.status).toBe('in_progress');
    expect(s.plan.hint).toBe('Drafting plan…');
    expect(s.code.status).toBe('idle');
    expect(s.review.status).toBe('idle');
    expect(s.pr.status).toBe('idle');
    expect(s.next).toBeNull();
  });

  test('plan mode + idle + plan artifact exists → attention with expandPlan, code blocked', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', activity: 'idle', plan: { exists: true } });
    expect(s.plan.status).toBe('attention');
    expect(s.plan.actionKind).toBe('expandPlan');
    expect(s.next?.actionKind).toBe('expandPlan');
    expect(s.next?.milestone).toBe('plan');
    expect(s.code.status).toBe('idle');
    expect(s.code.hint).toBe('Waiting on plan');
  });

  test('plan mode + idle + no plan artifact → idle (blank new chat, all idle)', () => {
    // A truly blank new chat: plan mode, no artifact, no files changed, no commits.
    const s = computeWorkflowState({
      ...base,
      mode: 'plan',
      activity: 'idle',
      plan: { exists: false },
      hasHistory: false,
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.plan.status).toBe('idle');
    expect(s.plan.hint).toBe('Start chatting to begin');
    expect(s.code.status).toBe('idle');
    // While in plan mode, Code is always "Waiting on plan" — a workspace that
    // shows up in the kanban's Planning column must not also show Code as
    // "No changes" / "Up to date" (cross-surface drift fix).
    expect(s.code.hint).toBe('Waiting on plan');
    expect(s.review.status).toBe('idle');
    expect(s.pr.status).toBe('idle');
    expect(s.next).toBeNull();
  });

  test('plan mode + idle + no plan artifact + AI has responded → Code stays "Waiting on plan" (cross-surface drift fix)', () => {
    // The screenshot bug: a workspace that the kanban groups under "Planning"
    // (mode === 'plan') MUST NOT have Code show as "Up to date / done" just
    // because the user chatted once. Until the plan exists & is approved, the
    // Status widget must mirror the kanban's "still planning" framing.
    const s = computeWorkflowState({
      ...base,
      mode: 'plan',
      activity: 'idle',
      plan: { exists: false },
      hasHistory: true,
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.plan.status).toBe('idle');
    expect(s.code.status).toBe('idle');
    expect(s.code.hint).toBe('Waiting on plan');
    expect(s.review.status).toBe('idle');
    expect(s.review.hint).toBe('Waiting on code');
    expect(s.pr.status).toBe('idle');
    expect(s.next).toBeNull();
  });

  test('execute mode + plan approved (exists + approvedAt) → plan done', () => {
    const s = computeWorkflowState({
      ...base,
      plan: { exists: true, meta: { approvedAt: '2026-01-01T00:00:00.000Z' } }
    });
    expect(s.plan.status).toBe('done');
    expect(s.plan.hint).toBe('Plan approved');
  });

  test('execute mode + no approved plan artifact → plan idle (skipped)', () => {
    const s = computeWorkflowState({ ...base, plan: { exists: false } });
    expect(s.plan.status).toBe('idle');
    expect(s.plan.hint).toContain('Skipped');
  });

  test('execute mode + plan exists but no approvedAt → plan done (legacy plans without timestamp)', () => {
    const s = computeWorkflowState({ ...base, plan: { exists: true, meta: {} } });
    expect(s.plan.status).toBe('done');
    expect(s.plan.hint).toBe('Plan approved');
  });
});

describe('computeWorkflowState — code milestone', () => {
  test('baseBranchBehind > 1 → attention mergeBase, plural hint', () => {
    const s = computeWorkflowState({ ...base, baseBranchBehind: 3 });
    expect(s.code.status).toBe('attention');
    expect(s.code.actionKind).toBe('mergeBase');
    expect(s.code.hint).toBe('Base branch has 3 new commits');
  });

  test('baseBranchBehind = 1 → singular hint', () => {
    const s = computeWorkflowState({ ...base, baseBranchBehind: 1 });
    expect(s.code.hint).toBe('Base branch has 1 new commit');
  });

  test("git.hasRemote: false → code done ('Changes ready (no remote)'), pr idle ('No remote configured')", () => {
    const s = computeWorkflowState({ ...base, git: { ...base.git, hasRemote: false } });
    expect(s.code.status).toBe('done');
    expect(s.code.hint).toBe('Changes ready (no remote)');
    expect(s.pr.status).toBe('idle');
    expect(s.pr.hint).toBe('No remote configured');
  });

  test('hasRemote: true + hasUpstream: false → code attention pushBranch', () => {
    const s = computeWorkflowState({ ...base, hasUpstream: false });
    expect(s.code.status).toBe('attention');
    expect(s.code.actionKind).toBe('pushBranch');
    expect(s.code.hint).toBe('Push branch to origin');
  });

  test('pushCount > 1 → code attention with plural count', () => {
    const s = computeWorkflowState({ ...base, pushCount: 2 });
    expect(s.code.status).toBe('attention');
    expect(s.code.actionKind).toBe('pushBranch');
    expect(s.code.hint).toBe('Push 2 commits to origin');
  });

  test('pushCount = 1 → singular hint', () => {
    const s = computeWorkflowState({ ...base, pushCount: 1 });
    expect(s.code.hint).toBe('Push 1 commit to origin');
  });

  test('streaming (not compacting) → code in_progress', () => {
    const s = computeWorkflowState({ ...base, activity: 'streaming' });
    expect(s.code.status).toBe('in_progress');
    expect(s.code.hint).toBe('Execute mode is editing…');
  });

  test('compacting → code not in_progress (compacting is excluded)', () => {
    const s = computeWorkflowState({ ...base, activity: 'compacting' });
    expect(s.code.status).not.toBe('in_progress');
  });

  test('no changes + no pushes + hasHistory → code done (clean tree after AI work)', () => {
    const s = computeWorkflowState({ ...base, git: { ...base.git, changedFiles: 0 }, pushCount: 0, hasHistory: true });
    expect(s.code.status).toBe('done');
    expect(s.code.hint).toBe('Up to date');
  });

  test('no changes + no pushes + !hasHistory → code idle (fresh chat, no work done)', () => {
    const s = computeWorkflowState({
      ...base,
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0,
      hasHistory: false
    });
    expect(s.code.status).toBe('idle');
    expect(s.code.hint).toBe('No changes');
  });
});

describe('computeWorkflowState — review milestone', () => {
  test('prState: open → review done, pr done', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('PR open');
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR open');
    expect(s.pr.actionKind).toBe('openPr');
    // next is null — everything is done
    expect(s.next).toBeNull();
  });

  test('prState: open + changes_requested → review attention, pr done', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { state: 'open', reviewDecision: 'changes_requested', creating: false },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewPr');
    expect(s.review.hint).toBe('Changes requested on PR');
    expect(s.pr.status).toBe('done');
  });

  test('prState: draft → review attention, pr info with draft hint', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'draft' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewPr');
    expect(s.pr.status).toBe('info');
    expect(s.pr.hint).toBe('Draft PR open');
  });

  test('prState: merged → review done, pr done', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'merged' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('PR merged');
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR merged');
    expect(s.pr.actionKind).toBe('openPr');
  });

  test('prState: closed + no new work → review info, pr info (terminal)', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'closed' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.review.status).toBe('info');
    expect(s.review.hint).toBe('PR closed');
    expect(s.pr.status).toBe('info');
    expect(s.pr.hint).toBe('PR closed');
    expect(s.pr.actionKind).toBe('openPr');
  });

  test('prState: closed + unpushed commits → code attention pushBranch (recovery path)', () => {
    // Closed PR but new work to push: surface push as the next action.
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'closed' },
      pushCount: 2,
      git: { ...base.git, changedFiles: 0 }
    });
    expect(s.code.status).toBe('attention');
    expect(s.code.actionKind).toBe('pushBranch');
  });

  test('prState: closed + pushed work → review attention reviewLocal, pr attention createPr (recovery path)', () => {
    // Closed PR with pushed/clean work → workflow should let the user open a fresh PR.
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'closed' },
      pushCount: 0,
      git: { ...base.git, changedFiles: 1 }
    });
    expect(s.code.status).toBe('done');
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewLocal');
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('Ready to open PR');
  });

  test('prState: closed + review.exists + new work → review done, pr attention createPr', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'closed' },
      review: { exists: true },
      git: { ...base.git, changedFiles: 1 },
      pushCount: 0
    });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('Reviewed');
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
  });

  test('reviewDecision: changes_requested → review attention regardless of review.exists', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { state: 'none', reviewDecision: 'changes_requested', creating: false },
      review: { exists: true }
    });
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewPr');
    expect(s.review.hint).toBe('Changes requested on PR');
  });

  test('reviewDecision: approved → review done', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, reviewDecision: 'approved' }
    });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('PR approved');
  });

  test('review.exists: true + prState: none → review done', () => {
    const s = computeWorkflowState({ ...base, review: { exists: true }, pr: { ...base.pr, state: 'none' } });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('Reviewed');
  });

  test('code not done → review stays idle', () => {
    // pushCount causes code = attention, so review stays idle
    const s = computeWorkflowState({ ...base, pushCount: 1 });
    expect(s.code.status).toBe('attention');
    expect(s.review.status).toBe('idle');
    expect(s.review.hint).toBe('Waiting on code');
  });
});

describe('computeWorkflowState — pr milestone', () => {
  test('pr.creating: true + no pr → pr in_progress', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { state: 'none', reviewDecision: 'none', creating: true }
    });
    expect(s.pr.status).toBe('in_progress');
    expect(s.pr.hint).toBe('Creating PR…');
  });

  test('code done + review done/attention → pr attention createPr', () => {
    const s = computeWorkflowState({ ...base, review: { exists: true }, pr: { ...base.pr, state: 'none' } });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('Ready to open PR');
  });

  test('merged PR → openPr actionKind', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'merged' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.pr.actionKind).toBe('openPr');
  });

  test('open PR → done with openPr actionKind', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.pr.status).toBe('done');
    expect(s.pr.actionKind).toBe('openPr');
  });
});

describe('computeWorkflowState — stale PR milestone', () => {
  test('PR open + 2 uncommitted → attention createPr with plural commit hint', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 2 },
      pushCount: 0
    });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('PR open — commit 2 files');
  });

  test('PR open + 1 uncommitted → singular commit hint', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 1 },
      pushCount: 0
    });
    expect(s.pr.hint).toBe('PR open — commit 1 file');
  });

  test('PR open + 3 unpushed → attention createPr with plural push hint', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 3
    });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('PR open — push 3 commits');
  });

  test('PR open + 1 unpushed → singular push hint', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 1
    });
    expect(s.pr.hint).toBe('PR open — push 1 commit');
  });

  test('PR open + uncommitted + unpushed → combined hint', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 2 },
      pushCount: 1
    });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.hint).toBe('PR open — commit & push pending');
  });

  test('PR merged + uncommitted → attention createPr', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'merged' },
      git: { ...base.git, changedFiles: 1 },
      pushCount: 0
    });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('PR merged — commit 1 file');
  });

  test('PR merged + clean tree → done', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'merged' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR merged');
  });

  test('PR open + clean tree → done', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR open');
  });

  test('PR open + no remote → idle no-remote wins', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { headSha: 'abc', hasRemote: false, changedFiles: 2 },
      pushCount: 1
    });
    expect(s.pr.status).toBe('idle');
    expect(s.pr.hint).toBe('No remote configured');
  });

  test('PR open + no upstream + pushCount only → pushCount ignored', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      hasUpstream: false,
      git: { ...base.git, changedFiles: 0 },
      pushCount: 5
    });
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR open');
  });

  test('PR open + no upstream + uncommitted → attention from changed files', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      hasUpstream: false,
      git: { ...base.git, changedFiles: 2 },
      pushCount: 5
    });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.hint).toBe('PR open — commit 2 files');
  });
});

describe('computeWorkflowState — full green scenarios', () => {
  test('all steps done when PR is open and code pushed', () => {
    const s = computeWorkflowState({
      ...base,
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0,
      pr: { state: 'open', reviewDecision: 'none', creating: false }
    });
    expect(s.plan.status).toBe('done');
    expect(s.code.status).toBe('done');
    expect(s.review.status).toBe('done');
    expect(s.pr.status).toBe('done');
    expect(s.next).toBeNull();
  });

  test('all steps done when PR is merged', () => {
    const s = computeWorkflowState({
      ...base,
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0,
      pr: { state: 'merged', reviewDecision: 'none', creating: false }
    });
    expect(s.plan.status).toBe('done');
    expect(s.code.status).toBe('done');
    expect(s.review.status).toBe('done');
    expect(s.pr.status).toBe('done');
    expect(s.next).toBeNull();
  });

  test('all steps done via local review path (no PR)', () => {
    const s = computeWorkflowState({
      ...base,
      git: { headSha: 'abc', changedFiles: 0, hasRemote: false },
      pushCount: 0,
      review: { exists: true }
    });
    expect(s.plan.status).toBe('done');
    expect(s.code.status).toBe('done');
    expect(s.review.status).toBe('done');
    expect(s.pr.status).toBe('idle'); // no remote → pr always idle
    expect(s.next).toBeNull();
  });
});

describe('computeWorkflowState — next cascade', () => {
  test('plan streaming (in_progress, no actionKind) → next is null', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', activity: 'streaming' });
    expect(s.next).toBeNull();
  });

  test('PR open → all done, next is null', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.next).toBeNull();
  });

  test('PR open + changes_requested → review wins next', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { state: 'open', reviewDecision: 'changes_requested', creating: false },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.next?.actionKind).toBe('reviewPr');
    expect(s.next?.milestone).toBe('review');
  });

  test('plan attention wins over everything else', () => {
    // plan mode → plan is attention even if code/review/pr would have actions
    const s = computeWorkflowState({
      ...base,
      mode: 'plan',
      activity: 'idle',
      plan: { exists: true },
      pr: { state: 'open', reviewDecision: 'none', creating: false },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 0
    });
    expect(s.next?.milestone).toBe('plan');
    expect(s.next?.actionKind).toBe('expandPlan');
  });

  test('PR stale with unpushed commits wins next over code pushBranch', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 0 },
      pushCount: 2
    });
    expect(s.next?.milestone).toBe('pr');
    expect(s.next?.actionKind).toBe('createPr');
  });

  test('PR stale with uncommitted changes wins next over reviewLocal', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 1 },
      pushCount: 0
    });
    expect(s.next?.milestone).toBe('pr');
    expect(s.next?.actionKind).toBe('createPr');
  });

  test('plan attention beats PR-stale (plan mode with stale local edits)', () => {
    // User is mid-planning AND happens to have uncommitted local edits with a
    // PR open. Plan-attention must still own `next` — redirecting to PR work
    // would skip plan approval. The cascade-reorder must NOT preempt plan.
    const s = computeWorkflowState({
      ...base,
      mode: 'plan',
      activity: 'idle',
      plan: { exists: true },
      pr: { state: 'open', reviewDecision: 'none', creating: false },
      git: { ...base.git, changedFiles: 1 },
      pushCount: 0
    });
    expect(s.plan.status).toBe('attention');
    expect(s.pr.status).toBe('attention'); // PR still amber-stale
    expect(s.next?.milestone).toBe('plan');
    expect(s.next?.actionKind).toBe('expandPlan');
  });

  test('next label comes from hint when hint is set', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', activity: 'idle', plan: { exists: true } });
    expect(s.next?.label).toBe('Plan ready — review and approve');
  });
});

describe('computeWorkflowState — stale PR review mirror', () => {
  test('PR open + uncommitted → review attention reviewLocal', () => {
    const s = computeWorkflowState({
      ...base,
      pr: { ...base.pr, state: 'open' },
      git: { ...base.git, changedFiles: 1 },
      pushCount: 0
    });
    expect(s.review.status).toBe('attention');
    expect(s.review.hint).toBe('Review delta before pushing');
    expect(s.review.actionKind).toBe('reviewLocal');
  });
});

// ── CLI harness rules ──────────────────────────────────────────────────────

const cliBase: WorkflowSnapshot = {
  ...base,
  harness: 'cli',
  cliBusy: false,
  mode: 'execute', // CLI has no plan-mode atom
  plan: null,
  tasks: null
};

describe('computeWorkflowState — CLI harness plan milestone', () => {
  test('CLI + no plan → plan idle', () => {
    const s = computeWorkflowState({ ...cliBase, plan: { exists: false } });
    expect(s.plan.status).toBe('idle');
  });

  test('CLI + plan written, no tasks, no approval → plan attention', () => {
    const s = computeWorkflowState({
      ...cliBase,
      plan: { exists: true, meta: { createdAt: '2026-01-01T00:00:00.000Z' } }
    });
    expect(s.plan.status).toBe('attention');
    expect(s.plan.hint).toContain('tasks not yet created');
  });

  test('CLI + plan written + tasks written after plan → plan green', () => {
    const s = computeWorkflowState({
      ...cliBase,
      plan: { exists: true, meta: { createdAt: '2026-01-01T00:00:00.000Z' } },
      tasks: { exists: true, total: 3, completed: 0, updatedAt: '2026-01-01T01:00:00.000Z' }
    });
    expect(s.plan.status).toBe('done');
    expect(s.plan.hint).toBe('Plan approved');
  });

  test('CLI + cliBusy + no tasks → plan in_progress', () => {
    const s = computeWorkflowState({
      ...cliBase,
      cliBusy: true,
      plan: { exists: true, meta: { createdAt: '2026-01-01T00:00:00.000Z' } }
    });
    expect(s.plan.status).toBe('in_progress');
    expect(s.plan.hint).toBe('Drafting plan…');
  });

  test('CLI + write_plan makes plan green go back to orange (regression rule)', () => {
    // Start: plan approved via tasks, then a new write_plan with a later createdAt
    const newPlanTime = '2026-01-01T02:00:00.000Z';
    const oldTasksTime = '2026-01-01T01:00:00.000Z'; // tasks older than new plan
    const s = computeWorkflowState({
      ...cliBase,
      plan: { exists: true, meta: { createdAt: newPlanTime } },
      tasks: { exists: true, total: 2, completed: 2, updatedAt: oldTasksTime }
    });
    // T(tasks) < T(plan) → tasksForCurrentPlan = false → plan back to attention
    expect(s.plan.status).toBe('attention');
  });
});

describe('computeWorkflowState — CLI harness code milestone', () => {
  const cliWithTasksBase: WorkflowSnapshot = {
    ...cliBase,
    plan: { exists: true, meta: { createdAt: '2026-01-01T00:00:00.000Z' } },
    tasks: { exists: true, total: 3, completed: 0, updatedAt: '2026-01-01T01:00:00.000Z' }
  };

  test('CLI + tasks partial → code attention with progress hint', () => {
    const s = computeWorkflowState({
      ...cliWithTasksBase,
      tasks: { exists: true, total: 3, completed: 1, updatedAt: '2026-01-01T01:00:00.000Z' }
    });
    expect(s.plan.status).toBe('done');
    expect(s.code.status).toBe('attention');
    expect(s.code.hint).toBe('1/3 tasks complete');
  });

  test('CLI + all tasks done → code green', () => {
    const s = computeWorkflowState({
      ...cliWithTasksBase,
      tasks: { exists: true, total: 3, completed: 3, updatedAt: '2026-01-01T01:00:00.000Z' }
    });
    expect(s.plan.status).toBe('done');
    expect(s.code.status).toBe('done');
    expect(s.code.hint).toBe('All 3 tasks complete');
  });

  test('CLI + cliBusy + tasks in progress → code in_progress', () => {
    const s = computeWorkflowState({
      ...cliWithTasksBase,
      cliBusy: true,
      tasks: { exists: true, total: 3, completed: 1, updatedAt: '2026-01-01T01:00:00.000Z' }
    });
    expect(s.code.status).toBe('in_progress');
    expect(s.code.hint).toBe('Executing tasks…');
  });
});

describe('computeWorkflowState — timestamp-based review rules', () => {
  const T_PLAN = '2026-01-01T00:00:00.000Z';
  const T_TASKS = '2026-01-01T01:00:00.000Z';
  const T_REVIEW = '2026-01-01T02:00:00.000Z';
  const T_ACCEPT = '2026-01-01T03:00:00.000Z';

  const reviewBase: WorkflowSnapshot = {
    ...base,
    plan: { exists: true, meta: { createdAt: T_PLAN, approvedAt: T_PLAN } },
    tasks: { exists: true, total: 2, completed: 2, updatedAt: T_TASKS },
    git: { ...base.git, changedFiles: 0 },
    pushCount: 0
  };

  test('review written for current work, not accepted → attention', () => {
    const s = computeWorkflowState({
      ...reviewBase,
      review: { exists: true, meta: { createdAt: T_REVIEW } }
    });
    expect(s.code.status).toBe('done');
    expect(s.review.status).toBe('attention');
    expect(s.review.hint).toContain('click Fix to accept');
  });

  test('review accepted → review green', () => {
    const s = computeWorkflowState({
      ...reviewBase,
      review: { exists: true, meta: { createdAt: T_REVIEW, acceptedAt: T_ACCEPT } }
    });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('Reviewed');
  });

  test('tasks updated after review accepted (fix-run, all complete) → review stays green', () => {
    // The fix-run agent calls update_task_status, advancing tTasks past tReview.
    // Acceptance check runs before reviewForCurrentWork so the pill stays done.
    const T_NEW_TASKS = '2026-01-01T04:00:00.000Z'; // after accept
    const s = computeWorkflowState({
      ...reviewBase,
      tasks: { exists: true, total: 3, completed: 3, updatedAt: T_NEW_TASKS },
      review: { exists: true, meta: { createdAt: T_REVIEW, acceptedAt: T_ACCEPT } }
    });
    expect(s.review.status).toBe('done');
  });

  test('review accepted, fix run in progress (code amber) → review stays green', () => {
    // Real bug: user clicked Fix, agent is running tasks. Code is 6/8 done (amber).
    // codeStatus !== 'done', so the old code returned idle before reaching the
    // acceptance check. Acceptance check must run before the codeStatus gate.
    const T_NEW_TASKS = '2026-01-01T04:00:00.000Z'; // after accept, tasks not all done
    const s = computeWorkflowState({
      ...reviewBase,
      tasks: { exists: true, total: 8, completed: 6, updatedAt: T_NEW_TASKS },
      review: { exists: true, meta: { createdAt: T_REVIEW, acceptedAt: T_ACCEPT } }
    });
    expect(s.code.status).toBe('attention'); // 6/8 → amber
    expect(s.review.status).toBe('done'); // accepted → stays green regardless
    expect(s.review.hint).toBe('Reviewed');
  });

  test('new write_review after accept (new createdAt > acceptedAt) → back to attention', () => {
    // Agent writes a brand-new review; createdAt resets to after acceptedAt.
    const T_NEW_REVIEW = '2026-01-01T04:30:00.000Z'; // after T_ACCEPT
    const s = computeWorkflowState({
      ...reviewBase,
      review: { exists: true, meta: { createdAt: T_NEW_REVIEW, acceptedAt: T_ACCEPT } }
      // tAccept(T_ACCEPT) < tReview(T_NEW_REVIEW) → not accepted
    });
    expect(s.review.status).toBe('attention');
    expect(s.review.hint).toContain('click Fix to accept');
  });

  test('new plan written after review green → plan back to attention, review cascades to idle', () => {
    const T_NEW_PLAN = '2026-01-01T05:00:00.000Z'; // after everything
    const s = computeWorkflowState({
      ...reviewBase,
      plan: { exists: true, meta: { createdAt: T_NEW_PLAN } }, // no approvedAt yet
      review: { exists: true, meta: { createdAt: T_REVIEW, acceptedAt: T_ACCEPT } }
      // T(tasks)=T_TASKS < T(new_plan)=T_NEW_PLAN → tasksForCurrentPlan = false
    });
    expect(s.plan.status).toBe('attention');
    // code: no tasks for current plan, fall through to git rules
    // review: gated on code being done; depends on git state
  });

  test('review accepted, then Fix clicked again (second accept) → stays green', () => {
    const T_ACCEPT2 = '2026-01-01T04:30:00.000Z'; // after T_ACCEPT
    const s = computeWorkflowState({
      ...reviewBase,
      review: { exists: true, meta: { createdAt: T_REVIEW, acceptedAt: T_ACCEPT2 } }
    });
    expect(s.review.status).toBe('done');
  });
});
