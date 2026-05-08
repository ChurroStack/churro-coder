// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentTurnRecap } from './agent-turn-recap';

describe('AgentTurnRecap', () => {
  test('shows model and effort in the collapsed recap header', () => {
    render(
      <AgentTurnRecap
        metadata={{
          model: 'gpt-5.4',
          thinking: 'high',
          totalTokens: 1200,
          durationMs: 9_500,
          resultSubtype: 'success'
        }}
      />
    );

    expect(screen.getByText('GPT-5.4')).toBeTruthy();
    expect(screen.getByText(/High/)).toBeTruthy();
  });

  test('shows effort in the expanded details grid', () => {
    render(
      <AgentTurnRecap
        metadata={{
          model: 'sonnet',
          thinking: 'max',
          totalTokens: 800,
          durationMs: 5_000,
          resultSubtype: 'success'
        }}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Effort')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
  });
});
