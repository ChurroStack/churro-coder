// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { deriveWorkspaceStatus } from './group-chats-by-project';

const base = {
  isLoading: false,
  hasPendingQuestion: false,
  hasPendingPlan: false,
  hasUnseenChanges: false
};

describe('deriveWorkspaceStatus', () => {
  it('returns none when nothing is active', () => {
    expect(deriveWorkspaceStatus(base)).toBe('none');
  });

  it('ranks loader above a simultaneous pending question (busy beats stale question)', () => {
    // Regression guard: a busy workspace that still carries a pending/expired
    // question must resolve to 'loading', matching the workspace-row badge.
    expect(deriveWorkspaceStatus({ ...base, isLoading: true, hasPendingQuestion: true })).toBe('loading');
  });

  it('shows loader when only busy', () => {
    expect(deriveWorkspaceStatus({ ...base, isLoading: true })).toBe('loading');
  });

  it('shows question when waiting and not busy', () => {
    expect(deriveWorkspaceStatus({ ...base, hasPendingQuestion: true })).toBe('pendingQuestion');
  });

  it('ranks question above pending plan and unseen', () => {
    expect(
      deriveWorkspaceStatus({ ...base, hasPendingQuestion: true, hasPendingPlan: true, hasUnseenChanges: true })
    ).toBe('pendingQuestion');
  });

  it('shows pending plan above unseen', () => {
    expect(deriveWorkspaceStatus({ ...base, hasPendingPlan: true, hasUnseenChanges: true })).toBe('pendingPlan');
  });

  it('shows unseen when only unseen changes', () => {
    expect(deriveWorkspaceStatus({ ...base, hasUnseenChanges: true })).toBe('unseen');
  });

  it('keeps loader on top even when every signal is set', () => {
    expect(
      deriveWorkspaceStatus({
        isLoading: true,
        hasPendingQuestion: true,
        hasPendingPlan: true,
        hasUnseenChanges: true
      })
    ).toBe('loading');
  });
});
