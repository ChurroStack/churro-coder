import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractPlanTitleFromContent, writeCurrentPlan } from '../../plans/plan-store';

export function registerWritePlanTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  const inputSchema: Record<string, z.ZodTypeAny> = opts.boundSubChatId
    ? {
        markdown: z.string().min(1).describe('The full plan document in markdown format.'),
        title: z.string().optional().describe('Short title for the plan. Inferred from the first # heading if omitted.')
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        markdown: z.string().min(1).describe('The full plan document in markdown format.'),
        title: z.string().optional().describe('Short title for the plan. Inferred from the first # heading if omitted.')
      };

  server.registerTool(
    'write_plan',
    {
      title: 'Write Plan',
      description:
        'Persist the latest plan document for this session even before it gets approved. ' +
        'ALWAYS call this whenever you create or significantly update a plan so the user can see it in the plan panel and can easily read it. ' +
        (opts.boundSubChatId
          ? ''
          : 'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").'),
      inputSchema
    },
    async (rawInput: Record<string, unknown>) => {
      const input = rawInput as { subChatId?: string; markdown: string; title?: string };
      const id = opts.boundSubChatId ?? input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] write_plan called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} bytes=${Buffer.byteLength(input.markdown, 'utf8')}`
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

      const title = input.title?.trim() || extractPlanTitleFromContent(input.markdown);

      await writeCurrentPlan({
        subChatId: id,
        content: input.markdown,
        source: opts.boundSubChatId ? 'claude-sdk' : 'codex-http',
        title
      });

      console.log(
        `[churro-coder] write_plan result sub=${id} title="${title}" bytes=${Buffer.byteLength(input.markdown, 'utf8')}`
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Plan "${title}" has been saved. The user can now see it in the plan panel.`
          }
        ]
      };
    }
  );
}
