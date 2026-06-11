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

/**
 * Lifecycle event for a pending CLI question that is going away. Carries the
 * `requestId` so the renderer can guard against acting on a stale event: a
 * superseded question's late expiry must NOT expire the fresh one that replaced
 * it in the UI (both share a subChatId, only the requestId differs).
 *
 * - `expired`: the host's backstop fired or claude-code abandoned the call. The
 *   widget flips to a disabled "Expired" state (the agent may ask again).
 * - `cleared`: teardown (terminal exit / sub-chat delete) or supersede. The
 *   widget is removed outright.
 */
export type CliUserQuestionLifecycleEvent = {
  requestId: string;
  subChatId: string;
};

type PendingEntry = {
  subChatId: string;
  /** The questions, retained so a remounting panel can rehydrate the widget. */
  questions: CliUserQuestionEntry[];
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

export function emitCliUserQuestionExpired(event: CliUserQuestionLifecycleEvent): void {
  emitter.emit('cli-user-question-expired', event);
}

export function onCliUserQuestionExpired(handler: (event: CliUserQuestionLifecycleEvent) => void): () => void {
  emitter.on('cli-user-question-expired', handler);
  return () => emitter.off('cli-user-question-expired', handler);
}

export function emitCliUserQuestionCleared(event: CliUserQuestionLifecycleEvent): void {
  emitter.emit('cli-user-question-cleared', event);
}

export function onCliUserQuestionCleared(handler: (event: CliUserQuestionLifecycleEvent) => void): () => void {
  emitter.on('cli-user-question-cleared', handler);
  return () => emitter.off('cli-user-question-cleared', handler);
}

/**
 * Register a pending question. The handler owns the resolve/reject; this also
 * stores the questions so {@link getPendingForSubChat} can rehydrate a panel
 * that remounts while the question is still outstanding.
 */
export function registerPendingCliQuestion(requestId: string, entry: PendingEntry): void {
  pendingCliQuestions.set(requestId, entry);
}

/**
 * The current outstanding question for a sub-chat (most recently registered),
 * or null. Used by the renderer to rehydrate the widget on mount — the
 * cli-user-question event only fires once, so a panel that mounts after it was
 * emitted (close→reopen, app restart of the renderer) would otherwise miss it.
 */
export function getPendingForSubChat(subChatId: string): CliUserQuestionEvent | null {
  let latest: { requestId: string; entry: PendingEntry } | null = null;
  for (const [requestId, entry] of pendingCliQuestions) {
    if (entry.subChatId === subChatId) {
      latest = { requestId, entry };
    }
  }
  if (!latest) return null;
  return { requestId: latest.requestId, subChatId, questions: latest.entry.questions };
}

/**
 * Supersede any outstanding questions for a sub-chat before a new one is shown.
 * Rejects the old MCP calls (they are abandoned) and tells the UI to clear the
 * stale widget so it doesn't briefly show two questions.
 */
export function supersedeForSubChat(subChatId: string, exceptRequestId: string, reason: string): void {
  for (const [requestId, entry] of pendingCliQuestions) {
    if (entry.subChatId === subChatId && requestId !== exceptRequestId) {
      entry.reject(new Error(reason));
      pendingCliQuestions.delete(requestId);
      emitCliUserQuestionCleared({ requestId, subChatId });
      console.log(`[mcp:request_user_input] supersede-clear requestId=${requestId} sub=${subChatId} reason=${reason}`);
    }
  }
}

/**
 * Teardown path (terminal exit / sub-chat delete). Rejects all pending calls
 * for the sub-chat and clears their widgets outright (NOT an expire — the
 * sub-chat is going away, the agent won't re-ask).
 */
export function rejectAllForSubChat(subChatId: string, reason: string): void {
  for (const [requestId, entry] of pendingCliQuestions) {
    if (entry.subChatId === subChatId) {
      entry.reject(new Error(reason));
      pendingCliQuestions.delete(requestId);
      emitCliUserQuestionCleared({ requestId, subChatId });
      console.log(`[mcp:request_user_input] teardown-reject requestId=${requestId} sub=${subChatId} reason=${reason}`);
    }
  }
}
