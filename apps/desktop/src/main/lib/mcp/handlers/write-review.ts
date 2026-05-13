import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractReviewTitleFromContent, writeCurrentReview } from '../../reviews/review-store';

export function registerWriteReviewTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  const inputSchema: Record<string, z.ZodTypeAny> = opts.boundSubChatId
    ? {
        markdown: z.string().min(1).describe('The full review document in markdown format.'),
        title: z
          .string()
          .optional()
          .describe('Short title for the review. Inferred from the first # heading if omitted.')
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        markdown: z.string().min(1).describe('The full review document in markdown format.'),
        title: z
          .string()
          .optional()
          .describe('Short title for the review. Inferred from the first # heading if omitted.')
      };

  server.registerTool(
    'write_review',
    {
      title: 'Write Review',
      description:
        'Persist a completed code review document for the current sub-chat. ' +
        'Call this once when your review analysis is complete. ' +
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
        `[churro-coder] write_review called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} bytes=${Buffer.byteLength(input.markdown, 'utf8')}`
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

      const title = input.title?.trim() || extractReviewTitleFromContent(input.markdown);

      await writeCurrentReview({
        subChatId: id,
        content: input.markdown,
        source: opts.boundSubChatId ? 'claude-sdk' : 'codex-http',
        title
      });

      console.log(
        `[churro-coder] write_review result sub=${id} title="${title}" bytes=${Buffer.byteLength(input.markdown, 'utf8')}`
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Review "${title}" has been saved. The user can now see it in the review panel.`
          }
        ]
      };
    }
  );
}
