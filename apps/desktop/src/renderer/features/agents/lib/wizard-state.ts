import type { AgentMode } from '../atoms';

export type WorkType = 'feature' | 'bug' | 'documentation';
export type Harness = 'vibe-coding' | 'spec-driven';
export type WizardSectionKey = 'mode' | 'type' | 'harness' | 'prompt';

export type WizardInput = {
  agentMode: AgentMode;
  workType: WorkType;
  harness: Harness;
  selectedSpecId: string | null;
  hasProject: boolean;
  hasText: boolean;
  hasAttachments: boolean;
};

export type WizardDerived = {
  visibleSections: WizardSectionKey[];
  promptLabel: string;
  promptPlaceholder: string;
  canSubmit: boolean;
  sendLabel: string;
};

export function getVisibleWizardSections(agentMode: AgentMode): WizardSectionKey[] {
  if (agentMode === 'explore') {
    return ['mode', 'prompt'];
  }

  if (agentMode === 'execute') {
    return ['mode', 'type', 'prompt'];
  }

  return ['mode', 'type', 'harness', 'prompt'];
}

export function getWizardStepMap(visibleSections: WizardSectionKey[]): Record<WizardSectionKey, number | null> {
  const stepMap: Record<WizardSectionKey, number | null> = {
    mode: null,
    type: null,
    harness: null,
    prompt: null
  };

  visibleSections.forEach((section, index) => {
    stepMap[section] = index + 1;
  });

  return stepMap;
}

export function deriveWizardState(input: WizardInput): WizardDerived {
  const { agentMode, selectedSpecId, hasProject } = input;
  const visibleSections = getVisibleWizardSections(agentMode);
  const hasSpecSelected = selectedSpecId !== null;

  return {
    visibleSections,
    promptLabel: agentMode === 'explore' ? 'Ask a question' : 'Describe your task',
    promptPlaceholder:
      agentMode === 'explore'
        ? 'Ask anything about the codebase…'
        : hasSpecSelected
          ? 'Optionally tell the agent what to do with this change…'
          : 'Describe your task — press Cmd+Enter to start',
    canSubmit: hasProject,
    sendLabel: 'Start workspace'
  };
}
