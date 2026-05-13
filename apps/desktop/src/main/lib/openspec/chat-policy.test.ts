import { describe, expect, test } from 'vitest';
import {
  evaluateOpenSpecToolPolicy,
  isOpenSpecApplyPrompt,
  OPEN_SPEC_CODEX_RESTRICTED_TOOLS,
  resolveOpenSpecCodexToolConfig,
  stripOpenSpecStepPrefix
} from './chat-policy';

describe('isOpenSpecApplyPrompt', () => {
  test('detects apply prompts with or without OpenSpec step context', () => {
    expect(isOpenSpecApplyPrompt('/opsx:apply')).toBe(true);
    expect(isOpenSpecApplyPrompt('  /opsx:apply ')).toBe(true);
    expect(isOpenSpecApplyPrompt('/opsx:apply 1.3')).toBe(true);
    expect(isOpenSpecApplyPrompt('[step:tasks]\n/opsx:apply')).toBe(true);
    expect(isOpenSpecApplyPrompt('[step:tasks]\n/opsx:apply 1.3')).toBe(true);
    expect(isOpenSpecApplyPrompt('Implement tasks from an OpenSpec change.\n\n**Input**:')).toBe(true);
    expect(isOpenSpecApplyPrompt('[step:tasks]\nImplement tasks from an OpenSpec change.\n\n**Input**:')).toBe(true);
  });

  test('does not match related text or other commands', () => {
    expect(isOpenSpecApplyPrompt('/opsx:apply-extra')).toBe(false);
    expect(isOpenSpecApplyPrompt('/opsx:applyfoo')).toBe(false);
    expect(isOpenSpecApplyPrompt('/opsx:verify')).toBe(false);
    expect(isOpenSpecApplyPrompt('look at /opsx:apply later')).toBe(false);
    expect(isOpenSpecApplyPrompt('[step:tasks]\nlook at /opsx:apply later')).toBe(false);
  });
});

describe('stripOpenSpecStepPrefix', () => {
  test('strips only the leading supported step prefix', () => {
    expect(stripOpenSpecStepPrefix('[step:proposal]\nRefine this')).toBe('Refine this');
    expect(stripOpenSpecStepPrefix('[step:design]\nRefine this')).toBe('Refine this');
    expect(stripOpenSpecStepPrefix('[step:tasks]\nRefine this')).toBe('Refine this');
    expect(stripOpenSpecStepPrefix('[step:unknown]\nRefine this')).toBe('[step:unknown]\nRefine this');
  });
});

describe('evaluateOpenSpecToolPolicy', () => {
  const cwd = '/repo';
  const openSpecWriteRoot = '/repo/openspec/changes/add-login';

  function decision(toolName: string, toolInput: Record<string, unknown>, isApplyTurn = false) {
    return evaluateOpenSpecToolPolicy({
      openSpecWriteRoot,
      openSpecChangePath: 'openspec/changes/add-login',
      isApplyTurn,
      cwd,
      toolName,
      toolInput
    });
  }

  test('allows all tools outside an OpenSpec-bound sidebar or during apply turns', () => {
    expect(
      evaluateOpenSpecToolPolicy({
        openSpecWriteRoot: null,
        openSpecChangePath: undefined,
        isApplyTurn: false,
        cwd,
        toolName: 'Write',
        toolInput: { file_path: 'src/app.ts' }
      })
    ).toBeNull();
    expect(decision('Write', { file_path: 'src/app.ts' }, true)).toBeNull();
    expect(decision('Bash', {}, true)).toBeNull();
  });

  test('allows Bash outside apply turns (agents need it to call the openspec CLI)', () => {
    expect(decision('Bash', {})).toBeNull();
  });

  test('allows reads, bash, and other non-write tools outside apply turns', () => {
    expect(decision('Read', { file_path: 'src/app.ts' })).toBeNull();
    expect(decision('Glob', { pattern: '**/*.ts' })).toBeNull();
    expect(decision('Grep', { pattern: 'foo' })).toBeNull();
    expect(decision('WebFetch', { url: 'https://example.com' })).toBeNull();
  });

  test('allows writes inside the OpenSpec change folder', () => {
    expect(decision('Write', { file_path: 'openspec/changes/add-login/proposal.md' })).toBeNull();
    expect(decision('Edit', { file_path: '/repo/openspec/changes/add-login/tasks.md' })).toBeNull();
    expect(decision('MultiEdit', { file_path: 'openspec/changes/add-login/specs/auth/spec.md' })).toBeNull();
  });

  test('blocks writes outside the OpenSpec change folder and shared-prefix siblings', () => {
    expect(decision('Write', { file_path: 'src/app.ts' })).toMatchObject({ behavior: 'deny' });
    expect(decision('Edit', { file_path: '/repo/openspec/changes/add-login-extra/proposal.md' })).toMatchObject({
      behavior: 'deny'
    });
  });

  test('blocks write tools with no file_path instead of allowing by default', () => {
    expect(decision('NotebookEdit', {})).toMatchObject({ behavior: 'deny' });
  });
});

describe('resolveOpenSpecCodexToolConfig', () => {
  const defaults = {
    defaultBuiltInTools: ['Bash', 'Edit', 'Write', 'Read', 'PlanWrite'],
    defaultWritableRoots: ['/repo', '/tmp/churro'],
    defaultSandboxEnabled: false
  };

  test('restricts tools, writable roots, and sandbox off apply turns', () => {
    const config = resolveOpenSpecCodexToolConfig({
      openSpecWriteRoot: '/repo/openspec/changes/add-login',
      isApplyTurn: false,
      ...defaults
    });

    expect(config.builtInTools).toEqual(OPEN_SPEC_CODEX_RESTRICTED_TOOLS);
    expect(config.builtInTools).toEqual(
      expect.arrayContaining(['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch'])
    );
    expect(config.writableRoots).toEqual(['/repo/openspec/changes/add-login', '/repo', '/tmp/churro']);
    expect(config.sandboxEnabled).toBe(true);
    expect(config.forceWritableRoots).toEqual(['/repo/openspec/changes/add-login', '/repo', '/tmp/churro']);
  });

  test('uses default mode policy during apply turns or non-OpenSpec chats', () => {
    expect(
      resolveOpenSpecCodexToolConfig({
        openSpecWriteRoot: '/repo/openspec/changes/add-login',
        isApplyTurn: true,
        ...defaults
      })
    ).toEqual({
      builtInTools: defaults.defaultBuiltInTools,
      writableRoots: defaults.defaultWritableRoots,
      sandboxEnabled: defaults.defaultSandboxEnabled
    });

    expect(
      resolveOpenSpecCodexToolConfig({
        openSpecWriteRoot: null,
        isApplyTurn: false,
        ...defaults
      })
    ).toEqual({
      builtInTools: defaults.defaultBuiltInTools,
      writableRoots: defaults.defaultWritableRoots,
      sandboxEnabled: defaults.defaultSandboxEnabled
    });
  });
});
