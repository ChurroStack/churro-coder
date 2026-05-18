'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { pendingContinueMessageAtomFamily } from '../atoms';
import { agentChatStore } from '../stores/agent-chat-store';
import { getPerChatMessageKey, messageAtomFamily, messageIdsPerChatAtom } from '../stores/message-store';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import type { AgentMessageMetadata } from './agent-message-usage';

const STUCK_TIMEOUT_MS = 10_000;

interface ContinueButtonProps {
  subChatId: string;
}

function turnHasCompletionSignal(metadata?: AgentMessageMetadata) {
  return Boolean(metadata?.resultSubtype);
}

/**
 * Tear down the transport for `subChatId` and reset its streaming status so the
 * next send creates a fresh chat instance. No-ops (with a toast) if the chat
 * is mid-flight — restarting then would abort a live stream and leak in-flight
 * IPC chunks.
 *
 * Exported at module scope so toast-action callbacks can reference a stable
 * function instead of capturing the component's render closure.
 */
export function hardRestartSubChat(subChatId: string): boolean {
  if (useStreamingStatusStore.getState().isStreaming(subChatId)) {
    toast.info('Already streaming', {
      description: 'Wait for the current response to finish, or cancel it first.',
      duration: 4000
    });
    return false;
  }
  agentChatStore.delete(subChatId);
  useStreamingStatusStore.getState().clearStatus(subChatId);
  toast.info('Agent restarted', {
    description: 'The Claude connection was reset. Try sending your message again.',
    duration: 4000
  });
  return true;
}

export function ContinueButton({ subChatId }: ContinueButtonProps) {
  const ids = useAtomValue(messageIdsPerChatAtom(subChatId));
  const lastId = ids.length > 0 ? ids[ids.length - 1] : '';
  const lastMessage = useAtomValue(messageAtomFamily(lastId ? getPerChatMessageKey(subChatId, lastId) : ''));
  const isStreaming = useStreamingStatusStore((s) => s.isStreaming(subChatId));
  const setPendingContinueMessage = useSetAtom(useMemo(() => pendingContinueMessageAtomFamily(subChatId), [subChatId]));
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the stuck-detection timer on unmount (streaming started → component hides)
  useEffect(() => {
    return () => {
      if (stuckTimerRef.current !== null) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
    };
  }, []);

  if (isStreaming) return null;
  if (ids.length === 0) return null;
  if (!lastMessage) return null;
  if (lastMessage.role === 'assistant' && turnHasCompletionSignal(lastMessage.metadata)) {
    return null;
  }

  const handleRestart = () => {
    if (stuckTimerRef.current !== null) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    hardRestartSubChat(subChatId);
  };

  const handleContinue = () => {
    setPendingContinueMessage(true);

    // If streaming doesn't begin within STUCK_TIMEOUT_MS, warn the user.
    if (stuckTimerRef.current !== null) clearTimeout(stuckTimerRef.current);
    stuckTimerRef.current = setTimeout(() => {
      stuckTimerRef.current = null;
      // 'submitted' = request accepted, awaiting first chunk → slow, not stuck. Skip the warning.
      const status = useStreamingStatusStore.getState().getStatus(subChatId);
      if (status !== 'ready') return;
      toast.warning("Claude isn't responding", {
        // Stable id dedups repeated warnings for the same sub-chat instead of stacking them.
        id: `stuck-${subChatId}`,
        description: 'The session may be stuck. Use the restart button to reconnect.',
        // Persist until dismissed so the Restart action stays reachable.
        duration: Infinity,
        action: { label: 'Restart', onClick: () => hardRestartSubChat(subChatId) }
      });
    }, STUCK_TIMEOUT_MS);
  };

  return (
    <div className="flex justify-center items-center gap-2 my-2">
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleContinue}>
        Continue
        <ArrowRight className="w-4 h-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        title="Hard restart — tear down and recreate the Claude connection"
        onClick={handleRestart}>
        <RotateCcw className="w-4 h-4" />
      </Button>
    </div>
  );
}
