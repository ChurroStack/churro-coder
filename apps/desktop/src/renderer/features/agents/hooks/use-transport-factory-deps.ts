/**
 * `useTransportFactoryDeps` — builds the {@link TransportFactoryDeps} bag
 * for `transport-factory.getOrCreateChat`. Encapsulates the renderer's
 * side effects (transport instantiation, agentChatStore mutations,
 * onError/onFinish callbacks with audio/notification/scroll/diff-refresh
 * hooks) behind a single hook so `active-chat.tsx` doesn't carry the
 * ~250 LOC inline.
 *
 * **What this hook is:**
 *   - The renderer's wiring layer between the transport-factory FSM and
 *     the actual `Chat<any>` constructor + `agentChatStore`. The factory
 *     is pure orchestration (KEEP / CREATE / RECREATE); this hook
 *     supplies the side effects.
 *
 * **What it is NOT:**
 *   - A controller. It only builds deps. The caller decides when to
 *     invoke `getOrCreateChat(...)` and what to do with the result.
 *
 * **Layering:** lives in `hooks/`. Imports the transport classes +
 * stores + service interface. No tRPC calls — those are passed through
 * config (`utils.agents.getAgentChat.invalidate`).
 *
 * **Why a hook?** Before this extraction the deps block was ~280 LOC of
 * inline code in `ChatViewInner`. Pulling it out:
 *   - reduces `active-chat.tsx` LOC by the same amount;
 *   - makes the deps unit-testable (substitute mock transports);
 *   - documents the contract (what does the renderer need to provide
 *     for a transport-factory call?);
 *   - lets future component extracts that need to create transports
 *     reuse the same deps without re-deriving.
 *
 * **Memoization:** the deps object recomputes when any of the input
 * dependencies change. Most are stable (refs, store getters); the
 * exception is `agentSubChats` which updates per refetch, so the
 * deps will recompute then. This is harmless — the factory is called
 * imperatively, not subscribed to.
 */

import { useMemo } from 'react';
import { Chat } from '@ai-sdk/react';
import { useMessageQueueStore } from '../stores/message-queue-store';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { agentChatStore } from '../stores/agent-chat-store';
import { CodexChatTransport } from '../lib/codex-chat-transport';
import { IPCChatTransport } from '../lib/ipc-chat-transport';
import { RemoteChatTransport } from '../lib/remote-chat-transport';
import { getChatMessages, parseStoredMessages, shouldRecreateStaleRuntimeChat } from '../lib/chat-instance-helpers';
import { appStore } from '../../../lib/jotai-store';
import { soundNotificationsEnabledAtom } from '../../../lib/atoms';
import {
  agentFinishedTickAtomFamily,
  clearLoading,
  MODEL_ID_MAP,
  planEditRefetchTriggerAtomFamily,
  selectedAgentChatIdAtom,
  subChatModelIdAtomFamily
} from '../atoms';
import type { TransportFactoryDeps } from '../services/transport-factory';

/**
 * Subset of `agentSubChat` shape this hook reads. Defined here as a
 * structural type so the renderer can pass whatever it has (the actual
 * tRPC-derived type has dozens of fields we don't touch).
 */
export interface SubChatLike {
  id: string;
  name?: string | null;
  messages?: unknown;
  stream_id?: string | null;
}

export interface UseTransportFactoryDepsConfig {
  /** Parent chat id (used as a tag on agentChatStore.set + tRPC invalidate). */
  chatId: string;
  /** Path to the worktree on disk (cwd for IPCChatTransport / CodexChatTransport). */
  worktreePath: string | null | undefined;
  /** Original project path (for MCP config lookup; differs from worktreePath in worktree mode). */
  projectPath: string | undefined;
  /** Sandbox URL when chat is remote (`https://3003-${sandboxId}.e2b.app`). */
  chatSandboxUrl: string | null;
  /** Sub-chats from the parent chat query — used to look up `name`/`stream_id` in createChat. */
  agentSubChats: SubChatLike[];
  /** Parent chat metadata — used for the `notifyAgentComplete` title. */
  agentChat: { name?: string | null } | null | undefined;

  /** Sync transient runtime messages back into the tRPC cache after stream end. */
  syncFinishedMessagesToChatCache: (subChatId: string, chat: Chat<any>) => void;
  /** Evict the runtime chat once idle if user navigated away. */
  pruneIfDetachedAndIdle: (subChatId: string, parentChatId: string) => void;
  /** Stable ref to the loading-subchats setter — clearLoading is called against it. */
  setLoadingSubChats: (fn: (prev: Map<string, string>) => Map<string, string>) => void;
  /** Mark a sub-chat as having unseen changes (for tab dot indicator). */
  setSubChatUnseenChanges: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Mark the parent chat as having unseen changes (for sidebar dot). */
  setUnseenChanges: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Show the native completion notification (handles focus/preference checks). */
  notifyAgentComplete: (title: string) => void;
  /** Ref to the latest `fetchDiffStatsDebounced` so onFinish can call current. */
  fetchDiffStatsRef: React.MutableRefObject<() => void>;
  /** tRPC utils for invalidating queries after stream end (Codex provider only). */
  invalidateChatQuery: () => void;
  /** Invalidate widget-backing queries (changes, PR status) after stream end. */
  invalidateWidgetQueries: () => void;
}

export function useTransportFactoryDeps(config: UseTransportFactoryDepsConfig): TransportFactoryDeps<Chat<any>> {
  const {
    chatId,
    worktreePath,
    projectPath,
    chatSandboxUrl,
    agentSubChats,
    agentChat,
    syncFinishedMessagesToChatCache,
    pruneIfDetachedAndIdle,
    setLoadingSubChats,
    setSubChatUnseenChanges,
    setUnseenChanges,
    notifyAgentComplete,
    fetchDiffStatsRef,
    invalidateChatQuery,
    invalidateWidgetQueries
  } = config;

  return useMemo<TransportFactoryDeps<Chat<any>>>(
    () => ({
      readExistingChat: (id) => agentChatStore.get(id) ?? null,
      readChatMessages: (chat) => getChatMessages(chat) as unknown[],
      readPersistedMessages: (id) => {
        const sc = agentSubChats.find((s) => s.id === id);
        return parseStoredMessages(sc?.messages);
      },
      isStreaming: (id) => {
        const existing = agentChatStore.get(id);
        const existingStatus = (existing as { status?: string } | undefined)?.status;
        if (existingStatus === 'streaming' || existingStatus === 'submitted') {
          return true;
        }
        if (existingStatus == null) {
          return useStreamingStatusStore.getState().isStreaming(id);
        }
        return false;
      },
      hasQueue: (id) => (useMessageQueueStore.getState().queues[id]?.length ?? 0) > 0,
      isStaleRuntime: (existingMessages, persistedMessages) =>
        shouldRecreateStaleRuntimeChat(
          existingMessages as Parameters<typeof shouldRecreateStaleRuntimeChat>[0],
          persistedMessages as Parameters<typeof shouldRecreateStaleRuntimeChat>[1]
        ),
      getExistingProvider: (chat) =>
        (chat as unknown as { transport?: unknown })?.transport instanceof CodexChatTransport ? 'codex' : 'claude-code',
      deleteExistingChat: (id) => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[transport-factory] Recreating stale/cross-provider chat', {
            subChatId: id.slice(-8)
          });
        }
        agentChatStore.delete(id);
      },
      storeChat: (id, chat) => {
        const sc = agentSubChats.find((s) => s.id === id);
        agentChatStore.set(id, chat, chatId);
        // Store streamId at creation time to prevent resume during active
        // streaming. tRPC refetch updates stream_id in DB; store stays stable.
        agentChatStore.setStreamId(id, sc?.stream_id || null);
      },
      log: (msg) => {
        if (process.env.NODE_ENV === 'development') {
          console.log(msg);
        }
      },
      createChat: ({ subChatId: id, provider, isRemote }, persistedMessages) => {
        const sc = agentSubChats.find((s) => s.id === id);
        const messages = persistedMessages as ReturnType<typeof parseStoredMessages>;
        const chatInstanceId = agentChatStore.nextChatInstanceId(id, messages.length);

        let transport: IPCChatTransport | RemoteChatTransport | CodexChatTransport | null = null;

        if (isRemote && chatSandboxUrl) {
          const subChatName = sc?.name || 'Chat';
          const selectedModelId = appStore.get(subChatModelIdAtomFamily(id));
          const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP['opus'];
          console.log('[getOrCreateChat] Using RemoteChatTransport', {
            sandboxUrl: chatSandboxUrl,
            model: modelString
          });
          transport = new RemoteChatTransport({
            chatId,
            subChatId: id,
            subChatName,
            sandboxUrl: chatSandboxUrl,
            model: modelString
          });
        } else if (worktreePath) {
          if (provider === 'codex') {
            console.log('[getOrCreateChat] Using CodexChatTransport', { provider });
            transport = new CodexChatTransport({
              chatId,
              subChatId: id,
              cwd: worktreePath,
              projectPath,
              provider: 'codex'
            });
          } else {
            transport = new IPCChatTransport({
              chatId,
              subChatId: id,
              cwd: worktreePath,
              projectPath
            });
          }
        }

        if (!transport) {
          // Factory contract: createChat MUST return a Chat. Throw so
          // the outer caller's try/catch returns null, mirroring the
          // legacy "no transport available" branch.
          throw new Error('[transport-factory] No transport available');
        }

        // newChat is captured in closure for onError/onFinish so
        // `syncFinishedMessagesToChatCache(id, newChat)` can pass the
        // instance back through itself.
        // eslint-disable-next-line prefer-const
        let newChat: Chat<any>;
        newChat = new Chat<any>({
          id: chatInstanceId,
          messages,
          transport,
          onError: () => {
            useStreamingStatusStore.getState().setStatus(id, 'ready');
            syncFinishedMessagesToChatCache(id, newChat);
            pruneIfDetachedAndIdle(id, chatId);
          },
          onFinish: () => {
            clearLoading(setLoadingSubChats, id);
            useStreamingStatusStore.getState().setStatus(id, 'ready');
            syncFinishedMessagesToChatCache(id, newChat);
            if (provider === 'codex') {
              invalidateChatQuery();
            }

            const wasManuallyAborted = agentChatStore.wasManuallyAborted(id);
            agentChatStore.clearManuallyAborted(id);

            // Read current values, NOT stale closure values
            const currentActiveSubChatId = useAgentSubChatStore.getState().activeSubChatId;
            const currentSelectedChatId = appStore.get(selectedAgentChatIdAtom);
            const isViewingThisSubChat = currentActiveSubChatId === id;
            const isViewingThisChat = currentSelectedChatId === chatId;

            if (!isViewingThisSubChat) {
              setSubChatUnseenChanges((prev: Set<string>) => {
                const next = new Set(prev);
                next.add(id);
                return next;
              });
            }

            if (!isViewingThisChat) {
              setUnseenChanges((prev: Set<string>) => {
                const next = new Set(prev);
                next.add(chatId);
                return next;
              });

              // Play completion sound only if NOT manually aborted and sound enabled
              if (!wasManuallyAborted) {
                const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom);
                if (isSoundEnabled) {
                  try {
                    const audio = new Audio('./sound.mp3');
                    audio.volume = 1.0;
                    audio.play().catch(() => {});
                  } catch {
                    // Ignore audio errors
                  }
                }
              }
            }

            // Native notification (hook handles focus/preference checks)
            if (!wasManuallyAborted) {
              notifyAgentComplete(agentChat?.name || 'Agent');
            }

            // Refresh diff stats after agent finishes making changes
            fetchDiffStatsRef.current();

            // Broadcast "agent finished" so subscribed widgets refresh.
            // Always fire — even on manual abort the agent may have left
            // changes (file edits, partial PR creation, etc.) worth fetching.
            appStore.set(agentFinishedTickAtomFamily(id));
            appStore.set(agentFinishedTickAtomFamily(chatId));
            invalidateWidgetQueries();
            // Bump plan-refetch trigger so Plan widget re-reads file
            // content on every finish (covers Write-not-Edit cases the
            // tool-call detector misses).
            appStore.set(planEditRefetchTriggerAtomFamily(id));

            pruneIfDetachedAndIdle(id, chatId);

            // Note: sidebar timestamp update is handled via optimistic
            // update in handleSend; refetching here would overwrite it.
          }
        });

        return newChat;
      }
    }),
    [
      chatId,
      worktreePath,
      projectPath,
      chatSandboxUrl,
      agentSubChats,
      agentChat,
      syncFinishedMessagesToChatCache,
      pruneIfDetachedAndIdle,
      setLoadingSubChats,
      setSubChatUnseenChanges,
      setUnseenChanges,
      notifyAgentComplete,
      fetchDiffStatsRef,
      invalidateChatQuery,
      invalidateWidgetQueries
    ]
  );
}
