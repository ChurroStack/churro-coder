import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeTasks, type TaskStatus } from '../../tasks/task-store';

const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

const planTaskSchema = z.object({
  id: z.string().min(1).describe('Stable short identifier for this task (e.g. "step-1", "impl-auth").'),
  title: z.string().min(1).describe('Human-readable task title.'),
  status: taskStatusSchema.describe('Initial status — use "pending" for all tasks at the start.')
});

export function registerWriteTasksTool(server: McpServer, opts: { boundSubChatId?: string }): void {
  const inputSchema: Record<string, z.ZodTypeAny> = opts.boundSubChatId
    ? {
        tasks: z
          .array(planTaskSchema)
          .min(1)
          .describe('Full task list. Replaces the existing list atomically.')
          .refine((tasks) => new Set(tasks.map((t) => t.id)).size === tasks.length, {
            message: 'Duplicate task ids are not allowed.'
          })
      }
    : {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        tasks: z
          .array(planTaskSchema)
          .min(1)
          .describe('Full task list. Replaces the existing list atomically.')
          .refine((tasks) => new Set(tasks.map((t) => t.id)).size === tasks.length, {
            message: 'Duplicate task ids are not allowed.'
          })
      };

  server.registerTool(
    'write_tasks',
    {
      title: 'Write Tasks',
      description:
        'Publish (or replace) the plan task list for this session. ' +
        'Call once at the start of implementation with all plan steps as "pending" tasks. ' +
        'Call again only if the structure changes (new tasks discovered, tasks dropped or retitled). ' +
        'Use update_task_status to flip individual task statuses without re-sending the whole list. ' +
        (opts.boundSubChatId
          ? ''
          : 'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").'),
      inputSchema
    },
    async (rawInput: Record<string, unknown>) => {
      const input = rawInput as { subChatId?: string; tasks: Array<{ id: string; title: string; status: TaskStatus }> };
      const id = opts.boundSubChatId ?? input.subChatId;
      const inputKeys = Object.keys(input).join(',') || 'none';
      console.log(
        `[churro-coder] write_tasks called sub=${id ?? 'missing'} bound=${Boolean(opts.boundSubChatId)} inputKeys=${inputKeys} count=${input.tasks?.length ?? 0}`
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

      await writeTasks({
        subChatId: id,
        tasks: input.tasks,
        source: opts.boundSubChatId ? 'claude-sdk' : 'codex-http'
      });

      const byStatus = { pending: 0, in_progress: 0, completed: 0 };
      for (const t of input.tasks) byStatus[t.status]++;

      const summary = `pending:${byStatus.pending} in_progress:${byStatus.in_progress} completed:${byStatus.completed}`;
      console.log(`[churro-coder] write_tasks result sub=${id} count=${input.tasks.length} ${summary}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Task list saved: ${input.tasks.length} task(s) (${summary}). Use update_task_status to mark individual tasks as in_progress or completed.`
          }
        ]
      };
    }
  );
}
