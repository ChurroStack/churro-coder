import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { appStore } from '../../../lib/jotai-store';
import { agentChatStore } from './agent-chat-store';
import { clearSubChatBusy, setSubChatBusy, subChatBusyAtom, subChatErrorAtom, type SubChatBusyEntry } from '../atoms';

export type StreamingStatus = 'ready' | 'streaming' | 'submitted' | 'error';

interface StreamingStatusState {
  /**
   * Reflects the unified `subChatBusyAtom` + `subChatErrorAtom` projected into
   * the historical `Record<subChatId, StreamingStatus>` shape. Maintained by
   * a single jotai subscription that recomputes whenever either source atom
   * changes — there are no independent writes to `statuses`, only mirrors.
   *
   * Consumers that already read this view (chat-tab-priority-sync) keep
   * working. New code should read `subChatBusyAtomFamily(id)` /
   * `subChatErrorAtomFamily(id)` directly so it never has to enumerate.
   */
  statuses: Record<string, StreamingStatus>;

  /**
   * Writers (`active-chat.tsx`, `use-transport-factory-deps.ts`,
   * `queue-processor.tsx`) call this with the SDK-side status string. We
   * translate to the unified atom shape. The `statuses` view is updated by
   * the atom subscription, not by this setter, so all consumers always see
   * the same source.
   */
  setStatus: (subChatId: string, status: StreamingStatus) => void;
  getStatus: (subChatId: string) => StreamingStatus;
  isStreaming: (subChatId: string) => boolean;
  clearStatus: (subChatId: string) => void;
}

function entryToStatus(entry: SubChatBusyEntry): StreamingStatus {
  return entry.state === 'submitted' ? 'submitted' : 'streaming';
}

function recomputeStatuses(): Record<string, StreamingStatus> {
  // TEST-ONLY GUARD: several panel/router tests mock `appStore` with a minimal
  // `{ get: () => 'workspace-1' }` shape. `appStore.get` then returns a string
  // instead of a Map/Set and iterating below would throw at module-load. In
  // production these atoms always exist and the guard is a no-op. Do not
  // remove without also updating those mocks to return real atom values.
  const busy = appStore.get(subChatBusyAtom);
  const errs = appStore.get(subChatErrorAtom);
  if (!(busy instanceof Map) || !(errs instanceof Set)) return {};
  const out: Record<string, StreamingStatus> = {};
  for (const [subChatId, entry] of busy) {
    out[subChatId] = entryToStatus(entry);
  }
  for (const subChatId of errs) {
    // Errors override a stale busy entry; the writers clear busy when
    // transitioning to error, so this is just a safety net.
    out[subChatId] = 'error';
  }
  return out;
}

function setErrorFlag(subChatId: string, errored: boolean) {
  appStore.set(subChatErrorAtom, (prev) => {
    if (errored ? prev.has(subChatId) : !prev.has(subChatId)) return prev;
    const next = new Set(prev);
    if (errored) next.add(subChatId);
    else next.delete(subChatId);
    return next;
  });
}

function applyBusy(subChatId: string, state: 'running' | 'submitted') {
  // Preserve an existing parentChatId (set by cli-state-subscriber or
  // queue-processor at submit time) before falling back to the agentChatStore
  // lookup. agentChatStore.getParentChatId returns undefined when the Chat
  // instance hasn't been registered yet (rare race during sub-chat creation);
  // we store null instead so parent-keyed consumers can skip the entry.
  const existing = appStore.get(subChatBusyAtom).get(subChatId);
  const parentChatId = existing?.parentChatId ?? agentChatStore.getParentChatId(subChatId) ?? null;
  const source = existing?.source ?? 'builtin';
  setSubChatBusy((fn) => appStore.set(subChatBusyAtom, fn), subChatId, {
    state,
    parentChatId,
    source
  });
}

export const useStreamingStatusStore = create<StreamingStatusState>()(
  subscribeWithSelector((set) => {
    // Bridge atom updates → zustand state so existing zustand selectors fire.
    // Intentionally never unsubscribed — this bridge lives for the renderer
    // lifetime, mirroring the Zustand store itself. Adding a teardown would
    // break the bridge and resurrect the divergence the unified atom is
    // designed to prevent. The `typeof === 'function'` check guards unit
    // tests that mock `appStore` with a minimal `{ get }` shape (same as the
    // TEST-ONLY GUARD in `recomputeStatuses`).
    if (typeof appStore.sub === 'function') {
      appStore.sub(subChatBusyAtom, () => {
        set({ statuses: recomputeStatuses() });
      });
      appStore.sub(subChatErrorAtom, () => {
        set({ statuses: recomputeStatuses() });
      });
    }

    return {
      statuses: recomputeStatuses(),

      // Per-call logging here was too noisy — the Vercel AI SDK mirrors status
      // on every token batch. The cli-state-subscriber retains its log; that
      // path fires once per running↔idle transition (hysteresis-bounded).
      setStatus: (subChatId, status) => {
        if (status === 'streaming') {
          applyBusy(subChatId, 'running');
          setErrorFlag(subChatId, false);
        } else if (status === 'submitted') {
          applyBusy(subChatId, 'submitted');
          setErrorFlag(subChatId, false);
        } else if (status === 'ready') {
          clearSubChatBusy((fn) => appStore.set(subChatBusyAtom, fn), subChatId);
          setErrorFlag(subChatId, false);
        } else if (status === 'error') {
          clearSubChatBusy((fn) => appStore.set(subChatBusyAtom, fn), subChatId);
          setErrorFlag(subChatId, true);
        }
      },

      getStatus: (subChatId) => {
        const entry = appStore.get(subChatBusyAtom).get(subChatId);
        if (entry) return entryToStatus(entry);
        if (appStore.get(subChatErrorAtom).has(subChatId)) return 'error';
        return 'ready';
      },

      isStreaming: (subChatId) => {
        return appStore.get(subChatBusyAtom).has(subChatId);
      },

      clearStatus: (subChatId) => {
        clearSubChatBusy((fn) => appStore.set(subChatBusyAtom, fn), subChatId);
        setErrorFlag(subChatId, false);
      }
    };
  })
);
