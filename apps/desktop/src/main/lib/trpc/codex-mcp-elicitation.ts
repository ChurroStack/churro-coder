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

  // When Codex names the server, that's authoritative — text-match must not override it.
  if (serverName) {
    return isAppOwnedChurroCoderMcpServerName(serverName)
      ? { action: 'accept', content: null, reason: `app-owned-server:${serverName}` }
      : { action: 'decline', content: null, reason: `unknown-mcp-elicitation:server=${serverName}` };
  }

  // No server, but tool is named — accept only our own tool.
  if (toolName) {
    return toolName === 'read_plan'
      ? { action: 'accept', content: null, reason: 'app-owned-tool:read_plan' }
      : { action: 'decline', content: null, reason: `unknown-mcp-elicitation:tool=${toolName}` };
  }

  // Last resort: no structured server/tool fields. Fall back to text-match so we don't
  // miss prompt-only elicitation shapes that mention our server/tool by name.
  if (textMentionsReadPlan(params)) {
    return { action: 'accept', content: null, reason: 'app-owned-text-match:read_plan' };
  }

  return { action: 'decline', content: null, reason: 'unknown-mcp-elicitation' };
}
