import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readCurrentPlan } from '../../plans/plan-store';

export function registerReadPlanTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  // Schema branches on bound vs unbound:
  //  - bound (Claude per-turn SDK instance): subChatId is closed over, the agent
  //    must NOT pass it. Schema omits the field so the agent doesn't see it.
  //  - unbound (Codex via HTTP transport): the agent MUST pass subChatId. Schema
  //    marks it required so the model's tool-call layer doesn't silently drop it
  //    when the model neglects to read the prompt-side hint.
  const inputSchema = opts.boundSubChatId
    ? {
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Plan revision to fetch. Only "current" is supported.')
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID for which to retrieve the approved plan. ' +
              'The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Plan revision to fetch. Only "current" is supported.')
      };

  server.registerTool(
    'read_plan',
    {
      title: 'Read Plan',
      description:
        'Retrieve the approved plan for the current sub-chat. ' +
        'Call this whenever you need to consult the plan — including after compaction or a provider switch. ' +
        (opts.boundSubChatId
          ? ''
          : 'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").'),
      inputSchema
    },
    async (input: { subChatId?: string; revision?: 'current' }) => {
      const id = opts.boundSubChatId ?? input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] read_plan called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} revision=${input.revision ?? 'current'}`
      );
      if (!id) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: subChatId is required. The host app provides it in the prompt context as "Sub-chat id: <value>" — pass that value as the subChatId argument.'
            }
          ],
          isError: true
        };
      }

      const plan = await readCurrentPlan(id);
      if (!plan) {
        console.log('[churro-coder] read_plan result sub=' + id + ' found=false bytes=0');
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

      console.log(
        `[churro-coder] read_plan result sub=${id} found=true bytes=${Buffer.byteLength(plan.content, 'utf8')}`
      );

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
