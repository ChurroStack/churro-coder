import { describe, it, expect } from 'vitest';
import { deriveWizardState, getVisibleWizardSections, getWizardStepMap } from './wizard-state';
import type { WizardInput } from './wizard-state';

const base: WizardInput = {
  agentMode: 'plan',
  workType: 'feature',
  harness: 'vibe-coding',
  selectedSpecId: null,
  hasProject: true,
  hasText: false,
  hasAttachments: false
};

describe('getVisibleWizardSections', () => {
  it('explore mode shows only mode + prompt sections', () => {
    expect(getVisibleWizardSections('explore')).toEqual(['mode', 'prompt']);
  });

  it('execute mode shows mode + type + prompt, no harness', () => {
    expect(getVisibleWizardSections('execute')).toEqual(['mode', 'type', 'prompt']);
  });

  it('plan mode shows all four sections', () => {
    expect(getVisibleWizardSections('plan')).toEqual(['mode', 'type', 'harness', 'prompt']);
  });
});

describe('getWizardStepMap', () => {
  it('section numbering is contiguous across modes', () => {
    for (const mode of ['plan', 'execute', 'explore'] as const) {
      const sections = getVisibleWizardSections(mode);
      const stepMap = getWizardStepMap(sections);
      const assigned = sections.map((s) => stepMap[s]);
      expect(assigned).toEqual(sections.map((_, i) => i + 1));
    }
  });

  it('assigns null to hidden sections', () => {
    const stepMap = getWizardStepMap(getVisibleWizardSections('explore'));
    expect(stepMap.type).toBeNull();
    expect(stepMap.harness).toBeNull();
  });
});

describe('deriveWizardState', () => {
  it('requiresText is false when no spec selected', () => {
    const result = deriveWizardState({ ...base, selectedSpecId: null });
    expect(result.requiresText).toBe(false);
  });

  it('requiresText is true when spec is selected', () => {
    const result = deriveWizardState({ ...base, selectedSpecId: 'change-abc' });
    expect(result.requiresText).toBe(true);
  });

  it('canSubmit false when no project regardless of text', () => {
    const result = deriveWizardState({ ...base, hasProject: false, hasText: true });
    expect(result.canSubmit).toBe(false);
  });

  it('canSubmit false when spec selected and no text and no attachments', () => {
    const result = deriveWizardState({ ...base, selectedSpecId: 'change-abc', hasText: false, hasAttachments: false });
    expect(result.canSubmit).toBe(false);
  });

  it('canSubmit true when spec selected and hasAttachments even with no text', () => {
    const result = deriveWizardState({ ...base, selectedSpecId: 'change-abc', hasText: false, hasAttachments: true });
    expect(result.canSubmit).toBe(true);
  });

  it('canSubmit true when no spec and blank prompt (open path)', () => {
    const result = deriveWizardState({ ...base, selectedSpecId: null, hasText: false });
    expect(result.canSubmit).toBe(true);
  });

  it('canSubmit true when has text regardless of spec', () => {
    const withSpec = deriveWizardState({ ...base, selectedSpecId: 'change-abc', hasText: true });
    const withoutSpec = deriveWizardState({ ...base, selectedSpecId: null, hasText: true });
    expect(withSpec.canSubmit).toBe(true);
    expect(withoutSpec.canSubmit).toBe(true);
  });

  it('explore mode visible sections are mode + prompt only', () => {
    const result = deriveWizardState({ ...base, agentMode: 'explore' });
    expect(result.visibleSections).toEqual(['mode', 'prompt']);
  });

  it('explore mode uses ask-a-question prompt label', () => {
    const result = deriveWizardState({ ...base, agentMode: 'explore' });
    expect(result.promptLabel).toBe('Ask a question');
  });

  it('non-explore mode uses describe-your-task prompt label', () => {
    expect(deriveWizardState({ ...base, agentMode: 'plan' }).promptLabel).toBe('Describe your task');
    expect(deriveWizardState({ ...base, agentMode: 'execute' }).promptLabel).toBe('Describe your task');
  });
});
