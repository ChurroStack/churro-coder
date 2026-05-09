import { describe, test, expect } from 'vitest';
// Test via the re-export shim to confirm it still works for external consumers
import { isSubChatNeedingInput } from './derive-status';

describe('isSubChatNeedingInput (shim)', () => {
  test('pending question → true', () => {
    expect(
      isSubChatNeedingInput('sub-1', {
        subChatsWithPendingQuestions: new Set(['sub-1']),
        subChatsWithPendingPlanApprovals: new Set()
      })
    ).toBe(true);
  });

  test('pending plan approval → true', () => {
    expect(
      isSubChatNeedingInput('sub-1', {
        subChatsWithPendingQuestions: new Set(),
        subChatsWithPendingPlanApprovals: new Set(['sub-1'])
      })
    ).toBe(true);
  });

  test('neither pending → false', () => {
    expect(
      isSubChatNeedingInput('sub-1', {
        subChatsWithPendingQuestions: new Set(),
        subChatsWithPendingPlanApprovals: new Set()
      })
    ).toBe(false);
  });
});
