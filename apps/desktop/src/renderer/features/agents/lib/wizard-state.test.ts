import { describe, it, expect } from 'vitest';
import { deriveWizardState, nextWorkflowSelection } from './wizard-state';
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

describe('nextWorkflowSelection', () => {
  // E2: spec-driven keeps the OpenSpec harness and does not touch agentMode or a selected spec.
  it('spec-driven sets the OpenSpec harness, leaves agentMode, and keeps any selected spec', () => {
    expect(nextWorkflowSelection('spec-driven')).toEqual({
      harness: 'spec-driven',
      agentMode: null,
      abandonsSpec: false
    });
  });

  // E1 + E4: each concrete mode resets the harness to vibe-coding, applies the mode, and abandons a spec.
  it.each(['plan', 'execute', 'explore'] as const)(
    'concrete mode "%s" resets harness to vibe-coding, applies the mode, and abandons a selected spec',
    (mode) => {
      expect(nextWorkflowSelection(mode)).toEqual({
        harness: 'vibe-coding',
        agentMode: mode,
        abandonsSpec: true
      });
    }
  );
});
