/**
 * `useChatController` — composes the three deps hooks
 * (`useModeSwitchDeps`, `useTransportFactoryDeps`, `useApprovePlanDeps`)
 * plus `useChatViewState` into a single hook.
 *
 * **What this hook is:**
 *   - The composition root for `ChatViewInner`'s service wiring. The
 *     renderer used to call four separate hooks; now it calls one.
 *   - The original refactor plan called this `use-chat-controller.ts`
 *     and described it as "composes all hooks for active-chat.tsx" —
 *     this implementation matches that intent.
 *
 * **What it is NOT:**
 *   - A behavior change. Each underlying hook keeps its existing
 *     contract; this is purely a composition layer.
 *   - A migration of `useChat` itself. The AI SDK's `useChat` still
 *     lives in `ChatViewInner` — the controller doesn't try to wrap
 *     the whole stream lifecycle, only the deps and the configuration
 *     slice.
 *
 * **Why a composer?** Three reasons:
 *   1. **Single import for components extracted from ChatViewInner.**
 *      Future component cuts that need access to mode/plan/transport
 *      deps can call `useChatController(...)` once instead of three
 *      hooks plus the per-subChatId atom bindings.
 *   2. **Stable shape.** The controller's return is a typed object
 *      with documented sections; if a new dep hook joins, it slots in
 *      without breaking call sites.
 *   3. **Test surface.** L3.5 hook tests can mount the controller
 *      with a fresh jotai store and inspect all deps together (per-
 *      subChatId isolation, deps-pointing-at-correct-id, etc.).
 *
 * **Layering:** lives in `hooks/`. Imports the four sibling hooks +
 * the service interfaces. No tRPC direct calls — the parent passes
 * its mutation handle and parent-prop callbacks via config.
 */

import { useChatViewState, type UseChatViewStateReturn } from './use-chat-view-state';
import { useModeSwitchDeps, type ModeSwitchMutationLike } from './use-mode-switch-deps';
import { useTransportFactoryDeps, type UseTransportFactoryDepsConfig } from './use-transport-factory-deps';
import { useApprovePlanDeps, type UseApprovePlanDepsConfig } from './use-approve-plan-deps';
import type { Chat } from '@ai-sdk/react';
import type { ModeSwitchDeps } from '../services/mode-switch-service';
import type { PlanApprovalDeps } from '../services/plan-approval-service';
import type { TransportFactoryDeps } from '../services/transport-factory';

export interface UseChatControllerConfig {
  /** The sub-chat this controller mount is bound to. */
  subChatId: string;
  /** tRPC mutation handle — `mutateAsync` is awaited inside `persistMode`. */
  updateSubChatModeMutation: ModeSwitchMutationLike & {
    mutateAsync: (input: { subChatId: string; mode: 'agent' | 'plan'; exitPlan?: true }) => Promise<unknown>;
  };
  /** Transport-factory config — see `UseTransportFactoryDepsConfig`. */
  transportFactoryConfig: UseTransportFactoryDepsConfig;
  /** Plan-approval config — see `UseApprovePlanDepsConfig`. */
  approvePlanConfig: Omit<UseApprovePlanDepsConfig, 'updateSubChatModeMutation'>;
}

export interface UseChatControllerReturn {
  /** Per-subChatId configuration atoms (mode/model/thinking/provider). */
  viewState: UseChatViewStateReturn;
  /** Deps for `mode-switch-service` (toggleMode/forceMode/hydrateMode + note* events). */
  modeDeps: ModeSwitchDeps;
  /** Deps for `transport-factory.getOrCreateChat`. */
  transportFactoryDeps: TransportFactoryDeps<Chat<any>>;
  /** Deps for `plan-approval-service.approvePlan`. */
  planDeps: PlanApprovalDeps;
}

/**
 * Compose the per-subChatId hooks for `ChatViewInner`.
 *
 * @returns a stable object whose subfields are the individual hook
 *   returns. Each subfield's identity is preserved across renders that
 *   don't change its inputs (the underlying hooks already memoize).
 */
export function useChatController(config: UseChatControllerConfig): UseChatControllerReturn {
  const viewState = useChatViewState(config.subChatId);
  const modeDeps = useModeSwitchDeps(config.updateSubChatModeMutation);
  const transportFactoryDeps = useTransportFactoryDeps(config.transportFactoryConfig);
  const planDeps = useApprovePlanDeps({
    ...config.approvePlanConfig,
    updateSubChatModeMutation: config.updateSubChatModeMutation
  });

  // No top-level `useMemo`: each underlying hook returns a memoized
  // object, so the controller's return is implicitly stable as long as
  // its inputs don't change. Wrapping in another useMemo would just add
  // a redundant identity check.
  return {
    viewState,
    modeDeps,
    transportFactoryDeps,
    planDeps
  };
}
