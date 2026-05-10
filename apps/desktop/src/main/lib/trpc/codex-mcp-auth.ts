import { getMcpHttpEndpoint } from '../mcp/http-transport';

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getAppOwnedChurroCoderMcpServerName(isDev = Boolean(process.env.ELECTRON_RENDERER_URL)): string {
  return isDev ? 'churro-coder-dev' : 'churro-coder';
}

export function getAppOwnedChurroCoderReadPlanToolName(serverName = getAppOwnedChurroCoderMcpServerName()): string {
  return `mcp__${serverName}__read_plan`;
}

export function buildApprovedPlanReadPlanUnavailableMessage(params: {
  mcpToolName: string;
  status: { state: 'cli-missing' } | { state: 'failed'; error: string } | { state: 'pending' };
}): string {
  if (params.status.state === 'cli-missing') {
    return `Codex MCP bootstrap is unavailable, so ${params.mcpToolName} could not be registered. Approved-plan execution was stopped before edits. Open Settings -> Integrations to reinstall the Codex CLI.`;
  }

  if (params.status.state === 'failed') {
    return `Codex MCP bootstrap failed, so ${params.mcpToolName} is unavailable. Approved-plan execution was stopped before edits. ${params.status.error} Open Settings -> Integrations to verify the Codex CLI installation.`;
  }

  return `Codex MCP bootstrap is not ready, so ${params.mcpToolName} is unavailable. Approved-plan execution was stopped before edits. Open Settings -> Integrations to verify the Codex CLI installation.`;
}

export function resolveAppOwnedMcpHeaders(params: {
  serverName: string;
  serverUrl?: string | null;
  headers?: Record<string, string>;
}): Record<string, string> | undefined {
  const headers = params.headers ? { ...params.headers } : {};

  if (headers.Authorization) {
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  if (!isAppOwnedChurroCoderMcpServerName(params.serverName)) {
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  const serverUrl = params.serverUrl?.trim();
  const endpoint = getMcpHttpEndpoint();
  if (!serverUrl || !endpoint) {
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  if (normalizeUrl(serverUrl) !== normalizeUrl(endpoint.url)) {
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  headers.Authorization = `Bearer ${endpoint.bearer}`;
  return headers;
}

export function isAppOwnedChurroCoderMcpServerName(name: string): boolean {
  return name === 'churro-coder' || name === 'churro-coder-dev';
}

export function shouldRemoveStaleAppOwnedMcpEntry(name: string, currentServerName: string): boolean {
  if (name === 'churro-memory' || name === 'churro-memory-dev') return true;
  if (name !== 'churro-coder' && name !== 'churro-coder-dev') return false;
  return name !== currentServerName;
}
