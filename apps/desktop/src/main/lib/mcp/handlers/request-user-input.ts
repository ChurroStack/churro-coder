import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { SUB_CHAT_ID_MISSING_ERROR, requireKnownSubChatId } from './sub-chat-id-helper';
import {
  emitCliUserQuestion,
  emitCliUserQuestionExpired,
  registerPendingCliQuestion,
  supersedeForSubChat,
  pendingCliQuestions
} from '../pending-cli-questions';
import { ASK_USER_QUESTION_TIMEOUT_MS, QUESTIONS_TIMED_OUT_MESSAGE } from '../../../../shared/ask-user-question';

export const USER_SKIPPED_MARKER = '<USER_SKIPPED>';

/**
 * Fire our own backstop a hair before the configured window so the clean
 * "timed out, you may ask again" result reaches claude-code BEFORE its own
 * logical tool timeout (set to the same window via the per-server `timeout`
 * in the CLI's --mcp-config file) hard-aborts the call.
 */
const BACKSTOP_MARGIN_MS = 5_000;
const QUESTION_BACKSTOP_MS = Math.max(1_000, ASK_USER_QUESTION_TIMEOUT_MS - BACKSTOP_MARGIN_MS);

/**
 * Periodic keepalive interval. The tool holds the HTTP/SSE response open for the
 * whole human-answer window; claude-code's transport aborts an idle body stream
 * (undici body-idle timeout, ~minutes). Emitting a notification on this request's
 * stream every interval keeps bytes flowing so the stream is never idle. This
 * keeps the TRANSPORT alive; it does not extend the logical tool timeout.
 */
const KEEPALIVE_INTERVAL_MS = 25_000;

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
    (rawInput: Record<string, unknown>, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
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

      return new Promise<{ content: Array<{ type: 'text'; text: string }> }>((resolvePromise, rejectPromise) => {
        let settled = false;
        let backstopTimer: ReturnType<typeof setTimeout> | undefined;
        let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

        const cleanup = () => {
          if (backstopTimer) clearTimeout(backstopTimer);
          if (keepaliveTimer) clearInterval(keepaliveTimer);
          backstopTimer = undefined;
          keepaliveTimer = undefined;
          pendingCliQuestions.delete(requestId);
        };

        // The user answered (or skipped). Happy path — no lifecycle event; the
        // renderer clears its widget once it sees ok:true from the resolve call.
        const onAnswer = (answers: Record<string, string> | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (answers === null) {
            console.log(`[mcp:request_user_input] skipped requestId=${requestId} sub=${subChatId}`);
            resolvePromise({ content: [{ type: 'text' as const, text: USER_SKIPPED_MARKER }] });
          } else {
            console.log(`[mcp:request_user_input] resolved requestId=${requestId} sub=${subChatId}`);
            resolvePromise({ content: [{ type: 'text' as const, text: JSON.stringify(answers) }] });
          }
        };

        // Teardown / supersede (sub-chat closing). Reject the call; the store
        // already emits the `cleared` UI event from rejectAll/supersede.
        const onReject = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          console.log(
            `[mcp:request_user_input] rejected requestId=${requestId} sub=${subChatId} reason=${err.message}`
          );
          rejectPromise(err);
        };

        // Our backstop fired: the user did not answer in time. Return a clean,
        // re-askable result to the agent and flip the widget to "Expired".
        const onTimeout = () => {
          if (settled) return;
          settled = true;
          cleanup();
          console.log(`[mcp:request_user_input] expired requestId=${requestId} sub=${subChatId}`);
          emitCliUserQuestionExpired({ requestId, subChatId });
          resolvePromise({ content: [{ type: 'text' as const, text: QUESTIONS_TIMED_OUT_MESSAGE }] });
        };

        // claude-code abandoned the call (its own timeout / cancel / stream
        // close). Flip the widget to "Expired" and stop blocking.
        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          console.log(
            `[mcp:request_user_input] aborted requestId=${requestId} sub=${subChatId} reason=${describeAbort(extra.signal)}`
          );
          emitCliUserQuestionExpired({ requestId, subChatId });
          rejectPromise(new Error('request_user_input aborted by client'));
        };

        // Supersede any earlier outstanding question for this sub-chat first.
        supersedeForSubChat(subChatId, requestId, 'superseded-by-new-question');

        registerPendingCliQuestion(requestId, {
          subChatId,
          questions: input.questions,
          resolve: onAnswer,
          reject: onReject
        });

        if (extra.signal.aborted) {
          onAbort();
          return;
        }
        extra.signal.addEventListener('abort', onAbort, { once: true });

        backstopTimer = setTimeout(onTimeout, QUESTION_BACKSTOP_MS);

        // Keep the SSE body stream from going idle while the human thinks.
        let keepaliveTick = 0;
        keepaliveTimer = setInterval(() => {
          if (settled) return;
          keepaliveTick += 1;
          void sendKeepalive(extra, keepaliveTick);
        }, KEEPALIVE_INTERVAL_MS);

        console.log(`[mcp:request_user_input] emit requestId=${requestId} sub=${subChatId}`);
        emitCliUserQuestion({ requestId, subChatId, questions: input.questions });
      });
    }
  );
}

/**
 * Emit one byte on this request's SSE stream. Prefer a progress notification
 * when the client supplied a progressToken (progress is monotonically
 * increasing so clients don't coalesce flat values); otherwise a logging
 * notification (works because `createMcpServer` advertises the `logging`
 * capability). Either way the client receives bytes and the body stream stays
 * non-idle. Failures are swallowed: keepalive is best-effort and must never
 * reject the waiting tool call.
 */
async function sendKeepalive(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  tick: number
): Promise<void> {
  try {
    const progressToken = (extra._meta as { progressToken?: string | number } | undefined)?.progressToken;
    if (progressToken !== undefined) {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: tick, message: 'Awaiting user input…' }
      });
    } else {
      await extra.sendNotification({
        method: 'notifications/message',
        params: { level: 'debug', data: 'request_user_input: awaiting user input' }
      });
    }
  } catch {
    // best-effort keepalive
  }
}

function describeAbort(signal: AbortSignal): string {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return 'closed';
}
