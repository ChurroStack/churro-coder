import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readCurrentPlan } from '../../plans/plan-store';

export function registerReadPlanTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  server.registerTool(
    'read_plan',
    {
      title: 'Read Plan',
      description:
        'Retrieve the approved plan for the current sub-chat. ' +
        'Call this whenever you need to consult the plan — including after compaction or a provider switch.',
      inputSchema: {
        subChatId: z
          .string()
          .optional()
          .describe('Sub-chat ID. Omit when the server is bound to a specific sub-chat (Claude).'),
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Plan revision to fetch. Only "current" is supported.')
      }
    },
    async (input) => {
      const id = opts.boundSubChatId ?? input.subChatId;
      if (!id) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: subChatId is required when the server is not bound to a specific sub-chat.'
            }
          ],
          isError: true
        };
      }

      const plan = await readCurrentPlan(id);
      if (!plan) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No plan has been recorded for this sub-chat yet. A plan is written when the planning phase completes.'
            }
          ],
          isError: true
        };
      }

      const header = [
        `# ${plan.meta.title || 'Approved Plan'}`,
        `Source: ${plan.meta.source} | Created: ${plan.meta.createdAt}${plan.meta.approvedAt ? ` | Approved: ${plan.meta.approvedAt}` : ''}`,
        ''
      ].join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: header + plan.content
          }
        ],
        structuredContent: plan.meta
      };
    }
  );
}
