import { describe, it, expect } from 'vitest';
import { deriveWizardState } from './wizard-state';
import type { WizardInput } from './wizard-state';

const base: WizardInput = {
  agentMode: 'plan',
  selectedSpecId: null,
  hasProject: true
};

describe('deriveWizardState', () => {
  it('canSubmit follows hasProject', () => {
    expect(deriveWizardState({ ...base, hasProject: false }).canSubmit).toBe(false);
    expect(deriveWizardState({ ...base, hasProject: true }).canSubmit).toBe(true);
  });

  it('uses spec-aware placeholder when a spec is selected', () => {
    const result = deriveWizardState({ ...base, selectedSpecId: 'change-abc' });
    expect(result.promptPlaceholder).toMatch(/this change/i);
  });

  it('explore mode uses an ask-a-question placeholder', () => {
    const result = deriveWizardState({ ...base, agentMode: 'explore' });
    expect(result.promptPlaceholder).toMatch(/ask anything/i);
  });

  it('non-explore mode without a spec uses the describe-your-task placeholder', () => {
    expect(deriveWizardState({ ...base, agentMode: 'plan' }).promptPlaceholder).toMatch(/describe your task/i);
    expect(deriveWizardState({ ...base, agentMode: 'execute' }).promptPlaceholder).toMatch(/describe your task/i);
  });
});
