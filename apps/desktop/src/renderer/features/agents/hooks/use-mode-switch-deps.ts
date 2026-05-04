/**
 * `useModeSwitchDeps` — builds the {@link ModeSwitchDeps} bag for a
 * `ChatViewInner` mount. Returns a stable, memoized object suitable for
 * passing into `mode-switch-service.toggleMode` / `forceMode` /
 * `hydrateMode` / `note*` event helpers.
 *
 * **What this hook is:**
 *   - The renderer's wiring layer between the mode-switch service and
 *     the actual atom store + DB mutation. The service is pure
 *     orchestration; this hook supplies the side effects.
 *
 * **What it is NOT:**
 *   - A controller. It only builds deps. The caller decides when to
 *     invoke `toggleMode(...)` / `hydrateMode(...)`.
 *
 * **Layering:** lives in `hooks/`. Imports atoms + the model-switching
 * helper + the service interface only — no React tree dependencies
 * beyond `useMemo`.
 *
 * **Why a hook?** Before this extraction the deps lived as a 50-line
 * `useMemo` inline in `ChatViewInner`. Pulling it out:
 *   - reduces `active-chat.tsx` LOC;
 *   - makes the deps testable in isolation (the L3.5 hook tests can
 *     mount this hook and inspect the deps without the full chat
 *     orchestrator);
 *   - lets future component extracts (anything that needs to flip mode)
 *     reuse the same deps without re-deriving.
 *
 * **Memoization:** the entire deps object is recomputed only when
 * `updateSubChatModeMutation` changes (the tRPC mutation hook returns
 * a new reference per render, so we depend on `mutateAsync` directly
 * which is stable across renders for a given mutation hook).
 */

import { useMemo } from 'react';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { applyModeDefaultModel } from '../lib/model-switching';
import { appStore } from '../../../lib/jotai-store';
import { chatModeFsmStateAtomFamily, subChatModeAtomFamily } from '../atoms';
import type { ModeSwitchDeps } from '../services/mode-switch-service';
import type { ProviderId } from '../machines/transport-lifecycle';

export interface ModeSwitchMutationLike {
  mutateAsync: (input: { subChatId: string; mode: 'agent' | 'plan'; exitPlan?: boolean }) => Promise<unknown>;
}

/**
 * Build a memoized {@link ModeSwitchDeps} for use with the mode-switch
 * services. Pass the live tRPC mutation handle (`api.agents.updateSubChatMode.useMutation()`)
 * and the hook will keep the deps stable across renders that don't change it.
 *
 * @param updateSubChatModeMutation - tRPC mutation for persisting mode to DB.
 *   `mutateAsync` is awaited inside `persistMode`.
 */
export function useModeSwitchDeps(updateSubChatModeMutation: ModeSwitchMutationLike): ModeSwitchDeps {
  return useMemo<ModeSwitchDeps>(
    () => ({
      readState: (id) => appStore.get(chatModeFsmStateAtomFamily(id)),
      writeState: (id, state) => appStore.set(chatModeFsmStateAtomFamily(id), state),
      setMode: (id, mode) => {
        // The chat-mode FSM allows "review", but the renderer's surface
        // only persists "plan" / "agent". Drop "review" writes here —
        // applyDefaultModel still applies the right model + thinking.
        if (mode === 'review') return;
        appStore.set(subChatModeAtomFamily(id), mode);
        useAgentSubChatStore.getState().updateSubChatMode(id, mode);
      },
      applyDefaultModel: (id, mode) => {
        const result = applyModeDefaultModel(id, mode);
        return {
          modelId: result.modelId,
          provider: result.provider as ProviderId
        };
      },
      persistMode: async ({ subChatId: id, mode }) => {
        if (id.startsWith('temp-')) return;
        await updateSubChatModeMutation.mutateAsync({
          subChatId: id,
          mode
        });
      },
      log: (msg) => {
        if (process.env.NODE_ENV === 'development') {
          console.log(msg);
        }
      }
    }),
    [updateSubChatModeMutation]
  );
}
