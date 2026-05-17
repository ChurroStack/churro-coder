/**
 * churro-coder MCP server factory.
 *
 * Phase 1 ships only `read_plan`. Future tools (read_memory, read_decision_log, etc.)
 * drop in as new files under `handlers/` with one-line registration here.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadPlanTool } from './handlers/read-plan';
import { registerWritePlanTool } from './handlers/write-plan';
import { registerReadReviewTool } from './handlers/read-review';
import { registerWriteReviewTool } from './handlers/write-review';
import { registerWriteTasksTool } from './handlers/write-tasks';
import { registerUpdateTaskStatusTool } from './handlers/update-task-status';
import { registerNotifyFilesChangedTool } from './handlers/notify-files-changed';
import { registerRequestUserInputTool } from './handlers/request-user-input';

function buildServer(opts: { boundSubChatId?: string }): McpServer {
  const server = new McpServer({ name: 'churro-coder', version: '0.1.0' });
  registerReadPlanTool(server, opts);
  registerWritePlanTool(server, opts);
  registerWriteReviewTool(server, opts);
  registerReadReviewTool(server, opts);
  registerWriteTasksTool(server, opts);
  registerUpdateTaskStatusTool(server, opts);
  registerNotifyFilesChangedTool(server, opts);
  registerRequestUserInputTool(server, opts);
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
