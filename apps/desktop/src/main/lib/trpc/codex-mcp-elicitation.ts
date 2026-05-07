import { isAppOwnedChurroCoderMcpServerName } from './codex-mcp-auth';

type ElicitationAction = 'accept' | 'decline';

export type CodexMcpElicitationDecision = {
  action: ElicitationAction;
  content: null;
  reason: string;
};

function getStringParam(params: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function textMentionsReadPlan(params: Record<string, unknown>): boolean {
  const haystack = ['content', 'prompt', 'message', 'description', 'reason']
    .map((key) => params[key])
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLowerCase();

  return haystack.includes('read_plan') || haystack.includes('churro-coder');
}

export function decideCodexMcpElicitation(params: Record<string, unknown>): CodexMcpElicitationDecision {
  const serverName = getStringParam(params, ['server', 'serverName', 'mcpServer', 'mcpServerName']);
  const toolName = getStringParam(params, ['tool', 'toolName']);

  if (serverName && isAppOwnedChurroCoderMcpServerName(serverName)) {
    return { action: 'accept', content: null, reason: `app-owned-server:${serverName}` };
  }

  if (toolName === 'read_plan') {
    return { action: 'accept', content: null, reason: 'app-owned-tool:read_plan' };
  }

  if (textMentionsReadPlan(params)) {
    return { action: 'accept', content: null, reason: 'app-owned-text-match:read_plan' };
  }

  return { action: 'decline', content: null, reason: 'unknown-mcp-elicitation' };
}
