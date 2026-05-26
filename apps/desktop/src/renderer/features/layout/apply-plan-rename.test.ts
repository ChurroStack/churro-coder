import { describe, expect, it, vi } from 'vitest';
import { applyPlanRename, type PlanRenameDeps } from './apply-plan-rename';

function makeDeps(): PlanRenameDeps & {
  _state: {
    storeNames: Map<string, string>;
    triggered: Set<string>;
    chatGet: { id: string; name?: string | null; subChats?: { id: string; name?: string | null }[] } | null;
    chatList: { id: string; name?: string | null }[];
  };
} {
  const state = {
    storeNames: new Map<string, string>(),
    triggered: new Set<string>(),
    chatGet: null as { id: string; name?: string | null; subChats?: { id: string; name?: string | null }[] } | null,
    chatList: [] as { id: string; name?: string | null }[]
  };
  return {
    _state: state,
    updateSubChatName: vi.fn((id: string, name: string) => {
      state.storeNames.set(id, name);
    }),
    markSubChatAutoRenamed: vi.fn((id: string) => {
      state.triggered.add(id);
    }),
    patchChatGetCache: vi.fn((id: string, updater) => {
      if (!state.chatGet || state.chatGet.id !== id) return;
      const next = updater(state.chatGet);
      state.chatGet = next as typeof state.chatGet;
    }),
    patchChatListCache: vi.fn((updater) => {
      const next = updater(state.chatList);
      if (Array.isArray(next)) state.chatList = next as typeof state.chatList;
    })
  };
}

describe('applyPlanRename', () => {
  it('no-ops when renamed is undefined', () => {
    const deps = makeDeps();
    applyPlanRename('sc-1', 'chat-1', undefined, deps);
    expect(deps.updateSubChatName).not.toHaveBeenCalled();
    expect(deps.markSubChatAutoRenamed).not.toHaveBeenCalled();
  });

  it('no-ops when chatId is null', () => {
    const deps = makeDeps();
    applyPlanRename('sc-1', null, { subChatRenamed: 'Build billing' }, deps);
    expect(deps.updateSubChatName).not.toHaveBeenCalled();
  });

  it('applies sub-chat rename to store + dedup set + chat.get cache', () => {
    const deps = makeDeps();
    deps._state.chatGet = {
      id: 'chat-1',
      name: 'Original',
      subChats: [
        { id: 'sc-1', name: null },
        { id: 'sc-2', name: 'kept' }
      ]
    };
    applyPlanRename('sc-1', 'chat-1', { subChatRenamed: 'Build billing' }, deps);
    expect(deps._state.storeNames.get('sc-1')).toBe('Build billing');
    expect(deps._state.triggered.has('sc-1')).toBe(true);
    expect(deps._state.chatGet?.subChats).toEqual([
      { id: 'sc-1', name: 'Build billing' },
      { id: 'sc-2', name: 'kept' }
    ]);
    // Sub-chat-only rename must not touch the parent chat name or the chat list.
    expect(deps._state.chatGet?.name).toBe('Original');
    expect(deps.patchChatListCache).not.toHaveBeenCalled();
  });

  it('applies parent rename to chat.get + chat.list caches', () => {
    const deps = makeDeps();
    deps._state.chatGet = { id: 'chat-1', name: null, subChats: [] };
    deps._state.chatList = [
      { id: 'chat-1', name: null },
      { id: 'chat-2', name: 'other' }
    ];
    applyPlanRename('sc-1', 'chat-1', { parentChatRenamed: 'Build billing' }, deps);
    expect(deps._state.chatGet?.name).toBe('Build billing');
    expect(deps._state.chatList).toEqual([
      { id: 'chat-1', name: 'Build billing' },
      { id: 'chat-2', name: 'other' }
    ]);
  });

  it('applies both sub-chat AND parent rename when both are set', () => {
    const deps = makeDeps();
    deps._state.chatGet = { id: 'chat-1', name: null, subChats: [{ id: 'sc-1', name: null }] };
    deps._state.chatList = [{ id: 'chat-1', name: null }];
    applyPlanRename('sc-1', 'chat-1', { subChatRenamed: 'Build billing', parentChatRenamed: 'Build billing' }, deps);
    expect(deps._state.storeNames.get('sc-1')).toBe('Build billing');
    expect(deps._state.triggered.has('sc-1')).toBe(true);
    expect(deps._state.chatGet?.name).toBe('Build billing');
    expect(deps._state.chatGet?.subChats).toEqual([{ id: 'sc-1', name: 'Build billing' }]);
    expect(deps._state.chatList).toEqual([{ id: 'chat-1', name: 'Build billing' }]);
  });

  it('tolerates a cold chat.get cache (cache miss)', () => {
    const deps = makeDeps();
    deps._state.chatGet = null;
    applyPlanRename('sc-1', 'chat-1', { subChatRenamed: 'Build billing' }, deps);
    // Store + dedup still get the update; chat.get patch is a no-op.
    expect(deps._state.storeNames.get('sc-1')).toBe('Build billing');
    expect(deps._state.triggered.has('sc-1')).toBe(true);
    expect(deps.patchChatGetCache).toHaveBeenCalledTimes(1);
  });

  it('tolerates a chat.get value without a subChats array', () => {
    const deps = makeDeps();
    deps._state.chatGet = { id: 'chat-1', name: null };
    applyPlanRename('sc-1', 'chat-1', { subChatRenamed: 'Build billing' }, deps);
    expect(deps._state.chatGet).toEqual({ id: 'chat-1', name: null });
  });
});
