import type { OpenSpecSidebarContext, OpenSpecStep } from './atoms';
import { openSpecCommandPrefix, type CliHarness } from './command-prefix';

/**
 * For CLI-harness OpenSpec chats the prompt is written directly to the embedded
 * PTY — there is no transport that reads `pendingCommand`. We prepend the
 * OpenSpec command (claude: `/opsx:propose`/`/opsx:apply`; codex:
 * `$openspec-propose`/`$openspec-apply-change`) based on the active editor tab
 * so the CLI runs the right workflow. Skipped when the user already typed a
 * slash command on line 1 (any `/cmd`) or a codex skill invocation
 * (`$openspec-*`).
 */
export function buildOpenSpecCliPrefixedMessage(params: {
  message: string;
  isOpenSpec: boolean;
  currentStep: OpenSpecStep;
  harness?: CliHarness;
}): string {
  const { message, isOpenSpec, currentStep, harness = 'claude-cli' } = params;
  if (!isOpenSpec) return message;
  if (message.startsWith('/')) return message;
  if (message.startsWith('$openspec-')) return message;
  const verb = currentStep === 'tasks' ? 'apply' : 'propose';
  return `${openSpecCommandPrefix(verb, harness)}\n${message}`;
}

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
