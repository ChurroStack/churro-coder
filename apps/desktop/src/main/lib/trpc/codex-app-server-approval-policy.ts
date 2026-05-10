import type { ServerRequest } from '../../../shared/codex-app-server-schema';
import type {
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalResponse
} from '../../../shared/codex-app-server-schema/v2';
import type { CodexSandboxPolicy } from './codex-sandbox-policy';

type ApprovalParams = Record<string, unknown>;

export type CodexAppServerApprovalResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | { decision: 'accept' };

export function getCodexAppServerApprovalResponse(
  method: ServerRequest['method'],
  params: ApprovalParams,
  sandboxPolicy: CodexSandboxPolicy | undefined
): CodexAppServerApprovalResponse | null {
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

  // Legacy v1 approval method names — kept so older Codex builds continue to
  // work after a binary downgrade. New methods should match the v2 cases above.
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
    return { decision: 'accept' };
  }

  // Forward-compat fallback: when Codex adds a brand-new `*requestApproval`
  // method we don't yet recognize, replying with `{}` would leave the server
  // hanging on a request we never answered. Mirror the network-approval
  // policy (decline outside `dangerFullAccess`), and warn so the new method
  // surfaces in CI logs and prompts an explicit branch on the next bump.
  //
  // `item/permissions/requestApproval` is intentionally skipped here because
  // its response shape is `{scope, permissions}` rather than `{decision}` and
  // the dispatcher has its own branch for it.
  if (
    typeof method === 'string' &&
    method.endsWith('requestApproval') &&
    method !== 'item/permissions/requestApproval'
  ) {
    const decision: 'acceptForSession' | 'decline' =
      sandboxPolicy?.type === 'dangerFullAccess' ? 'acceptForSession' : 'decline';
    console.warn(
      `[codex app-server] unknown approval method=${method} decision=${decision} sandbox=${sandboxPolicy?.type ?? 'unknown'} — add an explicit branch in codex-app-server-approval-policy.ts`
    );
    return { decision };
  }

  return null;
}
