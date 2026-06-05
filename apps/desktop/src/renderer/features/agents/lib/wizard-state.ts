import type { AgentMode } from '../atoms';

export type WorkType = 'feature' | 'bug' | 'documentation';
/** Cards axis in the New Workspace wizard: classic chat vs OpenSpec editor. */
export type WizardTemplate = 'vibe-coding' | 'spec-driven';
/** The four options in the in-input workflow-mode dropdown. */
export type WorkflowMode = AgentMode | 'spec-driven';

export type WorkflowSelection = {
  /** OpenSpec harness axis: 'spec-driven' opens the change flow, 'vibe-coding' is the classic chat. */
  harness: WizardTemplate;
  /** Agent mode to apply, or null when the selection shouldn't touch agentMode (spec-driven). */
  agentMode: AgentMode | null;
  /** Concrete modes abandon a previously selected spec; spec-driven keeps it. */
  abandonsSpec: boolean;
};

/**
 * Pure reconciliation for the workflow-mode dropdown. The dropdown drives two
 * independent atoms (`agentMode`, `selectedHarness`) plus a selected spec, and
 * those atoms have other writers (Shift+Tab, slash commands) — so the decision
 * lives here, in one tested place, and every writer routes through it.
 */
export function nextWorkflowSelection(next: WorkflowMode): WorkflowSelection {
  if (next === 'spec-driven') {
    // Leave agentMode + any selected spec intact: dropdown=spec-driven covers
    // both continue-from-spec (spec set) and propose-new (no spec).
    return { harness: 'spec-driven', agentMode: null, abandonsSpec: false };
  }
  // A concrete mode resets the OpenSpec harness and abandons a selected spec so
  // handleSend's selectedSpecId-first branch can't silently override the choice.
  return { harness: 'vibe-coding', agentMode: next, abandonsSpec: true };
}

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
