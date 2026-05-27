import { useEffect, useRef } from 'react';
import { trpc } from '../../../lib/trpc';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { cliAutoRenameTriggered, shouldAutoRenameCliSubChat } from '../lib/auto-rename-state';
import { useAgentAutoRenameDispatcher } from './use-auto-rename-dispatcher';

const TRACE = '[cli-auto-rename]';

/**
 * Trigger the same generate-name → rename flow `ChatViewInner` uses, but on
 * the first user message ingested from the CLI's JSONL transcript — covering
 * both voice dispatch and direct CLI-TUI typing. The renderer-side prompt
 * bar no longer drives renames; the JSONL ingester is the single source of
 * "the user said something for the first time".
 *
 * Subscribes to `cliSession.onMessages` (the same event the conversation
 * pane already listens to for cache invalidation) so we don't add a second
 * watcher.
 */
export function useCliAutoRenameOnFirstMessage(subChatId: string, chatId?: string | null): void {
  const utils = trpc.useUtils();
  const storeParentChatId = useAgentSubChatStore((s) => s.chatId);
  // Respect an explicit `null` from the caller (means "no parent — disable
  // autorename"). Fall back to the store only when the caller omitted the arg
  // entirely.
  const parentChatId = chatId === undefined ? storeParentChatId : chatId;
  const dispatchAutoRename = useAgentAutoRenameDispatcher({ parentChatId: parentChatId ?? '' });
  // Hold the dispatcher in a ref so the subscription callback always reads the
  // latest closure without forcing the subscription to re-mount each render.
  const dispatchRef = useRef(dispatchAutoRename);
  dispatchRef.current = dispatchAutoRename;

  trpc.cliSession.onMessages.useSubscription(
    { subChatId },
    {
      enabled: Boolean(parentChatId),
      onData: () => {
        if (cliAutoRenameTriggered.has(subChatId)) return;

        const persistedName = useAgentSubChatStore
          .getState()
          .allSubChats.find((sc) => sc.id === subChatId)?.name;
        if (!shouldAutoRenameCliSubChat(subChatId, persistedName)) return;

        void utils.messages.getLatest
          .fetch({ subChatId, limit: 5 })
          .then((rows) => {
            if (cliAutoRenameTriggered.has(subChatId)) return;
            const firstUser = (rows ?? []).find((r) => r.role === 'user');
            if (!firstUser) return;
            const text = extractFirstUserText(firstUser.parts);
            if (!text) return;
            cliAutoRenameTriggered.add(subChatId);
            console.log(`${TRACE} dispatch sub=${subChatId} chars=${text.length}`);
            dispatchRef.current(text, subChatId);
          })
          .catch((err: unknown) => {
            console.warn(`${TRACE} fetch failed sub=${subChatId} err=${String(err)}`);
          });
      }
    }
  );

  // Effect kept for future symmetry with other lifecycle work — currently a no-op.
  useEffect(() => undefined, [subChatId]);
}

function extractFirstUserText(parts: unknown): string {
  let arr: unknown[];
  if (typeof parts === 'string') {
    try {
      const parsed = JSON.parse(parts);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return '';
    }
  } else if (Array.isArray(parts)) {
    arr = parts;
  } else {
    return '';
  }
  for (const p of arr) {
    if (p && typeof p === 'object' && (p as { type?: string }).type === 'text') {
      const text = (p as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return '';
}
