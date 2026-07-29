/**
 * `useReviewAction` — single source of truth for "kick off an AI review of
 * the current diff" across the chat-input button and the diff-panel button.
 *
 *   1. Switch the sub-chat to the Review-mode default model + thinking
 *      synchronously (cross-provider safe via applyModeDefaultModelAndSwitchProvider)
 *   2. Seed `pendingReviewMessageAtomFamily(subChatId)` with the controlled
 *      `workflow/review.j2` prompt. It carries the current git branch and an
 *      optional scoped-file list, requires canonical `write_review`
 *      persistence, and works for either selected provider.
 *
 * The shared `reviewInFlight` Set in `lib/model-switching.ts` already prevents
 * cross-surface double-triggers; this hook just wraps the same flow so the
 * model-switch logic doesn't drift between callers.
 *
 * Navigation (e.g. `activateChatPanelWhenReady` in the diff panel) stays at
 * the call site — those are surface-specific concerns.
 *
 */

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAtomValue } from 'jotai';
import { filteredSubChatIdAtom, pendingReviewMessageAtomFamily, subChatFilesAtom } from '@/features/agents/atoms';
import { appStore } from '@/lib/jotai-store';
import { applyModeDefaultModelAndSwitchProvider, reviewInFlight } from '@/features/agents/lib/model-switching';
import { forceFreshSubChatSessionIfOpenSpec } from '@/features/agents/lib/session-reset';
import { generateReviewMessage, type PrContext } from '@/features/agents/utils/pr-message';
import { trpc } from '@/lib/trpc';
import { useAgentSubChatStore } from '@/features/agents/stores/sub-chat-store';

export interface UseReviewActionOptions {
  /** Sub-chat to run the review against. Hook is a no-op when null. */
  activeSubChatId: string | null | undefined;
}

export function buildControlledReviewPrompt(context: PrContext, scopedFiles?: string[]): string {
  return generateReviewMessage(context, scopedFiles);
}

interface ReviewChatContext {
  worktreePath?: string | null;
  branch?: string | null;
  baseBranch?: string | null;
}

interface ReviewBranchContext {
  current: string;
  defaultBranch: string;
}

export function resolveReviewContext(
  chat: ReviewChatContext | null | undefined,
  branches: ReviewBranchContext | null | undefined
): PrContext | null {
  if (!chat?.worktreePath || !branches) return null;

  const branch = branches.current.trim() || chat.branch?.trim();
  const baseBranch = chat.baseBranch?.trim() || branches.defaultBranch.trim();
  if (!branch || !baseBranch) return null;

  return {
    branch,
    baseBranch,
    uncommittedCount: 0,
    hasUpstream: false
  };
}

export function useReviewAction({ activeSubChatId }: UseReviewActionOptions): {
  runReview: () => Promise<{ ok: boolean }>;
  isReviewing: boolean;
} {
  const [isReviewing, setIsReviewing] = useState(false);
  const chatId = useAgentSubChatStore((state) => state.chatId);
  const filteredSubChatId = useAtomValue(filteredSubChatIdAtom);
  const subChatFiles = useAtomValue(subChatFilesAtom);
  const { data: chat } = trpc.chats.get.useQuery({ id: chatId ?? '' }, { enabled: !!chatId });
  const { data: branches } = trpc.changes.getBranches.useQuery(
    { worktreePath: chat?.worktreePath ?? '' },
    { enabled: !!chat?.worktreePath }
  );
  const scopedFiles = useMemo(() => {
    if (!activeSubChatId || filteredSubChatId !== activeSubChatId) return undefined;
    return subChatFiles.get(activeSubChatId)?.map((file) => file.filePath);
  }, [activeSubChatId, filteredSubChatId, subChatFiles]);
  const reviewContext = useMemo(() => resolveReviewContext(chat, branches), [chat, branches]);
  const reviewPrompt = useMemo(
    () => (reviewContext ? buildControlledReviewPrompt(reviewContext, scopedFiles) : null),
    [reviewContext, scopedFiles]
  );

  const runReview = useCallback(async (): Promise<{ ok: boolean }> => {
    if (!activeSubChatId) {
      toast.error('No active chat available', { position: 'top-center' });
      return { ok: false };
    }
    if (!reviewPrompt) {
      console.warn('[review-action] Review context unavailable; dispatch skipped', { subChatId: activeSubChatId });
      toast.info('Review context is still loading. Try again in a moment.', { position: 'top-center' });
      return { ok: false };
    }
    if (reviewInFlight.has(activeSubChatId)) return { ok: false };
    reviewInFlight.add(activeSubChatId);

    setIsReviewing(true);
    try {
      // Switch to the configured Review-mode model + thinking synchronously
      // BEFORE any await yields the event loop. Provider switch is safe via
      // the AndSwitchProvider variant — the previous transport is torn down
      // and the next getOrCreateChat recreates under the new provider.
      applyModeDefaultModelAndSwitchProvider(activeSubChatId, 'review');

      forceFreshSubChatSessionIfOpenSpec(activeSubChatId);
      appStore.set(pendingReviewMessageAtomFamily(activeSubChatId), reviewPrompt);
      return { ok: true };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start review', { position: 'top-center' });
      return { ok: false };
    } finally {
      setIsReviewing(false);
      reviewInFlight.delete(activeSubChatId);
    }
  }, [activeSubChatId, reviewPrompt]);

  return { runReview, isReviewing };
}
