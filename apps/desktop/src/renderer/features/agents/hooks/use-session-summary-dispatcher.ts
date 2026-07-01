import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { customClaudeConfigAtom, normalizeCustomClaudeConfig, selectedOllamaModelAtom } from '../../../lib/atoms';
import { subChatBusyAtomFamily } from '../atoms';

/** Debounce after a turn finishes before (re)generating the rolling summary. */
const SUMMARY_DEBOUNCE_MS = 30_000;

interface SessionSummaryDispatcherOptions {
  /** Whether the persisted summary is behind the latest messages. Drives the
   *  reopen-an-old-session auto-fire (NOT turn-completion, which the debounce
   *  owns). */
  stale?: boolean;
  /** Called on the busy→idle edge (a turn just completed), before the debounced
   *  generation is scheduled. The widget uses it to refetch prompts/summary so
   *  "last input" updates immediately. */
  onTurnIdle?: () => void;
}

interface SessionSummaryDispatcher {
  /** Generate now (manual refresh button). Cancels any pending debounce. */
  refresh: () => void;
  /** True while a generation request is in flight. */
  isGenerating: boolean;
}

/**
 * Sole owner of *when* the rolling session summary is (re)generated. Detects the
 * busy→idle edge exactly once per turn (re-baselining on sub-chat switch so a
 * switch from a busy chat to an idle one is NOT mistaken for a completed turn),
 * schedules a debounced generation, fires `onTurnIdle` for immediate query
 * refresh, and — only when reopening a session that is already stale and where
 * no turn has completed this mount — fires one immediate generation. Generation
 * itself is incremental + persisted + serialized server-side
 * (`chats.generateSessionSummary`); this hook only decides timing.
 *
 * Mirrors `use-auto-rename-dispatcher` for auth threading: passes the in-app
 * Anthropic key (`customClaudeConfig`) + selected Ollama model; the backend
 * never uses the subscription OAuth token.
 */
export function useSessionSummaryDispatcher(
  subChatId: string | null,
  options?: SessionSummaryDispatcherOptions
): SessionSummaryDispatcher {
  const busy = useAtomValue(subChatBusyAtomFamily(subChatId ?? ''));
  const selectedOllamaModel = useAtomValue(selectedOllamaModelAtom);
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom);
  const normalizedCustomConfig = useMemo(() => normalizeCustomClaudeConfig(customClaudeConfig), [customClaudeConfig]);
  const stale = options?.stale ?? false;

  const utils = trpc.useUtils();
  const generate = trpc.chats.generateSessionSummary.useMutation({
    onSuccess: (res) => {
      if (res.updated && subChatId) utils.chats.getSessionSummary.invalidate({ subChatId });
    }
  });

  // Latest values in refs so the debounced timer / callbacks fire fresh without
  // re-arming on every render.
  const cfgRef = useRef({ subChatId, selectedOllamaModel, normalizedCustomConfig });
  cfgRef.current = { subChatId, selectedOllamaModel, normalizedCustomConfig };
  const onTurnIdleRef = useRef(options?.onTurnIdle);
  onTurnIdleRef.current = options?.onTurnIdle;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fire = useCallback(() => {
    if (generate.isPending) return; // server also serializes; avoid even sending
    const { subChatId: id, selectedOllamaModel: ollamaModel, normalizedCustomConfig: customConfig } = cfgRef.current;
    if (!id) return;
    generate.mutate({ subChatId: id, ollamaModel, customConfig });
  }, [generate]);

  const refresh = useCallback(() => {
    clearTimer();
    fire();
  }, [clearTimer, fire]);

  // Edge detection + per-sub-chat trigger state, all re-baselined on switch.
  const trackedSubChatIdRef = useRef<string | null>(subChatId);
  const prevBusyRef = useRef(busy);
  const sawTurnRef = useRef(false); // a turn completed for THIS sub-chat this mount
  const autoFiredRef = useRef(false); // reopen-stale auto-fire used for THIS sub-chat

  useEffect(() => {
    if (trackedSubChatIdRef.current !== subChatId) {
      // New sub-chat: re-baseline so the previous chat's busy value can't fake a
      // busy→idle edge, and drop per-sub-chat trigger state.
      trackedSubChatIdRef.current = subChatId;
      prevBusyRef.current = busy;
      sawTurnRef.current = false;
      autoFiredRef.current = false;
      clearTimer();
      return;
    }
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!subChatId) return;
    if (wasBusy && !busy) {
      sawTurnRef.current = true;
      onTurnIdleRef.current?.();
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fire();
      }, SUMMARY_DEBOUNCE_MS);
    }
  }, [busy, subChatId, clearTimer, fire]);

  // Reopen-an-old-session case only: summary is stale on open and no turn has
  // completed this mount (turn completions are owned by the debounce above, so
  // this never double-fires for a fresh turn).
  useEffect(() => {
    if (!subChatId || busy || generate.isPending || autoFiredRef.current || sawTurnRef.current) return;
    if (stale) {
      autoFiredRef.current = true;
      fire();
    }
  }, [subChatId, busy, stale, generate.isPending, fire]);

  // Drop a pending timer when the widget unmounts or the sub-chat changes.
  useEffect(() => clearTimer, [clearTimer, subChatId]);

  return { refresh, isGenerating: generate.isPending };
}
