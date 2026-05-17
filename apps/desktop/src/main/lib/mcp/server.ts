/**
 * churro-coder MCP server factory.
 *
 * Single shared server: one logical MCP entry registered in Claude/Codex
 * config, one factory invocation per HTTP request. Every tool requires
 * `subChatId` as an argument; the value is injected into the CLI context
 * via the bootstrap layer (system prompt, first-turn reminder, dispatcher
 * messages — see `apps/desktop/src/main/lib/cli-harness/index.ts` and
 * `apps/desktop/src/renderer/features/agents/hooks/use-harness-send-dispatcher.ts`).
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

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'churro-coder', version: '0.1.0' });
  registerReadPlanTool(server);
  registerWritePlanTool(server);
  registerWriteReviewTool(server);
  registerReadReviewTool(server);
  registerWriteTasksTool(server);
  registerUpdateTaskStatusTool(server);
  registerNotifyFilesChangedTool(server);
  registerRequestUserInputTool(server);
  return server;
}
