import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readCurrentReview } from '../../reviews/review-store';

export function registerReadReviewTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  const inputSchema = opts.boundSubChatId
    ? {
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Review revision to fetch. Only "current" is supported.')
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID for which to retrieve the review. ' +
              'The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        revision: z
          .literal('current')
          .optional()
          .default('current')
          .describe('Review revision to fetch. Only "current" is supported.')
      };

  server.registerTool(
    'read_review',
    {
      title: 'Read Review',
      description:
        'Retrieve the review document for the current sub-chat. ' +
        'Call this to consult the review before applying its suggestions. ' +
        (opts.boundSubChatId
          ? ''
          : 'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").'),
      inputSchema
    },
    async (input: { subChatId?: string; revision?: 'current' }) => {
      const id = opts.boundSubChatId ?? input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] read_review called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} revision=${input.revision ?? 'current'}`
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

      const review = await readCurrentReview(id);
      if (!review) {
        console.log('[churro-coder] read_review result sub=' + id + ' found=false bytes=0');
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No review has been recorded for this sub-chat yet. A review is written when the review phase completes.'
            }
          ],
          isError: true
        };
      }

      const header = [
        `# ${review.meta.title || 'Review'}`,
        `Source: ${review.meta.source} | Created: ${review.meta.createdAt}${review.meta.appliedAt ? ` | Applied: ${review.meta.appliedAt}` : ''}`,
        ''
      ].join('\n');

      console.log(
        `[churro-coder] read_review result sub=${id} found=true bytes=${Buffer.byteLength(review.content, 'utf8')}`
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: header + review.content
          }
        ]
      };
    }
  );
}
