import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { api } from '../../../lib/mock-api';
import { selectedOllamaModelAtom, selectedTeamIdAtom } from '../../../lib/atoms';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { autoRenameAgentChat } from '../utils/auto-rename';
import { getFirstSubChatId } from '../utils/first-sub-chat';

interface AutoRenameDispatcherOptions {
  parentChatId: string;
}

export type AutoRenameDispatcher = (userMessage: string, subChatId: string) => void;

/**
 * Returns a stable `(userMessage, subChatId) => void` that runs the same
 * generate-name-then-rename flow `ChatView` has owned for builtin sub-chats.
 *
 * Extracted from active-chat.tsx so the CLI surfaces (which never mount
 * `ChatViewInner`) can reuse the same flow on first user send instead of
 * leaving CLI tabs stuck on "New Chat" forever.
 */
export function useAgentAutoRenameDispatcher({ parentChatId }: AutoRenameDispatcherOptions): AutoRenameDispatcher {
  const renameSubChatMutation = api.agents.renameSubChat.useMutation();
  const renameChatMutation = api.agents.renameChat.useMutation();
  const generateSubChatNameMutation = api.agents.generateSubChatName.useMutation();
  const utils = api.useUtils();
  const [selectedTeamId] = useAtom(selectedTeamIdAtom);
  const selectedOllamaModel = useAtomValue(selectedOllamaModelAtom);

  return useCallback(
    (userMessage: string, subChatId: string) => {
      const allSubChats = useAgentSubChatStore.getState().allSubChats;
      const firstSubChatId = getFirstSubChatId(allSubChats);
      const isFirst = firstSubChatId === subChatId;

      autoRenameAgentChat({
        subChatId,
        parentChatId,
        userMessage,
        isFirstSubChat: isFirst,
        generateName: async (msg) => {
          return generateSubChatNameMutation.mutateAsync({ userMessage: msg, ollamaModel: selectedOllamaModel });
        },
        renameSubChat: async (input) => {
          await renameSubChatMutation.mutateAsync(input);
        },
        renameChat: async (input) => {
          await renameChatMutation.mutateAsync(input);
        },
        updateSubChatName: (subChatIdToUpdate, name) => {
          useAgentSubChatStore.getState().updateSubChatName(subChatIdToUpdate, name);
          // Mirror into the tRPC cache so the chat init effect doesn't overwrite
          // the new name on its next pass.
          (utils.agents as any).getAgentChat.setData({ chatId: parentChatId }, (old: any) => {
            if (!old) return old;
            const existsInCache = old.subChats.some((sc: { id: string }) => sc.id === subChatIdToUpdate);
            if (!existsInCache) {
              return {
                ...old,
                subChats: [
                  ...old.subChats,
                  {
                    id: subChatIdToUpdate,
                    name,
                    created_at: new Date(),
                    updated_at: new Date(),
                    messages: '[]',
                    mode: 'execute',
                    stream_id: null,
                    chat_id: parentChatId
                  }
                ]
              };
            }
            return {
              ...old,
              subChats: old.subChats.map((sc: { id: string }) => (sc.id === subChatIdToUpdate ? { ...sc, name } : sc))
            };
          });
        },
        updateChatName: (chatIdToUpdate, name) => {
          // Sidebar list query — keyed by team on hosted builds; null on desktop.
          (utils.agents as any).getAgentChats.setData({ teamId: selectedTeamId }, (old: any) => {
            if (!old) return old;
            return old.map((c: { id: string }) => (c.id === chatIdToUpdate ? { ...c, name } : c));
          });
          (utils.agents as any).getAgentChat.setData({ chatId: chatIdToUpdate }, (old: any) => {
            if (!old) return old;
            return { ...old, name };
          });
        }
      });
    },
    [
      parentChatId,
      generateSubChatNameMutation,
      renameSubChatMutation,
      renameChatMutation,
      selectedTeamId,
      selectedOllamaModel,
      utils.agents.getAgentChats,
      utils.agents.getAgentChat
    ]
  );
}
