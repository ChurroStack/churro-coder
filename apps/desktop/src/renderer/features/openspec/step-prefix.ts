import type { OpenSpecSidebarContext, OpenSpecStep } from './atoms';

export function buildOpenSpecStepPrefixedPrompt(params: {
  prompt: string;
  context: OpenSpecSidebarContext | null;
  currentStep: OpenSpecStep;
  lastSentStep: OpenSpecStep | null;
  applyMode?: boolean;
}): { prompt: string; sentStep: OpenSpecStep | null } {
  if (!params.context) {
    return { prompt: params.prompt, sentStep: null };
  }

  let prompt = params.prompt;
  let sentStep: OpenSpecStep | null = null;

  // Inject [step:*] prefix when the step has changed
  if (params.currentStep !== params.lastSentStep) {
    prompt = `[step:${params.currentStep}]\n${prompt}`;
    sentStep = params.currentStep;
  }

  // Prepend /opsx:apply when apply mode is ON (goes before [step:*] so the agent sees apply first)
  if (params.applyMode) {
    prompt = `/opsx:apply ${prompt}`;
  }

  if (prompt === params.prompt) {
    return { prompt: params.prompt, sentStep: null };
  }

  return { prompt, sentStep };
}
