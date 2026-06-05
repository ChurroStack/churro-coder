import type { AgentMode } from '../atoms';

export type WorkType = 'feature' | 'bug' | 'documentation';
/** Cards axis in the New Workspace wizard: classic chat vs OpenSpec editor. */
export type WizardTemplate = 'vibe-coding' | 'spec-driven';

export type WizardInput = {
  agentMode: AgentMode;
  selectedSpecId: string | null;
  hasProject: boolean;
};

export type WizardDerived = {
  promptPlaceholder: string;
  canSubmit: boolean;
};

export function deriveWizardState(input: WizardInput): WizardDerived {
  const { agentMode, selectedSpecId, hasProject } = input;
  const hasSpecSelected = selectedSpecId !== null;

  return {
    promptPlaceholder:
      agentMode === 'explore'
        ? 'Ask anything about the codebase…'
        : hasSpecSelected
          ? 'Optionally tell the agent what to do with this change…'
          : 'Describe your task — press Cmd+Enter to start',
    canSubmit: hasProject
  };
}
