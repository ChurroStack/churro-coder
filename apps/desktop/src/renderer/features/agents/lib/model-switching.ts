import { appStore } from "../../../lib/jotai-store"
import type { AgentMode, ClaudeThinkingPreference } from "../atoms"
import {
  defaultAgentModeModelAtom,
  defaultAgentModeThinkingAtom,
  defaultPlanModeModelAtom,
  defaultPlanModeThinkingAtom,
  defaultReviewModeModelAtom,
  defaultReviewModeThinkingAtom,
  lastSelectedAgentIdAtom,
  lastSelectedClaudeThinkingAtom,
  lastSelectedCodexThinkingAtom,
  subChatClaudeThinkingAtomFamily,
  subChatCodexThinkingAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatModelIdAtomFamily,
  subChatProviderOverrideAtomFamily,
} from "../atoms"
import {
  getProviderForModelId,
  type Provider,
} from "../../../../shared/provider-from-model"
import { CODEX_MODELS, coerceCodexThinking } from "./models"
export type { Provider }
export { getProviderForModelId }
export type ModeContext = AgentMode | "review"

export function getDefaultModelForMode(mode: ModeContext): string {
  switch (mode) {
    case "plan":
      return appStore.get(defaultPlanModeModelAtom)
    case "agent":
      return appStore.get(defaultAgentModeModelAtom)
    case "review":
      return appStore.get(defaultReviewModeModelAtom)
  }
}

export function getDefaultThinkingForMode(
  mode: ModeContext,
): ClaudeThinkingPreference {
  switch (mode) {
    case "plan":
      return appStore.get(defaultPlanModeThinkingAtom)
    case "agent":
      return appStore.get(defaultAgentModeThinkingAtom)
    case "review":
      return appStore.get(defaultReviewModeThinkingAtom)
  }
}

export function getSubChatModel(subChatId: string): string {
  return appStore.get(subChatModelIdAtomFamily(subChatId))
}

/**
 * Write `modelId` as the active model for the given sub-chat and update the
 * provider override so the correct transport is used on the next send.
 *
 * Works for both Claude and Codex model IDs:
 * - Claude IDs (opus, opus[1m], sonnet, haiku) → subChatModelIdAtomFamily
 * - Codex IDs (gpt-5.3-codex, etc.) → subChatCodexModelIdAtomFamily
 *
 * In both cases the per-sub-chat provider override is set so the chat input
 * selector and the transport stay in sync.
 */
export function setSubChatModel(subChatId: string, modelId: string): Provider {
  const provider = getProviderForModelId(modelId)
  if (provider === "codex") {
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), modelId)
  } else {
    appStore.set(subChatModelIdAtomFamily(subChatId), modelId)
  }
  appStore.set(subChatProviderOverrideAtomFamily(subChatId), provider)
  // Keep the global "last selected agent" in sync so new chats created
  // shortly after the switch pick the same provider by default.
  appStore.set(lastSelectedAgentIdAtom, provider)
  return provider
}

export type FormSelection = {
  provider: Provider
  claudeModelId: string
  claudeThinking: ClaudeThinkingPreference
  codexModelId: string
  codexThinking: string
}

/**
 * Bind the new-chat-form's exact selection to a freshly-created sub-chat.
 * Call synchronously in createChatMutation's onSuccess — before any await —
 * so the chat input reflects the form's choice and the right transport is wired up.
 */
export function applyFormSelectionToSubChat(
  subChatId: string,
  selection: FormSelection,
): void {
  if (selection.provider === "codex") {
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), selection.codexModelId)
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), "codex")
    appStore.set(lastSelectedAgentIdAtom, "codex")
    appStore.set(subChatCodexThinkingAtomFamily(subChatId), selection.codexThinking)
  } else {
    appStore.set(subChatModelIdAtomFamily(subChatId), selection.claudeModelId)
    appStore.set(subChatProviderOverrideAtomFamily(subChatId), "claude-code")
    appStore.set(lastSelectedAgentIdAtom, "claude-code")
    appStore.set(subChatClaudeThinkingAtomFamily(subChatId), selection.claudeThinking)
  }
}

export function applyModeDefaultModel(
  subChatId: string,
  mode: ModeContext,
): { modelId: string; provider: Provider } {
  const modelId = getDefaultModelForMode(mode)
  const provider = setSubChatModel(subChatId, modelId)
  const thinking = getDefaultThinkingForMode(mode)

  if (provider === "codex") {
    const codexModel = CODEX_MODELS.find((m) => m.id === modelId)
    const coerced = coerceCodexThinking(
      thinking,
      codexModel?.thinkings ?? ["low", "medium", "high", "xhigh"],
    )
    appStore.set(subChatCodexThinkingAtomFamily(subChatId), coerced)
    appStore.set(lastSelectedCodexThinkingAtom, coerced)
  } else {
    appStore.set(subChatClaudeThinkingAtomFamily(subChatId), thinking)
    appStore.set(lastSelectedClaudeThinkingAtom, thinking)
  }

  return { modelId, provider }
}
