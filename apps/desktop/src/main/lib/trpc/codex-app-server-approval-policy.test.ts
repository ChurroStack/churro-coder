import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ServerRequest } from '../../../shared/codex-app-server-schema';
import { getCodexAppServerApprovalResponse } from './codex-app-server-approval-policy';
import type { CodexSandboxPolicy } from './codex-sandbox-policy';

const readOnlyPolicy: CodexSandboxPolicy = { type: 'readOnly' };
const workspaceWritePolicy: CodexSandboxPolicy = {
  type: 'workspaceWrite',
  writableRoots: ['/tmp/worktree'],
  networkAccess: true,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false
};
const dangerFullAccessPolicy: CodexSandboxPolicy = { type: 'dangerFullAccess' };

describe('getCodexAppServerApprovalResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('declines managed-network approvals in read-only mode', () => {
    expect(
      getCodexAppServerApprovalResponse(
        'item/commandExecution/requestApproval',
        { networkApprovalContext: { host: 'example.com', protocol: 'https' } },
        readOnlyPolicy
      )
    ).toEqual({ decision: 'decline' });
  });

  test('declines managed-network approvals in workspace-write mode', () => {
    expect(
      getCodexAppServerApprovalResponse(
        'item/commandExecution/requestApproval',
        { networkApprovalContext: { host: 'example.com', protocol: 'https' } },
        workspaceWritePolicy
      )
    ).toEqual({ decision: 'decline' });
  });

  test('accepts managed-network approvals for the session in danger-full-access mode', () => {
    expect(
      getCodexAppServerApprovalResponse(
        'item/commandExecution/requestApproval',
        { networkApprovalContext: { host: 'example.com', protocol: 'https' } },
        dangerFullAccessPolicy
      )
    ).toEqual({ decision: 'acceptForSession' });
  });

  test('accepts command approvals for the session by default', () => {
    expect(
      getCodexAppServerApprovalResponse('item/commandExecution/requestApproval', {}, workspaceWritePolicy)
    ).toEqual({ decision: 'acceptForSession' });
  });

  test('accepts file-change approvals for the session', () => {
    expect(getCodexAppServerApprovalResponse('item/fileChange/requestApproval', {}, workspaceWritePolicy)).toEqual({
      decision: 'acceptForSession'
    });
  });

  test('accepts the legacy execCommandApproval method', () => {
    expect(getCodexAppServerApprovalResponse('execCommandApproval', {}, workspaceWritePolicy)).toEqual({
      decision: 'accept'
    });
  });

  test('accepts the legacy applyPatchApproval method', () => {
    expect(getCodexAppServerApprovalResponse('applyPatchApproval', {}, workspaceWritePolicy)).toEqual({
      decision: 'accept'
    });
  });

  test('returns null for non-approval methods so the dispatcher can route them elsewhere', () => {
    expect(getCodexAppServerApprovalResponse('mcpServer/elicitation/request', {}, workspaceWritePolicy)).toBeNull();
    expect(getCodexAppServerApprovalResponse('item/permissions/requestApproval', {}, workspaceWritePolicy)).toBeNull();
    expect(getCodexAppServerApprovalResponse('item/tool/call', {}, workspaceWritePolicy)).toBeNull();
  });

  test('declines unknown *requestApproval methods outside dangerFullAccess and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = getCodexAppServerApprovalResponse(
      'item/processSpawn/requestApproval' as ServerRequest['method'],
      {},
      workspaceWritePolicy
    );

    expect(result).toEqual({ decision: 'decline' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/unknown approval method=item\/processSpawn\/requestApproval/);
  });

  test('accepts unknown *requestApproval methods for the session under dangerFullAccess', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = getCodexAppServerApprovalResponse(
      'item/processSpawn/requestApproval' as ServerRequest['method'],
      {},
      dangerFullAccessPolicy
    );

    expect(result).toEqual({ decision: 'acceptForSession' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
