import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pendingCliQuestions,
  registerPendingCliQuestion,
  getPendingForSubChat,
  supersedeForSubChat,
  rejectAllForSubChat,
  emitCliUserQuestionExpired,
  onCliUserQuestionExpired,
  onCliUserQuestionCleared,
  type CliUserQuestionEntry
} from './pending-cli-questions';

const QUESTIONS: CliUserQuestionEntry[] = [
  {
    question: 'Pick one',
    header: 'Q',
    options: [
      { label: 'A', description: '' },
      { label: 'B', description: '' }
    ],
    multiSelect: false
  }
];

function register(requestId: string, subChatId: string) {
  const resolve = vi.fn();
  const reject = vi.fn();
  registerPendingCliQuestion(requestId, { subChatId, questions: QUESTIONS, resolve, reject });
  return { resolve, reject };
}

describe('pending-cli-questions', () => {
  beforeEach(() => {
    pendingCliQuestions.clear();
  });

  it('getPendingForSubChat returns the outstanding question (with requestId + questions) or null', () => {
    expect(getPendingForSubChat('sub-1')).toBeNull();
    register('req-1', 'sub-1');
    expect(getPendingForSubChat('sub-1')).toEqual({ requestId: 'req-1', subChatId: 'sub-1', questions: QUESTIONS });
    expect(getPendingForSubChat('other')).toBeNull();
  });

  it('getPendingForSubChat returns the most recently registered question', () => {
    register('req-1', 'sub-1');
    register('req-2', 'sub-1');
    expect(getPendingForSubChat('sub-1')?.requestId).toBe('req-2');
  });

  it('supersedeForSubChat rejects + clears older entries, keeping the exception, and emits a cleared event', () => {
    const cleared = vi.fn();
    const unsub = onCliUserQuestionCleared(cleared);
    const first = register('req-1', 'sub-1');
    register('req-2', 'sub-1');

    supersedeForSubChat('sub-1', 'req-2', 'superseded');

    expect(first.reject).toHaveBeenCalledOnce();
    expect(pendingCliQuestions.has('req-1')).toBe(false);
    expect(pendingCliQuestions.has('req-2')).toBe(true);
    expect(cleared).toHaveBeenCalledWith({ requestId: 'req-1', subChatId: 'sub-1' });
    unsub();
  });

  it('rejectAllForSubChat rejects all entries and emits cleared (NOT expired) — teardown removes the widget', () => {
    const cleared = vi.fn();
    const expired = vi.fn();
    const unsubC = onCliUserQuestionCleared(cleared);
    const unsubE = onCliUserQuestionExpired(expired);
    const a = register('req-1', 'sub-1');
    const b = register('req-2', 'sub-1');
    register('req-3', 'sub-2');

    rejectAllForSubChat('sub-1', 'sub-chat-closed');

    expect(a.reject).toHaveBeenCalledOnce();
    expect(b.reject).toHaveBeenCalledOnce();
    expect(pendingCliQuestions.has('req-1')).toBe(false);
    expect(pendingCliQuestions.has('req-2')).toBe(false);
    expect(pendingCliQuestions.has('req-3')).toBe(true); // other sub-chat untouched
    expect(cleared).toHaveBeenCalledTimes(2);
    expect(expired).not.toHaveBeenCalled();
    unsubC();
    unsubE();
  });

  it('expired event carries the requestId so a stale expiry can be distinguished from a fresh question', () => {
    const expired = vi.fn();
    const unsub = onCliUserQuestionExpired(expired);
    emitCliUserQuestionExpired({ requestId: 'req-1', subChatId: 'sub-1' });
    expect(expired).toHaveBeenCalledWith({ requestId: 'req-1', subChatId: 'sub-1' });
    unsub();
  });
});
