import { EventEmitter } from 'node:events';

export type CliUserQuestionEntry = {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
};

export type CliUserQuestionEvent = {
  requestId: string;
  subChatId: string;
  questions: CliUserQuestionEntry[];
};

type PendingEntry = {
  subChatId: string;
  resolve: (answers: Record<string, string> | null) => void;
  reject: (err: Error) => void;
};

export const pendingCliQuestions = new Map<string, PendingEntry>();

const emitter = new EventEmitter();

export function emitCliUserQuestion(event: CliUserQuestionEvent): void {
  emitter.emit('cli-user-question', event);
}

export function onCliUserQuestion(handler: (event: CliUserQuestionEvent) => void): () => void {
  emitter.on('cli-user-question', handler);
  return () => emitter.off('cli-user-question', handler);
}

export function rejectAllForSubChat(subChatId: string, reason: string): void {
  for (const [requestId, entry] of pendingCliQuestions) {
    if (entry.subChatId === subChatId) {
      entry.reject(new Error(reason));
      pendingCliQuestions.delete(requestId);
      console.log(`[mcp:request_user_input] teardown-reject requestId=${requestId} sub=${subChatId} reason=${reason}`);
    }
  }
}
