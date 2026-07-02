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

const MULTI_QUESTION: PendingUserQuestion = {
  subChatId: 'sub-2',
  parentChatId: 'chat-2',
  toolUseId: 'req-2',
  source: 'cli',
  requestId: 'req-2',
  questions: [
    {
      question: 'Which harnesses?',
      header: 'Harness',
      multiSelect: true,
      options: [
        { label: 'claude', description: 'Claude CLI' },
        { label: 'codex', description: 'Codex CLI' }
      ]
    }
  ]
};

const OTHER_QUESTION: PendingUserQuestion = {
  subChatId: 'sub-3',
  parentChatId: 'chat-3',
  toolUseId: 'req-3',
  source: 'cli',
  requestId: 'req-3',
  questions: [
    {
      question: 'Which color?',
      header: 'Color',
      multiSelect: false,
      options: [
        { label: 'Red', description: 'Pick red.' },
        { label: 'Other', description: 'Something else.' }
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

  it('free-text: single-select renders a "Type anything" row whose typed value submits', () => {
    const onAnswer = vi.fn();
    render(<AgentUserQuestion pendingQuestions={QUESTION} onAnswer={onAnswer} onSkip={vi.fn()} />);

    expect(screen.getByText('Type anything')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: /type your answer/i });
    fireEvent.change(input, { target: { value: 'aider' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onAnswer).toHaveBeenCalledWith({ 'Which approach?': 'aider' });
  });

  it('free-text: multi-select composes a picked option with the typed value', () => {
    const onAnswer = vi.fn();
    render(<AgentUserQuestion pendingQuestions={MULTI_QUESTION} onAnswer={onAnswer} onSkip={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /claude/ }));
    const input = screen.getByRole('textbox', { name: /type your answer/i });
    fireEvent.change(input, { target: { value: 'aider' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onAnswer).toHaveBeenCalledWith({ 'Which harnesses?': 'claude, aider' });
  });

  it('free-text: dedupes against an assistant-supplied "Other" option instead of adding a second row', () => {
    render(<AgentUserQuestion pendingQuestions={OTHER_QUESTION} onAnswer={vi.fn()} onSkip={vi.fn()} />);

    // Exactly one free-text affordance — the existing "Other" row is upgraded in
    // place, not duplicated alongside a synthetic "Type anything" row.
    expect(screen.getAllByRole('textbox', { name: /type your answer/i })).toHaveLength(1);
    expect(screen.queryByText('Type anything')).toBeNull();
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('free-text: Submit stays disabled while the row is selected but empty', () => {
    const onAnswer = vi.fn();
    render(<AgentUserQuestion pendingQuestions={QUESTION} onAnswer={onAnswer} onSkip={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: /type your answer/i });
    fireEvent.focus(input);

    expect((screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(onAnswer).not.toHaveBeenCalled();
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
