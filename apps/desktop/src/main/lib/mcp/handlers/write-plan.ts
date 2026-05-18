import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractPlanTitleFromContent, writeCurrentPlan } from '../../plans/plan-store';
import { SUB_CHAT_ID_MISSING_ERROR, requireKnownSubChatId } from './sub-chat-id-helper';

export function registerWritePlanTool(server: McpServer): void {
  server.registerTool(
    'write_plan',
    {
      title: 'Write Plan',
      description:
        'Persist the latest plan document for this session even before it gets approved. ' +
        'ALWAYS call this whenever you create or significantly update a plan so the user can see it in the plan panel and can easily read it. ' +
        'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").',
      inputSchema: {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        markdown: z.string().min(1).describe('The full plan document in markdown format.'),
        title: z.string().optional().describe('Short title for the plan. Inferred from the first # heading if omitted.')
      }
    },
    async (rawInput: Record<string, unknown>) => {
      const input = rawInput as { subChatId?: string; markdown: string; title?: string };
      const id = input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] write_plan called sub=${id ?? 'missing'} inputKeys=${inputKeys} bytes=${Buffer.byteLength(input.markdown, 'utf8')}`
      );

      if (!id) return SUB_CHAT_ID_MISSING_ERROR;
      const check = requireKnownSubChatId(id);
      if (!check.ok) return check.errorContent;

      const title = input.title?.trim() || extractPlanTitleFromContent(input.markdown);

      await writeCurrentPlan({
        subChatId: id,
        content: input.markdown,
        source: 'mcp',
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
