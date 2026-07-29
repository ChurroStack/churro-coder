// @vitest-environment jsdom

import { describe, expect, test } from 'vitest';
import { resolveReviewContext } from './use-review-action';

describe('resolveReviewContext', () => {
  test('waits until the chat and authoritative branch query have resolved', () => {
    expect(resolveReviewContext(undefined, undefined)).toBeNull();
    expect(
      resolveReviewContext(
        {
          worktreePath: '/repo',
          branch: 'stale-chat-branch',
          baseBranch: null
        },
        undefined
      )
    ).toBeNull();
  });

  test('uses the checked-out branch and repository default branch', () => {
    expect(
      resolveReviewContext(
        {
          worktreePath: '/repo',
          branch: 'stale-chat-branch',
          baseBranch: null
        },
        {
          current: 'feature/live-branch',
          defaultBranch: 'trunk'
        }
      )
    ).toEqual({
      branch: 'feature/live-branch',
      baseBranch: 'trunk',
      uncommittedCount: 0,
      hasUpstream: false
    });
  });

  test('preserves an explicitly selected base branch', () => {
    expect(
      resolveReviewContext(
        {
          worktreePath: '/repo',
          branch: 'feature/chat-branch',
          baseBranch: 'release'
        },
        {
          current: '',
          defaultBranch: 'trunk'
        }
      )
    ).toMatchObject({
      branch: 'feature/chat-branch',
      baseBranch: 'release'
    });
  });
});
