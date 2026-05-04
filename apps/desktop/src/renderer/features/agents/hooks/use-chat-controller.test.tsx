// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';

// The controller transitively imports the IPC/Codex/Remote transport classes
// (via `useTransportFactoryDeps`), which in turn require the electronTRPC
// global at module-load time. Stub them with a structural mock so the hook
// composes cleanly in node without a live IPC bridge.
vi.mock('../lib/codex-chat-transport', () => ({
  CodexChatTransport: class {}
}));
vi.mock('../lib/ipc-chat-transport', () => ({
  IPCChatTransport: class {}
}));
vi.mock('../lib/remote-chat-transport', () => ({
  RemoteChatTransport: class {}
}));
vi.mock('../../../lib/trpc', () => ({
  trpc: {},
  trpcClient: {}
}));

import { renderHook, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { createTestStore, type TestStore } from '../../../../../test-utils';
import { useChatController } from './use-chat-controller';

// L3.5 — composer hook tests. The controller bundles 4 sibling hooks:
//   - useChatViewState        (per-subChatId atoms)
//   - useModeSwitchDeps       (deps for mode-switch-service)
//   - useTransportFactoryDeps (deps for transport-factory)
//   - useApprovePlanDeps      (deps for plan-approval-service)
//
// We don't re-test each individual hook here (covered by their own tests).
// We test:
//   - The controller mounts without error
//   - The return shape has all four sub-fields, each typed correctly
//   - Per-subChatId isolation propagates through (PR #51 class)
//   - Different subChatIds produce different deps' readState/writeState
//     bindings (the FSM atom container is per-id)

afterEach(cleanup);

function makeWrapper(store: TestStore) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  };
}

function makeMutation() {
  return {
    mutateAsync: vi.fn(async () => undefined)
  };
}

function makeMinimalConfig(subChatId: string) {
  // The transport-factory config has a wide surface; for a hook test we
  // only need the function callbacks to exist, not actually do anything.
  // The renderer's real wiring substitutes live refs / setters.
  return {
    subChatId,
    updateSubChatModeMutation: makeMutation(),
    transportFactoryConfig: {
      chatId: 'test-chat',
      worktreePath: null,
      projectPath: undefined,
      chatSandboxUrl: null,
      agentSubChats: [],
      agentChat: null,
      syncFinishedMessagesToChatCache: vi.fn(),
      pruneIfDetachedAndIdle: vi.fn(),
      setLoadingSubChats: vi.fn() as unknown as React.Dispatch<React.SetStateAction<Set<string>>>,
      setSubChatUnseenChanges: vi.fn() as unknown as React.Dispatch<React.SetStateAction<Set<string>>>,
      setUnseenChanges: vi.fn() as unknown as React.Dispatch<React.SetStateAction<Set<string>>>,
      notifyAgentComplete: vi.fn(),
      fetchDiffStatsRef: { current: vi.fn() },
      invalidateChatQuery: vi.fn()
    },
    approvePlanConfig: {
      onProviderChange: vi.fn(),
      resolveApprovedPlanContent: vi.fn(async () => null),
      scheduleDeferredSend: vi.fn()
    }
  };
}

describe('useChatController — composer', () => {
  it('mounts and returns all four sub-fields', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const config = makeMinimalConfig('sub-1');
    const { result } = renderHook(() => useChatController(config), { wrapper });

    expect(result.current.viewState).toBeDefined();
    expect(result.current.modeDeps).toBeDefined();
    expect(result.current.transportFactoryDeps).toBeDefined();
    expect(result.current.planDeps).toBeDefined();
  });

  it("viewState.mode defaults to 'agent' for a fresh sub-chat", () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const config = makeMinimalConfig('sub-fresh');
    const { result } = renderHook(() => useChatController(config), { wrapper });

    expect(result.current.viewState.mode).toBe('agent');
  });

  it('viewState.setMode flips the mode and propagates', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const config = makeMinimalConfig('sub-flip');
    const { result } = renderHook(() => useChatController(config), { wrapper });

    act(() => {
      result.current.viewState.setMode('plan');
    });
    expect(result.current.viewState.mode).toBe('plan');
  });

  it('each deps bag exposes the contract methods', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const config = makeMinimalConfig('sub-contract');
    const { result } = renderHook(() => useChatController(config), { wrapper });

    // ModeSwitchDeps shape
    expect(typeof result.current.modeDeps.readState).toBe('function');
    expect(typeof result.current.modeDeps.writeState).toBe('function');
    expect(typeof result.current.modeDeps.setMode).toBe('function');
    expect(typeof result.current.modeDeps.applyDefaultModel).toBe('function');
    expect(typeof result.current.modeDeps.persistMode).toBe('function');

    // TransportFactoryDeps shape
    expect(typeof result.current.transportFactoryDeps.readExistingChat).toBe('function');
    expect(typeof result.current.transportFactoryDeps.createChat).toBe('function');
    expect(typeof result.current.transportFactoryDeps.storeChat).toBe('function');

    // PlanApprovalDeps shape
    expect(typeof result.current.planDeps.readPreviousProvider).toBe('function');
    expect(typeof result.current.planDeps.setMode).toBe('function');
    expect(typeof result.current.planDeps.persistMode).toBe('function');
    expect(typeof result.current.planDeps.applyDefaultModel).toBe('function');
    expect(typeof result.current.planDeps.notifyProviderChange).toBe('function');
    expect(typeof result.current.planDeps.resolvePlanContent).toBe('function');
    expect(typeof result.current.planDeps.buildImplementPlanParts).toBe('function');
    expect(typeof result.current.planDeps.isInFlight).toBe('function');
    expect(typeof result.current.planDeps.markInFlight).toBe('function');
    expect(typeof result.current.planDeps.releaseInFlight).toBe('function');
    expect(typeof result.current.planDeps.scheduleDeferredSend).toBe('function');
  });

  it('per-subChatId isolation — different controllers see different viewState slots (PR #51 class)', () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const cfgA = makeMinimalConfig('sub-A');
    const cfgB = makeMinimalConfig('sub-B');

    const { result: a } = renderHook(() => useChatController(cfgA), { wrapper });
    const { result: b } = renderHook(() => useChatController(cfgB), { wrapper });

    act(() => {
      a.current.viewState.setMode('plan');
    });

    expect(a.current.viewState.mode).toBe('plan');
    // sub-B is untouched
    expect(b.current.viewState.mode).toBe('agent');
  });

  it('modeDeps.persistMode skips temp- IDs', async () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const config = makeMinimalConfig('temp-skip');
    const { result } = renderHook(() => useChatController(config), { wrapper });

    await act(async () => {
      await result.current.modeDeps.persistMode!({
        subChatId: 'temp-abc123',
        mode: 'agent'
      });
    });

    expect(config.updateSubChatModeMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('modeDeps.persistMode awaits the mutation for non-temp IDs', async () => {
    const store = createTestStore();
    const wrapper = makeWrapper(store);
    const config = makeMinimalConfig('real-id');
    const { result } = renderHook(() => useChatController(config), { wrapper });

    await act(async () => {
      await result.current.modeDeps.persistMode!({
        subChatId: 'abc-real',
        mode: 'agent'
      });
    });

    expect(config.updateSubChatModeMutation.mutateAsync).toHaveBeenCalledWith({
      subChatId: 'abc-real',
      mode: 'agent'
    });
  });
});
