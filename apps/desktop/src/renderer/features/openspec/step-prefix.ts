import type { OpenSpecSidebarContext, OpenSpecStep } from './atoms';

export function buildOpenSpecStepPrefixedPrompt(params: {
  prompt: string;
  context: OpenSpecSidebarContext | null;
  currentStep: OpenSpecStep;
  lastSentStep: OpenSpecStep | null;
  applyMode?: boolean;
}): { prompt: string; sentStep: OpenSpecStep | null } {
  const stepChanged = params.currentStep !== params.lastSentStep;
  // Skip duplicate apply prefix when the user already typed `/opsx:apply` themselves.
  const needsApplyPrefix = params.applyMode === true && !params.prompt.startsWith('/opsx:apply');

  if (!params.context || (!stepChanged && !needsApplyPrefix)) {
    return { prompt: params.prompt, sentStep: null };
  }

  let prompt = params.prompt;
  let sentStep: OpenSpecStep | null = null;

  if (stepChanged) {
    prompt = `[step:${params.currentStep}]\n${prompt}`;
    sentStep = params.currentStep;
  }

  // `/opsx:apply` goes before `[step:*]` so the agent sees the apply marker first.
  if (needsApplyPrefix) {
    prompt = `/opsx:apply ${prompt}`;
  }

  return { prompt, sentStep };
}
