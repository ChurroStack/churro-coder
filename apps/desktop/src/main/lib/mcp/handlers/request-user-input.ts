import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { SUB_CHAT_ID_MISSING_ERROR, requireKnownSubChatId } from './sub-chat-id-helper';
import { pendingCliQuestions, emitCliUserQuestion } from '../pending-cli-questions';

export const USER_SKIPPED_MARKER = '<USER_SKIPPED>';

const optionSchema = z.object({
  label: z.string().min(1).describe('Short option label shown to the user.'),
  description: z.string().describe('Explanation of what this option means.')
});

const questionSchema = z.object({
  question: z.string().min(1).describe('The question to ask the user.'),
  header: z.string().max(12).describe('Very short label shown as a chip (max 12 chars).'),
  options: z.array(optionSchema).min(2).max(4).describe('Available choices (2-4).'),
  multiSelect: z.boolean().describe('If true, the user can pick multiple options.')
});

export function registerRequestUserInputTool(server: McpServer): void {
  server.registerTool(
    'request_user_input',
    {
      title: 'Request User Input',
      description:
        'Ask the user 1-4 structured questions via the host UI. The host renders the questions as a widget above the CLI prompt bar; the user selects options and submits. The tool blocks until the user answers or skips — do NOT call it for information you already have. Use this instead of prompting via the terminal whenever you need a clarification or decision from the user. You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").',
      inputSchema: {
        subChatId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The sub-chat ID. The host app provides this in the prompt context as "Sub-chat id: <value>".'
          ),
        questions: z.array(questionSchema).min(1).max(4).describe('1-4 questions to present to the user.')
      }
    },
    (rawInput: Record<string, unknown>) => {
      const input = rawInput as {
        subChatId?: string;
        questions: Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description: string }>;
          multiSelect: boolean;
        }>;
      };
      const subChatId = input.subChatId;
      console.log(
        `[mcp:request_user_input] invoked sub=${subChatId ?? 'missing'} questionCount=${input.questions?.length ?? 0}`
      );

      if (!subChatId) return Promise.resolve(SUB_CHAT_ID_MISSING_ERROR);
      const check = requireKnownSubChatId(subChatId);
      if (!check.ok) return Promise.resolve(check.errorContent);

      const requestId = randomUUID();

      return new Promise<{ content: Array<{ type: 'text'; text: string }> }>((resolve, reject) => {
        pendingCliQuestions.set(requestId, {
          subChatId,
          resolve: (answers) => {
            if (answers === null) {
              console.log(`[mcp:request_user_input] skipped requestId=${requestId} sub=${subChatId}`);
              resolve({ content: [{ type: 'text' as const, text: USER_SKIPPED_MARKER }] });
            } else {
              console.log(`[mcp:request_user_input] resolved requestId=${requestId} sub=${subChatId}`);
              resolve({ content: [{ type: 'text' as const, text: JSON.stringify(answers) }] });
            }
          },
          reject: (err) => {
            console.log(
              `[mcp:request_user_input] rejected requestId=${requestId} sub=${subChatId} reason=${err.message}`
            );
            reject(err);
          }
        });

        console.log(`[mcp:request_user_input] emit requestId=${requestId} sub=${subChatId}`);
        emitCliUserQuestion({ requestId, subChatId, questions: input.questions });
      });
    }
  );
}
