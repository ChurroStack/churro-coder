import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { updateTaskStatus } from '../../tasks/task-store';
import { SUB_CHAT_ID_MISSING_ERROR, requireKnownSubChatId } from './sub-chat-id-helper';

const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

export function registerUpdateTaskStatusTool(server: McpServer): void {
  server.registerTool(
    'update_task_status',
    {
      title: 'Update Task Status',
      description:
        'Flip a single task\'s status. Call with status:"in_progress" before starting a task; call with status:"completed" after finishing it. The task must already exist in the list published by write_tasks. You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").',
      inputSchema: {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        id: z.string().min(1).describe('The stable task id assigned when write_tasks was called.'),
        status: taskStatusSchema.describe('New status for the task.')
      }
    },
    async (rawInput: Record<string, unknown>) => {
      const input = rawInput as { subChatId?: string; id: string; status: 'pending' | 'in_progress' | 'completed' };
      const id = input.subChatId;
      console.log(
        `[churro-coder] update_task_status called sub=${id ?? 'missing'} taskId=${input.id} status=${input.status}`
      );

      if (!id) return SUB_CHAT_ID_MISSING_ERROR;
      const check = requireKnownSubChatId(id);
      if (!check.ok) return check.errorContent;

      const result = await updateTaskStatus({
        subChatId: id,
        id: input.id,
        status: input.status,
        source: 'mcp'
      });

      if (!result.ok) {
        const text =
          result.reason === 'unknown-id'
            ? `Task id \`${input.id}\` not found. Call \`write_tasks\` to (re)publish the full list before marking individual tasks.`
            : `No task list exists yet for this sub-chat. Call \`write_tasks\` first.`;
        console.log(`[churro-coder] update_task_status error sub=${id} taskId=${input.id} reason=${result.reason}`);
        return { content: [{ type: 'text' as const, text }], isError: true };
      }

      console.log(`[churro-coder] update_task_status result sub=${id} taskId=${input.id} status=${input.status}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Task \`${input.id}\` is now ${input.status}.`
          }
        ]
      };
    }
  );
}
