import { describe, expect, test } from 'vitest';
import { renderBuiltinPrompt } from '../render';

const baseVars = {
  uncommittedCount: 0,
  branch: 'feat/my-change',
  baseBranch: 'main',
  hasUpstream: true,
  provider: null,
  azureOrganization: '',
  azureProject: '',
  azureRepository: '',
  openspecChangeName: '',
  openspecChangePath: '',
  existingPrUrl: ''
};

describe('workflow/create-pr prompt', () => {
  test('baseline (non-OpenSpec, no existingPrUrl) renders standard gh pr create instruction', () => {
    const output = renderBuiltinPrompt('workflow/create-pr', baseVars);
    expect(output).toContain('gh pr create');
    expect(output).toContain('main');
    expect(output).not.toContain('feat(');
    expect(output).not.toContain('proposal.md');
    expect(output).not.toContain('already exists');
  });

  test('OpenSpec branch renders feat(<name>): title prefix and proposal.md reference', () => {
    const output = renderBuiltinPrompt('workflow/create-pr', {
      ...baseVars,
      openspecChangeName: 'add-auth',
      openspecChangePath: 'openspec/changes/add-auth'
    });
    expect(output).toContain('feat(add-auth):');
    expect(output).toContain('openspec/changes/add-auth/proposal.md');
    expect(output).toContain('Refs openspec change');
    expect(output).toContain('gh pr create');
  });

  test('existingPrUrl branch instructs surfacing the URL and skipping create', () => {
    const url = 'https://github.com/org/repo/pull/42';
    const output = renderBuiltinPrompt('workflow/create-pr', {
      ...baseVars,
      existingPrUrl: url
    });
    expect(output).toContain(url);
    expect(output).not.toContain('gh pr create');
    expect(output).not.toContain('az repos pr create');
  });

  test('Azure OpenSpec branch uses az repos pr create with feat prefix', () => {
    const output = renderBuiltinPrompt('workflow/create-pr', {
      ...baseVars,
      provider: 'azure',
      azureOrganization: 'myorg',
      azureProject: 'myproject',
      azureRepository: 'myrepo',
      openspecChangeName: 'big-refactor',
      openspecChangePath: 'openspec/changes/big-refactor'
    });
    expect(output).toContain('feat(big-refactor):');
    expect(output).toContain('az repos pr create');
    expect(output).toContain('openspec/changes/big-refactor/proposal.md');
  });

  test('uncommitted changes add commit step before PR creation', () => {
    const output = renderBuiltinPrompt('workflow/create-pr', {
      ...baseVars,
      uncommittedCount: 3
    });
    expect(output).toContain('uncommitted');
    expect(output).toContain('git diff');
    expect(output).toContain('Commit');
  });
});
