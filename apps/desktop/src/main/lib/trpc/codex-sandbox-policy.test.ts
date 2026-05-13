import { describe, expect, test } from 'vitest';
import { buildCodexSandboxPolicy, buildCodexWorkspaceWriteSandboxPolicy } from './codex-sandbox-policy';

describe('buildCodexSandboxPolicy', () => {
  test('plan → readOnly', () => {
    expect(buildCodexSandboxPolicy('plan', true, ['/r'])).toEqual({ type: 'readOnly' });
  });

  test('explore → readOnly regardless of sandbox flag', () => {
    expect(buildCodexSandboxPolicy('explore', true, ['/r'])).toEqual({ type: 'readOnly' });
    expect(buildCodexSandboxPolicy('explore', false, ['/r'])).toEqual({ type: 'readOnly' });
  });

  test('execute + sandbox off → dangerFullAccess', () => {
    expect(buildCodexSandboxPolicy('execute', false, [])).toEqual({ type: 'dangerFullAccess' });
  });

  test('execute + sandbox on → workspaceWrite with roots', () => {
    expect(buildCodexSandboxPolicy('execute', true, ['/r'])).toMatchObject({
      type: 'workspaceWrite',
      writableRoots: ['/r']
    });
  });

  test('forced workspaceWrite policy uses the central workspace-write defaults', () => {
    expect(buildCodexWorkspaceWriteSandboxPolicy(['/openspec/change'])).toEqual({
      type: 'workspaceWrite',
      writableRoots: ['/openspec/change'],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    });
  });
});
