/**
 * churro-coder MCP server factory.
 *
 * Phase 1 ships only `read_plan`. Future tools (read_memory, read_decision_log, etc.)
 * drop in as new files under `handlers/` with one-line registration here.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadPlanTool } from './handlers/read-plan';

function buildServer(opts: { boundSubChatId?: string }): McpServer {
  const server = new McpServer({ name: 'churro-coder', version: '0.1.0' });
  registerReadPlanTool(server, opts);
  // future: registerReadMemoryTool(server, opts);
  return server;
}

/** For Claude — subChatId is closed over; the agent never needs to pass it. */
export function createMcpServerForSubChat(subChatId: string): McpServer {
  return buildServer({ boundSubChatId: subChatId });
}

/** For Codex and HTTP transport — agent must pass subChatId in the tool args. */
export function createMcpServerStateless(): McpServer {
  return buildServer({});
}
