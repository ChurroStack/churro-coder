// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AgentUserQuestion } from './agent-user-question';
import type { PendingUserQuestion } from '../atoms';

afterEach(cleanup);

const QUESTION: PendingUserQuestion = {
  subChatId: 'sub-1',
  parentChatId: 'chat-1',
  toolUseId: 'req-1',
  source: 'cli',
  requestId: 'req-1',
  questions: [
    {
      question: 'Which approach?',
      header: 'Approach',
      multiSelect: false,
      options: [
        { label: 'Option A', description: 'first' },
        { label: 'Option B', description: 'second' }
      ]
    }
  ]
};

describe('AgentUserQuestion', () => {
  it('live: lets the user pick an option and submit', () => {
    const onAnswer = vi.fn();
    render(<AgentUserQuestion pendingQuestions={QUESTION} onAnswer={onAnswer} onSkip={vi.fn()} />);

    expect(screen.queryByText('Expired — the agent may ask again.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onAnswer).toHaveBeenCalledWith({ 'Which approach?': 'Option A' });
  });

  it('expired: shows the disabled banner, no Submit, options disabled, and Dismiss calls onSkip', () => {
    const onAnswer = vi.fn();
    const onSkip = vi.fn();
    render(<AgentUserQuestion pendingQuestions={QUESTION} onAnswer={onAnswer} onSkip={onSkip} expired />);

    // Honest expired affordance.
    expect(screen.getByText('Expired — the agent may ask again.')).toBeTruthy();
    // No way to submit an expired question.
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();

    // Options are disabled — clicking does not produce an answer.
    const optionA = screen.getByRole('button', { name: /Option A/ }) as HTMLButtonElement;
    expect(optionA.disabled).toBe(true);
    fireEvent.click(optionA);
    expect(onAnswer).not.toHaveBeenCalled();

    // Skip All becomes Dismiss and just hands off to the parent.
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});
