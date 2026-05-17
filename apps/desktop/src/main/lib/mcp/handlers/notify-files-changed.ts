import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { notifyFilesChanged, type FileChangeAction } from '../../file-changes/file-changes-store';
import { SUB_CHAT_ID_MISSING_ERROR, subChatIdRequirementBlurb } from './sub-chat-id-helper';

const fileChangeEntrySchema = z.object({
  path: z.string().min(1).describe('Absolute path (or repo-relative) of the file you created/modified/deleted.'),
  action: z.enum(['create', 'update', 'delete']).describe('What you did to the file.')
});

export function registerNotifyFilesChangedTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  const inputSchema: Record<string, z.ZodTypeAny> = opts.boundSubChatId
    ? {
        files: z
          .array(fileChangeEntrySchema)
          .min(1)
          .describe('Files you created, modified, or deleted. Batch multiple files in one call.')
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        files: z
          .array(fileChangeEntrySchema)
          .min(1)
          .describe('Files you created, modified, or deleted. Batch multiple files in one call.')
      };

  server.registerTool(
    'notify_files_changed',
    {
      title: 'Notify Files Changed',
      description:
        `Report every file you create, modify, or delete during this session. Call this immediately after any successful write/edit/delete (batch multiple files in one call if you did them together). The host app uses these paths to attribute changes to this sub-chat in the Changes widget. ` +
        subChatIdRequirementBlurb(opts.boundSubChatId),
      inputSchema
    },
    async (rawInput: Record<string, unknown>) => {
      const input = rawInput as {
        subChatId?: string;
        files: Array<{ path: string; action: FileChangeAction }>;
      };
      const id = opts.boundSubChatId ?? input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] notify_files_changed called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} count=${input.files?.length ?? 0}`
      );

      if (!id) {
        return SUB_CHAT_ID_MISSING_ERROR;
      }

      await notifyFilesChanged({
        subChatId: id,
        files: input.files,
        source: opts.boundSubChatId ? 'claude-sdk' : 'codex-http'
      });

      const summary = input.files.map((f) => `${f.action}:${f.path}`).join(', ');
      console.log(`[churro-coder] notify_files_changed result sub=${id} count=${input.files.length} files=${summary}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Recorded ${input.files.length} file change(s): ${summary}`
          }
        ]
      };
    }
  );
}
