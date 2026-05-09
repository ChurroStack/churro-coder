/**
 * `useApprovePlanDeps` — builds the {@link PlanApprovalDeps} bag for
 * `plan-approval-service.approvePlan`. Encapsulates the renderer's
 * side effects (atom reads, DB persist, parent-prop callbacks,
 * scroll behavior) behind a single hook so `active-chat.tsx` doesn't
 * carry the ~80 LOC inline.
 *
 * **What this hook is:**
 *   - The renderer's wiring layer between the plan-approval FSM
 *     orchestration and the actual atom store / DB / parent
 *     callbacks. The service is pure orchestration (idle → starting
 *     → mode-switched → model-applied → ready-to-send → sent); this
 *     hook supplies the side effects.
 *
 * **What it is NOT:**
 *   - A controller. It only builds deps. The caller decides when to
 *     invoke `approvePlan(...)`.
 *
 * **Layering:** lives in `hooks/`. Imports atoms + the model-switching
 * helper + the service interface + the implement-plan helper. No tRPC
 * direct calls — the mutation handle is passed in via config.
 *
 * **Regression invariants encoded in the deps:**
 *   - **PR #40**: `readPreviousProvider` snapshots the planner's
 *     provider BEFORE any state writes. Mirrors the legacy
 *     `existingChat instanceof CodexChatTransport` check.
 *   - **PR #45**: `persistMode` skips temp- IDs and includes
 *     `exitPlan: true` so the server clears `sessionId`/`sessionMode`.
 *   - **PR #51**: `isInFlight`/`markInFlight`/`releaseInFlight` wrap
 *     the module-level `planApproveInFlight: Set<string>` to prevent
 *     two `ChatViewInner` mounts from racing on the same approve.
 *   - **PR #52**: `notifyProviderChange` hops back to `onProviderChange`
 *     (parent prop) which writes `subChatProviderOverridesAtom`,
 *     forcing the next `getOrCreateChat` to recreate under the new
 *     provider.
 */

import { useMemo } from 'react';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { agentChatStore } from '../stores/agent-chat-store';
import { CodexChatTransport, markCodexFreshNextTurn } from '../lib/codex-chat-transport';
import { applyModeDefaultModel } from '../lib/model-switching';
import { appStore } from '../../../lib/jotai-store';
import { trpcClient } from '../../../lib/trpc';
import { bumpSessionEpoch, subChatModeAtomFamily, subChatProviderOverridesAtom } from '../atoms';
import { buildImplementPlanParts } from '../lib/implement-plan-parts';
import type { ApprovedPlanContent, PlanApprovalDeps } from '../services/plan-approval-service';
import type { ProviderId } from '../machines/transport-lifecycle';

/**
 * Module-level Set: prevents two ChatViewInner mounts (legacy active-chat
 * layout + dockview ChatPanel) from racing on the same plan approve.
 * Exported so the renderer's pending-build-plan effect can also gate
 * on it (`if (planApproveInFlight.has(subChatId)) return`).
 */
export const planApproveInFlight = new Set<string>();

export interface UseApprovePlanDepsConfig {
  /** Mutation handle — `mutateAsync` is awaited inside `persistMode`. */
  updateSubChatModeMutation: {
    mutateAsync: (input: { subChatId: string; mode: 'execute' | 'plan'; exitPlan?: true }) => Promise<unknown>;
  };
  /**
   * Parent-prop callback for cross-provider approvals — writes
   * `subChatProviderOverridesAtom` and triggers `getOrCreateChat` to
   * recreate the transport on the next read.
   */
  onProviderChange?: (subChatId: string, provider: ProviderId) => void;
  /**
   * Async — resolves the plan content from messages or the
   * `virtualPlanContent` atom. Returns `null` if the plan can't be
   * recovered (cross-provider best-effort).
   */
  resolveApprovedPlanContent: () => Promise<ApprovedPlanContent | null>;
  /**
   * Schedule the deferred send. The renderer wires this to
   * `setPendingImplementPlan({ subChatId, parts })`; an existing effect
   * consumes the pending state and calls `sendMessage` once
   * `isStreaming === false`.
   */
  scheduleDeferredSend: (subChatId: string, parts: unknown[]) => void;
}

/**
 * Build a memoized {@link PlanApprovalDeps} for use with
 * `plan-approval-service.approvePlan`. Pass the live tRPC mutation
 * handle and the parent-prop callbacks; the hook keeps the deps stable
 * across renders that don't change them.
 */
export function useApprovePlanDeps(config: UseApprovePlanDepsConfig): PlanApprovalDeps {
  const { updateSubChatModeMutation, onProviderChange, resolveApprovedPlanContent, scheduleDeferredSend } = config;

  return useMemo<PlanApprovalDeps>(
    () => ({
      readPreviousProvider: (id) => {
        // Snapshot the planner's provider BEFORE any writes (PR #40).
        // Use the live transport instance if there is one — otherwise
        // fall back to the override atom store.
        const existing = agentChatStore.get(id);
        if (existing) {
          return (
            (existing as { transport?: unknown })?.transport instanceof CodexChatTransport ? 'codex' : 'claude-code'
          ) as ProviderId;
        }
        return (appStore.get(subChatProviderOverridesAtom)[id] ?? 'claude-code') as ProviderId;
      },
      setMode: (id, mode) => {
        appStore.set(subChatModeAtomFamily(id), mode);
        useAgentSubChatStore.getState().updateSubChatMode(id, mode);
      },
      persistMode: async ({ subChatId: id, mode, exitPlan }) => {
        if (id.startsWith('temp-')) return;
        await updateSubChatModeMutation.mutateAsync({
          subChatId: id,
          mode,
          exitPlan
        });
      },
      resetSessionTracking: (id) => {
        bumpSessionEpoch(id, 'claude-code', appStore.set);
        bumpSessionEpoch(id, 'codex', appStore.set);
        markCodexFreshNextTurn(id);
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        // The plan-approval service only needs `provider` + `isRemote`.
        // The renderer doesn't track per-subChat remote-ness from the
        // model selection — that's chat-level metadata. Pass false; the
        // FSM uses it for the cross-provider transport-recreate decision,
        // and that decision doesn't change between local sub-chats.
        return { provider: result.provider as ProviderId, isRemote: false };
      },
      notifyProviderChange: (id, provider) => {
        onProviderChange?.(id, provider);
      },
      resolvePlanContent: async () => {
        try {
          return await resolveApprovedPlanContent();
        } catch (err) {
          console.warn('[plan-approval] resolveApprovedPlanContent failed:', err);
          return null;
        }
      },
      ensurePlanPersisted: async ({ subChatId: id, plan }) => {
        const content = plan.content.trim();
        if (!content) return;
        await trpcClient.chats.persistPlan.mutate({
          subChatId: id,
          content,
          ...(plan.source ? { source: plan.source } : {}),
          ...(plan.title ? { title: plan.title } : {})
        });
      },
      buildImplementPlanParts: (payload) => {
        return buildImplementPlanParts(payload.subChatId);
      },
      isInFlight: (id) => planApproveInFlight.has(id),
      markInFlight: (id) => {
        planApproveInFlight.add(id);
      },
      releaseInFlight: (id) => {
        planApproveInFlight.delete(id);
      },
      scheduleDeferredSend: (id, parts) => {
        scheduleDeferredSend(id, parts);
      },
      log: (msg) => {
        console.log(msg);
      }
    }),
    [updateSubChatModeMutation, onProviderChange, resolveApprovedPlanContent, scheduleDeferredSend]
  );
}
