import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import nunjucks from 'nunjucks';

// Load the actual .j2 file from disk so the test catches any drift between the
// template and the legacy generatePrMessage() output it replaced. We deliberately
// avoid the BUILTIN_PROMPTS glob mock used by prompt-service.test.ts — this is
// a fixture test of the template content, not the service.
const env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true });
const template = readFileSync(resolve(__dirname, 'workflow', 'create-pr.j2'), 'utf-8');

function render(vars: Record<string, unknown>): string {
  // Strip trailing whitespace so the test is robust against the file's EOF
  // newline (every .j2 file ends with one; the legacy code joined arrays
  // without a trailing newline).
  return env.renderString(template, vars).trimEnd();
}

const baseVars = {
  branch: 'feat/foo',
  baseBranch: 'main',
  azureOrganization: 'org',
  azureProject: 'proj',
  azureRepository: 'repo'
};

const ghStep =
  'Use gh pr create --base main to create a PR. Keep the title under 80 characters and description under five sentences.';

const azStep =
  'Use az repos pr create --source-branch feat/foo --target-branch main --repository repo --project "proj" ' +
  '--organization https://dev.azure.com/org --title "<title>" --description "<summary>" --output json ' +
  'to create a PR. Keep the title under 80 characters and description under five sentences.';

describe('workflow/create-pr.j2 — fixture matrix (uncommitted × upstream × provider)', () => {
  it('clean tree, has upstream, github', () => {
    expect(render({ ...baseVars, uncommittedCount: 0, hasUpstream: true, provider: 'github' })).toBe(
      [
        'All changes are committed.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'The branch is already pushed to remote.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Use git diff origin/main... to review the PR diff',
        `2. ${ghStep}`,
        '3. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('clean tree, has upstream, azure', () => {
    expect(render({ ...baseVars, uncommittedCount: 0, hasUpstream: true, provider: 'azure' })).toBe(
      [
        'All changes are committed.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'The branch is already pushed to remote.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Use git diff origin/main... to review the PR diff',
        `2. ${azStep}`,
        '3. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('clean tree, no upstream, github', () => {
    expect(render({ ...baseVars, uncommittedCount: 0, hasUpstream: false, provider: 'github' })).toBe(
      [
        'All changes are committed.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'There is no upstream branch yet.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Push to origin',
        '2. Use git diff origin/main... to review the PR diff',
        `3. ${ghStep}`,
        '4. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('clean tree, no upstream, azure', () => {
    expect(render({ ...baseVars, uncommittedCount: 0, hasUpstream: false, provider: 'azure' })).toBe(
      [
        'All changes are committed.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'There is no upstream branch yet.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Push to origin',
        '2. Use git diff origin/main... to review the PR diff',
        `3. ${azStep}`,
        '4. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('uncommitted, has upstream, github', () => {
    expect(render({ ...baseVars, uncommittedCount: 3, hasUpstream: true, provider: 'github' })).toBe(
      [
        'There are 3 uncommitted changes.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'The branch is already pushed to remote.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Run git diff to review uncommitted changes',
        '2. Commit them. Write a clear, concise commit message.',
        '3. Use git diff origin/main... to review the PR diff',
        `4. ${ghStep}`,
        '5. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('uncommitted, has upstream, azure', () => {
    expect(render({ ...baseVars, uncommittedCount: 3, hasUpstream: true, provider: 'azure' })).toBe(
      [
        'There are 3 uncommitted changes.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'The branch is already pushed to remote.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Run git diff to review uncommitted changes',
        '2. Commit them. Write a clear, concise commit message.',
        '3. Use git diff origin/main... to review the PR diff',
        `4. ${azStep}`,
        '5. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('uncommitted, no upstream, github', () => {
    expect(render({ ...baseVars, uncommittedCount: 3, hasUpstream: false, provider: 'github' })).toBe(
      [
        'There are 3 uncommitted changes.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'There is no upstream branch yet.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Run git diff to review uncommitted changes',
        '2. Commit them. Write a clear, concise commit message.',
        '3. Push to origin',
        '4. Use git diff origin/main... to review the PR diff',
        `5. ${ghStep}`,
        '6. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });

  it('uncommitted, no upstream, azure', () => {
    expect(render({ ...baseVars, uncommittedCount: 3, hasUpstream: false, provider: 'azure' })).toBe(
      [
        'There are 3 uncommitted changes.',
        'The current branch is feat/foo.',
        'The target branch is origin/main.',
        'There is no upstream branch yet.',
        'The user requested a PR.',
        '',
        'Follow these exact steps to create a PR:',
        '',
        '1. Run git diff to review uncommitted changes',
        '2. Commit them. Write a clear, concise commit message.',
        '3. Push to origin',
        '4. Use git diff origin/main... to review the PR diff',
        `5. ${azStep}`,
        '6. If any of these steps fail, ask the user for help.'
      ].join('\n')
    );
  });
});
