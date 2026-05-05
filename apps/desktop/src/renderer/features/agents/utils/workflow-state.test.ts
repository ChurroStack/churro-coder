import { describe, test, expect } from 'vitest';
import { computeWorkflowState } from './workflow-state';
import type { WorkflowInputs } from './workflow-state';

// Base represents an active agent session: plan approved, AI has responded,
// files changed (but not yet committed+pushed), upstream configured.
const base: WorkflowInputs = {
  mode: 'agent',
  isStreaming: false,
  isCompacting: false,
  planEverGenerated: true,
  hasAiResponded: true,
  changedFilesCount: 1,
  pushCount: 0,
  hasUpstream: true,
  hasRemote: true,
  baseBranchBehind: 0,
  prState: 'none',
  reviewDecision: 'none',
  localReviewCompleted: false,
  prCreating: false
};

describe('computeWorkflowState — plan milestone', () => {
  test('plan mode + streaming → in_progress, others idle, next null', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', isStreaming: true });
    expect(s.plan.status).toBe('in_progress');
    expect(s.plan.hint).toBe('Drafting plan…');
    expect(s.code.status).toBe('idle');
    expect(s.review.status).toBe('idle');
    expect(s.pr.status).toBe('idle');
    expect(s.next).toBeNull();
  });

  test('plan mode + idle + AI responded → attention with expandPlan, code blocked', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', isStreaming: false, hasAiResponded: true });
    expect(s.plan.status).toBe('attention');
    expect(s.plan.actionKind).toBe('expandPlan');
    expect(s.next?.actionKind).toBe('expandPlan');
    expect(s.next?.milestone).toBe('plan');
    expect(s.code.status).toBe('idle');
    expect(s.code.hint).toBe('Waiting on plan');
  });

  test('plan mode + idle + no AI response yet → idle (blank new chat, all idle)', () => {
    // A truly blank new chat: plan mode, no AI response, no plan ever generated,
    // no files changed, no commits to push.
    const s = computeWorkflowState({
      ...base,
      mode: 'plan',
      isStreaming: false,
      hasAiResponded: false,
      planEverGenerated: false,
      changedFilesCount: 0,
      pushCount: 0
    });
    expect(s.plan.status).toBe('idle');
    expect(s.plan.hint).toBe('Start chatting to begin');
    expect(s.code.status).toBe('idle');
    expect(s.code.hint).toBe('No changes');
    expect(s.review.status).toBe('idle');
    expect(s.pr.status).toBe('idle');
    expect(s.next).toBeNull();
  });

  test('agent mode + planEverGenerated → plan done', () => {
    const s = computeWorkflowState({ ...base, planEverGenerated: true });
    expect(s.plan.status).toBe('done');
    expect(s.plan.hint).toBe('Plan approved');
  });

  test('agent mode + !planEverGenerated → plan idle (skipped)', () => {
    const s = computeWorkflowState({ ...base, planEverGenerated: false });
    expect(s.plan.status).toBe('idle');
    expect(s.plan.hint).toContain('Skipped');
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

  test("hasRemote: false → code done ('Changes ready (no remote)'), pr idle ('No remote configured')", () => {
    const s = computeWorkflowState({ ...base, hasRemote: false });
    expect(s.code.status).toBe('done');
    expect(s.code.hint).toBe('Changes ready (no remote)');
    expect(s.pr.status).toBe('idle');
    expect(s.pr.hint).toBe('No remote configured');
  });

  test('hasRemote: true + hasUpstream: false → code attention pushBranch', () => {
    const s = computeWorkflowState({ ...base, hasRemote: true, hasUpstream: false });
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

  test('streaming in agent mode (not compacting) → code in_progress', () => {
    const s = computeWorkflowState({ ...base, isStreaming: true, isCompacting: false });
    expect(s.code.status).toBe('in_progress');
    expect(s.code.hint).toBe('Agent is editing…');
  });

  test('streaming while compacting → code not in_progress (compacting is excluded)', () => {
    const s = computeWorkflowState({ ...base, isStreaming: true, isCompacting: true });
    expect(s.code.status).not.toBe('in_progress');
  });

  test('no changes + no pushes + hasAiResponded → code done (clean tree after AI work)', () => {
    const s = computeWorkflowState({ ...base, changedFilesCount: 0, pushCount: 0, hasAiResponded: true });
    expect(s.code.status).toBe('done');
    expect(s.code.hint).toBe('Up to date');
  });

  test('no changes + no pushes + !hasAiResponded → code idle (fresh chat, no work done)', () => {
    const s = computeWorkflowState({ ...base, changedFilesCount: 0, pushCount: 0, hasAiResponded: false });
    expect(s.code.status).toBe('idle');
    expect(s.code.hint).toBe('No changes');
  });
});

describe('computeWorkflowState — review milestone', () => {
  test('prState: open → review done, pr done', () => {
    const s = computeWorkflowState({ ...base, prState: 'open' });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('PR open');
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR open');
    expect(s.pr.actionKind).toBe('openPr');
    // next is null — everything is done
    expect(s.next).toBeNull();
  });

  test('prState: open + changes_requested → review attention, pr done', () => {
    const s = computeWorkflowState({ ...base, prState: 'open', reviewDecision: 'changes_requested' });
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewPr');
    expect(s.review.hint).toBe('Changes requested on PR');
    expect(s.pr.status).toBe('done');
  });

  test('prState: draft → review attention, pr info with draft hint', () => {
    const s = computeWorkflowState({ ...base, prState: 'draft' });
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewPr');
    expect(s.pr.status).toBe('info');
    expect(s.pr.hint).toBe('Draft PR open');
  });

  test('prState: merged → review done, pr done', () => {
    const s = computeWorkflowState({ ...base, prState: 'merged' });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('PR merged');
    expect(s.pr.status).toBe('done');
    expect(s.pr.hint).toBe('PR merged');
    expect(s.pr.actionKind).toBe('openPr');
  });

  test('prState: closed + no new work → review info, pr info (terminal)', () => {
    const s = computeWorkflowState({ ...base, prState: 'closed', changedFilesCount: 0, pushCount: 0 });
    expect(s.review.status).toBe('info');
    expect(s.review.hint).toBe('PR closed');
    expect(s.pr.status).toBe('info');
    expect(s.pr.hint).toBe('PR closed');
    expect(s.pr.actionKind).toBe('openPr');
  });

  test('prState: closed + unpushed commits → code attention pushBranch (recovery path)', () => {
    // Closed PR but new work to push: surface push as the next action.
    const s = computeWorkflowState({ ...base, prState: 'closed', pushCount: 2, changedFilesCount: 0 });
    expect(s.code.status).toBe('attention');
    expect(s.code.actionKind).toBe('pushBranch');
  });

  test('prState: closed + pushed work → review attention reviewLocal, pr attention createPr (recovery path)', () => {
    // Closed PR with pushed/clean work → workflow should let the user open a fresh PR.
    const s = computeWorkflowState({ ...base, prState: 'closed', pushCount: 0, changedFilesCount: 1 });
    expect(s.code.status).toBe('done');
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewLocal');
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('Ready to open PR');
  });

  test('prState: closed + localReviewCompleted + new work → review done, pr attention createPr', () => {
    const s = computeWorkflowState({
      ...base,
      prState: 'closed',
      localReviewCompleted: true,
      changedFilesCount: 1,
      pushCount: 0
    });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('Reviewed');
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
  });

  test('reviewDecision: changes_requested → review attention regardless of localReviewCompleted', () => {
    const s = computeWorkflowState({
      ...base,
      reviewDecision: 'changes_requested',
      localReviewCompleted: true,
      prState: 'none'
    });
    expect(s.review.status).toBe('attention');
    expect(s.review.actionKind).toBe('reviewPr');
    expect(s.review.hint).toBe('Changes requested on PR');
  });

  test('reviewDecision: approved → review done', () => {
    const s = computeWorkflowState({ ...base, reviewDecision: 'approved' });
    expect(s.review.status).toBe('done');
    expect(s.review.hint).toBe('PR approved');
  });

  test('localReviewCompleted: true + prState: none → review done', () => {
    const s = computeWorkflowState({ ...base, localReviewCompleted: true, prState: 'none' });
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
  test('prCreating: true + no pr → pr in_progress', () => {
    const s = computeWorkflowState({ ...base, prCreating: true, prState: 'none' });
    expect(s.pr.status).toBe('in_progress');
    expect(s.pr.hint).toBe('Creating PR…');
  });

  test('code done + review done/attention → pr attention createPr', () => {
    const s = computeWorkflowState({ ...base, localReviewCompleted: true, prState: 'none' });
    expect(s.pr.status).toBe('attention');
    expect(s.pr.actionKind).toBe('createPr');
    expect(s.pr.hint).toBe('Ready to open PR');
  });

  test('merged PR → openPr actionKind', () => {
    const s = computeWorkflowState({ ...base, prState: 'merged' });
    expect(s.pr.actionKind).toBe('openPr');
  });

  test('open PR → done with openPr actionKind', () => {
    const s = computeWorkflowState({ ...base, prState: 'open' });
    expect(s.pr.status).toBe('done');
    expect(s.pr.actionKind).toBe('openPr');
  });
});

describe('computeWorkflowState — full green scenarios', () => {
  test('all steps done when PR is open and code pushed', () => {
    const s = computeWorkflowState({
      ...base,
      changedFilesCount: 0,
      pushCount: 0,
      prState: 'open',
      reviewDecision: 'none'
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
      changedFilesCount: 0,
      pushCount: 0,
      prState: 'merged'
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
      changedFilesCount: 0,
      pushCount: 0,
      hasRemote: false,
      localReviewCompleted: true
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
    const s = computeWorkflowState({ ...base, mode: 'plan', isStreaming: true });
    expect(s.next).toBeNull();
  });

  test('PR open → all done, next is null', () => {
    const s = computeWorkflowState({ ...base, prState: 'open' });
    expect(s.next).toBeNull();
  });

  test('PR open + changes_requested → review wins next', () => {
    const s = computeWorkflowState({ ...base, prState: 'open', reviewDecision: 'changes_requested' });
    expect(s.next?.actionKind).toBe('reviewPr');
    expect(s.next?.milestone).toBe('review');
  });

  test('plan attention wins over everything else', () => {
    // plan mode → plan is attention even if code/review/pr would have actions
    const s = computeWorkflowState({
      ...base,
      mode: 'plan',
      isStreaming: false,
      hasAiResponded: true,
      prState: 'open'
    });
    expect(s.next?.milestone).toBe('plan');
    expect(s.next?.actionKind).toBe('expandPlan');
  });

  test('next label comes from hint when hint is set', () => {
    const s = computeWorkflowState({ ...base, mode: 'plan', isStreaming: false, hasAiResponded: true });
    expect(s.next?.label).toBe('Plan ready — review and approve');
  });
});
