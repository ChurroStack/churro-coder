import { describe, expect, test } from 'vitest';
import { vi } from 'vitest';

import { sanitizeCodexPlanSummary } from './codex-plan-write';

describe('sanitizeCodexPlanSummary', () => {
  test('drops PlanWrite protocol text instead of persisting it as the plan summary', () => {
    expect(
      sanitizeCodexPlanSummary(
        'PlanWrite action=create; plan.status=awaiting_approval; title=Image Rendering Size Controls; summary=Add render-only sizing controls.'
      )
    ).toBe('');
  });

  test('drops generic tool protocol prefixes from fallback assistant text', () => {
    expect(sanitizeCodexPlanSummary('Tool: PlanWrite action=create summary=foo')).toBe('');
    expect(sanitizeCodexPlanSummary('PlanWrite action=create\nsummary=foo')).toBe('');
  });

  test('preserves ordinary summaries', () => {
    expect(sanitizeCodexPlanSummary('Add render-only image sizing controls to the editor.')).toBe(
      'Add render-only image sizing controls to the editor.'
    );
  });

  test('preserves normal summaries that merely start with the word PlanWrite', () => {
    expect(sanitizeCodexPlanSummary('PlanWrite is the internal tool name for this workflow.')).toBe(
      'PlanWrite is the internal tool name for this workflow.'
    );
  });

  test('warns when protocol-shaped summary text is discarded', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(sanitizeCodexPlanSummary('PlanWrite action=create summary=foo')).toBe('');
    expect(warnSpy).toHaveBeenCalledWith('[codex] Dropping protocol-shaped plan summary text before persistence');

    warnSpy.mockRestore();
  });
});
