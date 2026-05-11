/**
 * `useActiveWorktreePath` — resolves the absolute filesystem path the
 * dock panels (Files tree, Search, File viewer) should target.
 *
 * Priority:
 *   1. If a chat is active, return its `worktreePath` once loaded. While the
 *      chat query is still in flight we return `null` so the caller can show
 *      a stable loading state instead of briefly flashing the project root.
 *   2. If no chat is active, fall back to the selected project's path.
 */

import { useAtomValue } from 'jotai';
import { trpc } from '@/lib/trpc';
import { selectedAgentChatIdAtom, selectedProjectAtom } from '../atoms';

export function useActiveWorktreePath(): string | null {
  const project = useAtomValue(selectedProjectAtom);
  const chatId = useAtomValue(selectedAgentChatIdAtom);
  const { data: chat } = trpc.chats.get.useQuery({ id: chatId ?? '' }, { enabled: !!chatId });

  if (chatId) {
    return chat?.worktreePath ?? null;
  }
  return project?.path ?? null;
}
