import { describe, expect, test } from 'vitest';
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
});
