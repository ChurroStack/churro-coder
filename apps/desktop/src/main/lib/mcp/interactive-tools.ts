/**
 * Pure helpers for classifying MCP JSON-RPC request bodies. Kept dependency-free
 * (no electron) so the HTTP transport and unit tests can both import it.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The tool name of a `tools/call` request, or undefined for anything else. */
export function getToolName(body: unknown): string | undefined {
  const envelope = Array.isArray(body) ? body[0] : body;
  if (!isRecord(envelope) || envelope.method !== 'tools/call') return undefined;
  const params = isRecord(envelope.params) ? envelope.params : undefined;
  return params && typeof params.name === 'string' ? params.name : undefined;
}

/**
 * Tools that intentionally block on a human and may legitimately hold the
 * response open for minutes. They MUST be exempt from the generic per-request
 * socket watchdog, which exists only to reap requests that never respond.
 */
export const INTERACTIVE_TOOLS = new Set(['request_user_input']);

/** True when the request is a tools/call for a human-blocking interactive tool. */
export function isInteractiveToolCall(body: unknown): boolean {
  const name = getToolName(body);
  return name !== undefined && INTERACTIVE_TOOLS.has(name);
}
