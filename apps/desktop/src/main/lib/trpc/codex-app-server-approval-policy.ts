import type {
  ServerRequest
} from '../../../shared/codex-app-server-schema';
import type {
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalResponse
} from '../../../shared/codex-app-server-schema/v2';
import type { CodexSandboxPolicy } from './codex-sandbox-policy';

type ApprovalParams = Record<string, unknown>;

export function getCodexAppServerApprovalResponse(
  method: ServerRequest['method'],
  params: ApprovalParams,
  sandboxPolicy: CodexSandboxPolicy | undefined
): CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse | { decision: 'accept' } | null {
  if (method === 'item/commandExecution/requestApproval') {
    if (params.networkApprovalContext) {
      return {
        decision: sandboxPolicy?.type === 'dangerFullAccess' ? 'acceptForSession' : 'decline'
      };
    }
    return { decision: 'acceptForSession' };
  }

  if (method === 'item/fileChange/requestApproval') {
    return { decision: 'acceptForSession' };
  }

  if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
    return { decision: 'accept' };
  }

  return null;
}
