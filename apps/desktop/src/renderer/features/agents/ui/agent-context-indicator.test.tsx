// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { AgentContextIndicator, progressColorClass } from './agent-context-indicator';

afterEach(cleanup);

function renderIndicator(props: Partial<React.ComponentProps<typeof AgentContextIndicator>> = {}) {
  const result = render(
    <TooltipProvider>
      <AgentContextIndicator
        tokenData={{
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          messageCount: 0,
          contextWindow: undefined
        }}
        {...props}
      />
    </TooltipProvider>
  );
  const trigger = result.container.querySelector('div.h-4.w-4');
  return { ...result, trigger };
}

describe('progressColorClass', () => {
  // Boundary cases protect against off-by-one regressions in the threshold ladder.
  it.each([
    { percent: 0, expected: 'text-muted-foreground/60' },
    { percent: 0.0001, expected: 'text-green-500' },
    { percent: 40, expected: 'text-green-500' },
    { percent: 40.0001, expected: 'text-yellow-500' },
    { percent: 60, expected: 'text-yellow-500' },
    { percent: 60.0001, expected: 'text-orange-500' },
    { percent: 80, expected: 'text-orange-500' },
    { percent: 80.0001, expected: 'text-red-500' },
    { percent: 100, expected: 'text-red-500' },
    { percent: -5, expected: 'text-muted-foreground/60' }
  ])('returns $expected at $percent%', ({ percent, expected }) => {
    expect(progressColorClass(percent)).toBe(expected);
  });
});

describe('AgentContextIndicator', () => {
  it('dims when disabled and pulses while compacting', () => {
    const { container } = renderIndicator({ disabled: true, isCompacting: true });
    expect(container.querySelector('.opacity-50')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('calls onCompact once when clickable', () => {
    const onCompact = vi.fn();
    const { container } = renderIndicator({ onCompact });
    const trigger = container.querySelector('div.h-4.w-4');
    expect(trigger).not.toBeNull();
    if (trigger) fireEvent.click(trigger);
    expect(onCompact).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onCompact when disabled', () => {
    const onCompact = vi.fn();
    const { container } = renderIndicator({ onCompact, disabled: true });
    const trigger = container.querySelector('div.h-4.w-4');
    if (trigger) fireEvent.click(trigger);
    expect(onCompact).not.toHaveBeenCalled();
  });
});
