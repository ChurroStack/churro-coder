import { describe, expect, test } from 'vitest';
import { buildOpenSpecCliPrefixedMessage, buildOpenSpecStepPrefixedPrompt } from './step-prefix';
import type { OpenSpecSidebarContext } from './atoms';

const context: OpenSpecSidebarContext = {
  chatId: 'chat-1',
  projectId: 'project-1',
  changeId: 'add-login',
  changePath: 'openspec/changes/add-login'
};

describe('buildOpenSpecStepPrefixedPrompt', () => {
  test('leaves non-OpenSpec chats unchanged regardless of pendingCommand', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context: null,
        currentStep: 'tasks',
        lastSentStep: null,
        pendingCommand: 'apply'
      })
    ).toEqual({ prompt: 'Fix the bug', sentStep: null });
  });

  test('context null, step unchanged, no command — unchanged', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Refine this',
        context: null,
        currentStep: 'proposal',
        lastSentStep: null
      })
    ).toEqual({ prompt: 'Refine this', sentStep: null });
  });

  test('prefixes the first OpenSpec turn with the current step', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Refine this',
        context,
        currentStep: 'proposal',
        lastSentStep: null
      })
    ).toEqual({ prompt: '[step:proposal]\nRefine this', sentStep: 'proposal' });
  });

  test('does not duplicate the step prefix when step has not changed', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Refine this again',
        context,
        currentStep: 'proposal',
        lastSentStep: 'proposal'
      })
    ).toEqual({ prompt: 'Refine this again', sentStep: null });
  });

  test('prefixes when the editor step changes between turns', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Update the architecture',
        context,
        currentStep: 'design',
        lastSentStep: 'proposal'
      })
    ).toEqual({ prompt: '[step:design]\nUpdate the architecture', sentStep: 'design' });
  });

  // --- pendingCommand cases ---

  test('pendingCommand propose, step unchanged — /opsx:propose on line 1 only', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Improve the proposal',
        context,
        currentStep: 'proposal',
        lastSentStep: 'proposal',
        pendingCommand: 'propose'
      })
    ).toEqual({ prompt: '/opsx:propose\nImprove the proposal', sentStep: null });
  });

  test('pendingCommand apply, step unchanged — /opsx:apply on line 1 only', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'tasks',
        pendingCommand: 'apply'
      })
    ).toEqual({ prompt: '/opsx:apply\nFix the bug', sentStep: null });
  });

  test('pendingCommand apply, step changed — /opsx:apply line 1, [step:tasks] line 2', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'design',
        pendingCommand: 'apply'
      })
    ).toEqual({ prompt: '/opsx:apply\n[step:tasks]\nFix the bug', sentStep: 'tasks' });
  });

  test('pendingCommand null, step unchanged — prompt unchanged', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'tasks',
        pendingCommand: null
      })
    ).toEqual({ prompt: 'Fix the bug', sentStep: null });
  });

  test('pendingCommand null, step changed — only [step:*] prefix', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'proposal',
        pendingCommand: null
      })
    ).toEqual({ prompt: '[step:tasks]\nFix the bug', sentStep: 'tasks' });
  });

  test('user already typed /opsx:apply — prompt left as-is, sentStep recorded for step change', () => {
    // /opsx: must stay on line 1 for harness expansion; prepending [step:*] would break it.
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: '/opsx:apply Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'proposal',
        pendingCommand: 'apply'
      })
    ).toEqual({ prompt: '/opsx:apply Fix the bug', sentStep: 'tasks' });
  });

  test('user already typed /opsx:propose, step unchanged — prompt and sentStep both unchanged', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: '/opsx:propose Add auth',
        context,
        currentStep: 'proposal',
        lastSentStep: 'proposal',
        pendingCommand: 'propose'
      })
    ).toEqual({ prompt: '/opsx:propose Add auth', sentStep: null });
  });
});

describe('buildOpenSpecCliPrefixedMessage', () => {
  test('non-openspec context leaves message untouched', () => {
    expect(buildOpenSpecCliPrefixedMessage({ message: 'hello', isOpenSpec: false, currentStep: 'tasks' })).toBe(
      'hello'
    );
  });

  test('proposal tab → /opsx:propose prefix', () => {
    expect(buildOpenSpecCliPrefixedMessage({ message: 'refine this', isOpenSpec: true, currentStep: 'proposal' })).toBe(
      '/opsx:propose\nrefine this'
    );
  });

  test('design tab → /opsx:propose prefix (proposal+design share the propose workflow)', () => {
    expect(buildOpenSpecCliPrefixedMessage({ message: 'update arch', isOpenSpec: true, currentStep: 'design' })).toBe(
      '/opsx:propose\nupdate arch'
    );
  });

  test('tasks tab → /opsx:apply prefix', () => {
    expect(buildOpenSpecCliPrefixedMessage({ message: 'fix it', isOpenSpec: true, currentStep: 'tasks' })).toBe(
      '/opsx:apply\nfix it'
    );
  });

  test('user-typed slash command — left as-is (no double prefix)', () => {
    expect(buildOpenSpecCliPrefixedMessage({ message: '/clear', isOpenSpec: true, currentStep: 'tasks' })).toBe(
      '/clear'
    );
    expect(
      buildOpenSpecCliPrefixedMessage({ message: '/opsx:apply manually', isOpenSpec: true, currentStep: 'tasks' })
    ).toBe('/opsx:apply manually');
  });

  test('codex-cli harness: tasks tab → $openspec-apply-change prefix', () => {
    expect(
      buildOpenSpecCliPrefixedMessage({
        message: 'fix it',
        isOpenSpec: true,
        currentStep: 'tasks',
        harness: 'codex-cli'
      })
    ).toBe('$openspec-apply-change\nfix it');
  });

  test('codex-cli harness: proposal tab → $openspec-propose prefix', () => {
    expect(
      buildOpenSpecCliPrefixedMessage({
        message: 'refine',
        isOpenSpec: true,
        currentStep: 'proposal',
        harness: 'codex-cli'
      })
    ).toBe('$openspec-propose\nrefine');
  });

  test('codex-cli harness: user already typed $openspec-* — left as-is', () => {
    expect(
      buildOpenSpecCliPrefixedMessage({
        message: '$openspec-apply-change 1.2',
        isOpenSpec: true,
        currentStep: 'tasks',
        harness: 'codex-cli'
      })
    ).toBe('$openspec-apply-change 1.2');
  });
});
