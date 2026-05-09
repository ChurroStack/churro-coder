/**
 * `useChatViewState(subChatId)` — bundles the per-subChatId configuration
 * atoms that `ChatViewInner` (and components extracted from it) need to
 * read and write.
 *
 * **Why a hook?** The atoms are atomFamily entries, so each call site has
 * to do `useAtom(useMemo(() => fooAtomFamily(subChatId), [subChatId]))`.
 * That boilerplate was duplicated in `ChatViewInner` and threatened to
 * spread to every component cut out of it during Phase 3.
 *
 * **What this hook is NOT:** it is *not* the full chat orchestration
 * surface. It returns the **configuration** slice only — mode, model,
 * thinking, provider override. Activity flags (isStreaming, error
 * state), pending-message atoms, and FSM state live elsewhere because
 * they have different lifecycles.
 *
 * **Layering:** belongs in `hooks/`. Reads atoms via React; do not import
 * `services/*` here — services live above hooks in the dependency
 * direction. Components import this; services don't.
 *
 * **Per-subChatId isolation:** different subChatIds get independent
 * state by construction (atomFamily). The hook just wires that into
 * React-friendly bindings.
 *
 * **Test seam:** `renderHook(() => useChatViewState(id))` with a fresh
 * jotai store gives an L3.5 test that verifies bindings + isolation
 * without spinning up `ChatViewInner`.
 */

import { useAtom } from 'jotai';
import { useMemo } from 'react';
import {
  subChatModelIdAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatCodexThinkingAtomFamily,
  subChatClaudeThinkingAtomFamily,
  subChatProviderOverrideAtomFamily,
  type AgentMode,
  type CodexThinkingPreference,
  type ClaudeThinkingPreference
} from '../atoms';
import { useSubChatMode } from './use-sub-chat-mode';

export type ChatProvider = 'claude-code' | 'codex';

/**
 * Read-side of the hook return. Snapshot of the per-subChatId atoms at
 * the time React rendered.
 */
export interface ChatViewStateValues {
  mode: AgentMode;
  modelId: string;
  codexModelId: string;
  codexThinking: CodexThinkingPreference;
  claudeThinking: ClaudeThinkingPreference;
  /** `undefined` when no override (the per-mode default applies). */
  providerOverride: ChatProvider | undefined;
}

/**
 * Write-side of the hook return. Each setter wraps the corresponding
 * atom-family setter; persistence (DB writes, store updates, default-
 * model resolution) is the caller's responsibility — the hook stays a
 * thin atom-binding layer.
 */
export interface ChatViewStateSetters {
  setMode: (mode: AgentMode) => void;
  setModelId: (modelId: string) => void;
  setCodexModelId: (modelId: string) => void;
  setCodexThinking: (thinking: CodexThinkingPreference) => void;
  setClaudeThinking: (thinking: ClaudeThinkingPreference) => void;
  /** Pass `null` to clear the override and fall back to the per-mode default. */
  setProviderOverride: (provider: ChatProvider | null) => void;
}

export type UseChatViewStateReturn = ChatViewStateValues & ChatViewStateSetters;

export function useChatViewState(subChatId: string): UseChatViewStateReturn {
  const { mode, setMode } = useSubChatMode(subChatId);

  const modelAtom = useMemo(() => subChatModelIdAtomFamily(subChatId), [subChatId]);
  const codexModelAtom = useMemo(() => subChatCodexModelIdAtomFamily(subChatId), [subChatId]);
  const codexThinkingAtom = useMemo(() => subChatCodexThinkingAtomFamily(subChatId), [subChatId]);
  const claudeThinkingAtom = useMemo(() => subChatClaudeThinkingAtomFamily(subChatId), [subChatId]);
  const providerOverrideAtom = useMemo(() => subChatProviderOverrideAtomFamily(subChatId), [subChatId]);

  const [modelId, setModelId] = useAtom(modelAtom);
  const [codexModelId, setCodexModelId] = useAtom(codexModelAtom);
  const [codexThinking, setCodexThinking] = useAtom(codexThinkingAtom);
  const [claudeThinking, setClaudeThinking] = useAtom(claudeThinkingAtom);
  const [providerOverride, setProviderOverride] = useAtom(providerOverrideAtom);

  return {
    mode,
    modelId,
    codexModelId,
    codexThinking,
    claudeThinking,
    providerOverride,
    setMode,
    setModelId,
    setCodexModelId,
    setCodexThinking,
    setClaudeThinking,
    setProviderOverride
  };
}
