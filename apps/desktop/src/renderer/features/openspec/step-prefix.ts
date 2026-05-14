import type { OpenSpecSidebarContext, OpenSpecStep } from './atoms';

export function buildOpenSpecStepPrefixedPrompt(params: {
  prompt: string;
  context: OpenSpecSidebarContext | null;
  currentStep: OpenSpecStep;
  lastSentStep: OpenSpecStep | null;
  pendingCommand?: 'propose' | 'apply' | null;
}): { prompt: string; sentStep: OpenSpecStep | null } {
  if (!params.context) {
    return { prompt: params.prompt, sentStep: null };
  }

  const stepChanged = params.currentStep !== params.lastSentStep;
  const pendingCommand = params.pendingCommand ?? null;

  // Skip prefix injection if neither condition applies.
  if (!stepChanged && !pendingCommand) {
    return { prompt: params.prompt, sentStep: null };
  }

  let prompt = params.prompt;
  let sentStep: OpenSpecStep | null = null;

  // If the user already typed a /opsx: command, the harness needs it on line 1.
  // Prepending [step:*] would push it off line 1 and break expansion, so skip
  // annotation entirely — just record the sentStep and leave the prompt untouched.
  if (params.prompt.startsWith('/opsx:')) {
    if (stepChanged) sentStep = params.currentStep;
    return { prompt, sentStep };
  }

  // Layer 1: step annotation (goes after the slash command on line 1).
  if (stepChanged) {
    prompt = `[step:${params.currentStep}]\n${prompt}`;
    sentStep = params.currentStep;
  }

  // Layer 2: slash command must sit on line 1 so the harness expands it.
  if (pendingCommand) {
    prompt = `/opsx:${pendingCommand}\n${prompt}`;
  }

  return { prompt, sentStep };
}
