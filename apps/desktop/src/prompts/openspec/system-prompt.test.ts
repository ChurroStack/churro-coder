import { describe, expect, test } from 'vitest';
import { renderBuiltinPrompt } from '../render';

describe('openspec/system.j2', () => {
  const rendered = renderBuiltinPrompt('openspec/system', {
    projectName: 'checkout-app',
    changeId: 'add-payment-flow',
    changePath: 'openspec/changes/add-payment-flow'
  });

  test('renders project and change context', () => {
    expect(rendered).toContain('checkout-app');
    expect(rendered).toContain('add-payment-flow');
    expect(rendered).toContain('openspec/changes/add-payment-flow');
    expect(rendered).not.toContain('{{');
  });

  test('contains the write-scope and apply override contract', () => {
    expect(rendered).toContain('Unless the current user turn is an explicit `/opsx:apply` request');
    expect(rendered).toContain('Do not create or modify non-OpenSpec code/files');
    expect(rendered).toContain('keep all writes scoped to the current change');
  });

  test('contains cascade and completed-task preservation rules', () => {
    expect(rendered).toContain('do not silently regenerate everything');
    expect(rendered).toContain('preserve existing completed task markers');
    expect(rendered).toContain('- [x]');
  });

  test('throws when required vars are missing', () => {
    expect(() => renderBuiltinPrompt('openspec/system')).toThrow();
  });
});
