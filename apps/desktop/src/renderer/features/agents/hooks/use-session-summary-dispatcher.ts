import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { customClaudeConfigAtom, normalizeCustomClaudeConfig, selectedOllamaModelAtom } from '../../../lib/atoms';
import { subChatBusyAtomFamily } from '../atoms';

/** Debounce after a turn finishes before (re)generating the rolling summary. */
const SUMMARY_DEBOUNCE_MS = 30_000;

interface SessionSummaryDispatcher {
  /** Generate now (manual refresh button). Cancels any pending debounce. */
  refresh: () => void;
  /** True while a generation request is in flight. */
  isGenerating: boolean;
}

/**
 * Drives the Session widget's rolling summary. Auto-(re)generates when the
 * sub-chat transitions busy → idle (a turn completed), debounced ~30s, and
 * exposes a manual `refresh()`. Generation itself is incremental + persisted
 * server-side (`chats.generateSessionSummary`), so this only decides *when*.
 *
 * Mirrors `use-auto-rename-dispatcher` for auth threading: passes the in-app
 * Anthropic key (`customClaudeConfig`) + selected Ollama model; the backend
 * never uses the subscription OAuth token.
 */
export function useSessionSummaryDispatcher(subChatId: string | null): SessionSummaryDispatcher {
  const busy = useAtomValue(subChatBusyAtomFamily(subChatId ?? ''));
  const selectedOllamaModel = useAtomValue(selectedOllamaModelAtom);
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom);
  const normalizedCustomConfig = useMemo(() => normalizeCustomClaudeConfig(customClaudeConfig), [customClaudeConfig]);

  const utils = trpc.useUtils();
  const generate = trpc.chats.generateSessionSummary.useMutation({
    onSuccess: (res) => {
      if (res.updated && subChatId) utils.chats.getSessionSummary.invalidate({ subChatId });
    }
  });

  // Keep the latest config in a ref so the debounced timer fires with fresh
  // values without re-arming on every config change.
  const cfgRef = useRef({ subChatId, selectedOllamaModel, normalizedCustomConfig });
  cfgRef.current = { subChatId, selectedOllamaModel, normalizedCustomConfig };

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fire = useCallback(() => {
    const { subChatId: id, selectedOllamaModel: ollamaModel, normalizedCustomConfig: customConfig } = cfgRef.current;
    if (!id) return;
    generate.mutate({ subChatId: id, ollamaModel, customConfig });
  }, [generate]);

  const refresh = useCallback(() => {
    clearTimer();
    fire();
  }, [clearTimer, fire]);

  // Auto-trigger on the busy → idle edge (a turn just completed).
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!subChatId) return;
    if (wasBusy && !busy) {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fire();
      }, SUMMARY_DEBOUNCE_MS);
    }
  }, [busy, subChatId, clearTimer, fire]);

  // Drop a pending timer when the widget unmounts or the sub-chat changes.
  useEffect(() => clearTimer, [clearTimer, subChatId]);

  return { refresh, isGenerating: generate.isPending };
}
