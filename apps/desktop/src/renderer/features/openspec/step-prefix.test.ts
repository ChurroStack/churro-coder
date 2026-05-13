import { describe, expect, test } from 'vitest';
import { buildOpenSpecStepPrefixedPrompt } from './step-prefix';
import type { OpenSpecSidebarContext } from './atoms';

const context: OpenSpecSidebarContext = {
  chatId: 'chat-1',
  projectId: 'project-1',
  changeId: 'add-login',
  changePath: 'openspec/changes/add-login'
};

describe('buildOpenSpecStepPrefixedPrompt', () => {
  test('leaves non-OpenSpec chats unchanged', () => {
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

  test('does not duplicate the prefix when the step has not changed', () => {
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

  test('apply mode off — no /opsx:apply prefix added', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'tasks',
        applyMode: false
      })
    ).toEqual({ prompt: 'Fix the bug', sentStep: null });
  });

  test('apply mode on, step unchanged — prepends /opsx:apply only', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'tasks',
        applyMode: true
      })
    ).toEqual({ prompt: '/opsx:apply Fix the bug', sentStep: null });
  });

  test('apply mode on, step changed — /opsx:apply [step:tasks] ordering preserved', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'proposal',
        applyMode: true
      })
    ).toEqual({ prompt: '/opsx:apply [step:tasks]\nFix the bug', sentStep: 'tasks' });
  });

  test('apply mode on but context is null — prompt left unchanged', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: 'Fix the bug',
        context: null,
        currentStep: 'tasks',
        lastSentStep: null,
        applyMode: true
      })
    ).toEqual({ prompt: 'Fix the bug', sentStep: null });
  });

  test('apply mode on but user already typed /opsx:apply — no doubled prefix', () => {
    expect(
      buildOpenSpecStepPrefixedPrompt({
        prompt: '/opsx:apply Fix the bug',
        context,
        currentStep: 'tasks',
        lastSentStep: 'tasks',
        applyMode: true
      })
    ).toEqual({ prompt: '/opsx:apply Fix the bug', sentStep: null });
  });
});
