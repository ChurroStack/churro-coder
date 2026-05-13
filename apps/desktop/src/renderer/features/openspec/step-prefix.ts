import type { OpenSpecSidebarContext, OpenSpecStep } from './atoms';

export function buildOpenSpecStepPrefixedPrompt(params: {
  prompt: string;
  context: OpenSpecSidebarContext | null;
  currentStep: OpenSpecStep;
  lastSentStep: OpenSpecStep | null;
}): { prompt: string; sentStep: OpenSpecStep | null } {
  if (!params.context || params.currentStep === params.lastSentStep) {
    return { prompt: params.prompt, sentStep: null };
  }

  return {
    prompt: `[step:${params.currentStep}]\n${params.prompt}`,
    sentStep: params.currentStep
  };
}
