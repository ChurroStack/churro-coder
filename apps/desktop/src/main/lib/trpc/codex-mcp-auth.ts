import { getMcpHttpEndpoint } from '../mcp/http-transport';

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
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

  if (!params.serverName.startsWith('churro-coder')) {
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

export function shouldRemoveStaleAppOwnedMcpEntry(name: string, currentServerName: string): boolean {
  if (name === 'churro-memory' || name === 'churro-memory-dev') return true;
  if (name !== 'churro-coder' && name !== 'churro-coder-dev') return false;
  return name !== currentServerName;
}
