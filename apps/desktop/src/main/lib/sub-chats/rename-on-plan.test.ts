import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renameSubChatOnFirstPlan, type RenameOnPlanDeps } from './rename-on-plan';

interface FakeState {
  subChats: Map<string, { id: string; name: string | null; chatId: string; createdAt: number }>;
  chats: Map<string, { id: string; name: string | null }>;
}

function makeDeps(state: FakeState): RenameOnPlanDeps {
  return {
    readSubChat(id) {
      const row = state.subChats.get(id);
      return row ? { name: row.name, chatId: row.chatId } : null;
    },
    renameSubChatIfPlaceholder(id, newName) {
      const row = state.subChats.get(id);
      if (!row) return false;
      // Re-assert the gate exactly as the SQL WHERE clause would.
      if (row.name != null && row.name !== 'New Chat' && row.name !== 'New chat') return false;
      row.name = newName;
      return true;
    },
    listSubChatsByChat(chatId) {
      return Array.from(state.subChats.values())
        .filter((sc) => sc.chatId === chatId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ id }) => ({ id }));
    },
    readChat(id) {
      const row = state.chats.get(id);
      return row ? { name: row.name } : null;
    },
    renameChatIfPlaceholder(id, newName) {
      const row = state.chats.get(id);
      if (!row) return false;
      if (row.name != null && row.name !== 'New Chat' && row.name !== 'New chat') return false;
      row.name = newName;
      return true;
    }
  };
}

function seed(): FakeState {
  return {
    subChats: new Map(),
    chats: new Map()
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('renameSubChatOnFirstPlan — sub-chat rename gate', () => {
  it('renames when current name is NULL', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: 'My chat' });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    // `extractPlanTitleFromContent` strips the `# ` before handing us the title.
    const result = renameSubChatOnFirstPlan('s1', 'Build the billing flow', makeDeps(state));
    expect(result.subChatRenamed).toBe('Build the billing flow');
    expect(state.subChats.get('s1')?.name).toBe('Build the billing flow');
  });

  it('renames when current name is "New Chat"', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: 'My chat' });
    state.subChats.set('s1', { id: 's1', name: 'New Chat', chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'do thing', makeDeps(state));
    expect(result.subChatRenamed).toBe('do thing');
    expect(state.subChats.get('s1')?.name).toBe('do thing');
  });

  it('renames when current name is "New chat" (lower case variant)', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: 'My chat' });
    state.subChats.set('s1', { id: 's1', name: 'New chat', chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'do thing', makeDeps(state));
    expect(result.subChatRenamed).toBe('do thing');
  });

  it('skips when current name is user-set', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: 'My chat' });
    state.subChats.set('s1', { id: 's1', name: 'My session', chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'do thing', makeDeps(state));
    expect(result).toEqual({});
    expect(state.subChats.get('s1')?.name).toBe('My session');
  });

  it('skips when the plan title sanitizes to empty', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', '   ', makeDeps(state));
    expect(result).toEqual({});
    expect(state.subChats.get('s1')?.name).toBe(null);
  });

  it('skips when the plan title is the bare "Plan" fallback', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'Plan', makeDeps(state));
    expect(result).toEqual({});
    expect(state.subChats.get('s1')?.name).toBe(null);
  });

  it('returns {} when the sub-chat row does not exist', () => {
    const state = seed();
    const result = renameSubChatOnFirstPlan('missing', 'something', makeDeps(state));
    expect(result).toEqual({});
  });
});

describe('renameSubChatOnFirstPlan — parent rename branch', () => {
  it('renames parent chat when sub-chat is chronologically first AND parent name is placeholder', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'Build billing', makeDeps(state));
    expect(result.subChatRenamed).toBe('Build billing');
    expect(result.parentChatRenamed).toBe('Build billing');
    expect(state.chats.get('c1')?.name).toBe('Build billing');
  });

  it('does NOT rename parent when a chronologically earlier sub-chat exists', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s0', { id: 's0', name: 'earlier session', chatId: 'c1', createdAt: 1 });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 5 });
    const result = renameSubChatOnFirstPlan('s1', 'Build billing', makeDeps(state));
    expect(result.subChatRenamed).toBe('Build billing');
    expect(result.parentChatRenamed).toBeUndefined();
    expect(state.chats.get('c1')?.name).toBe(null);
  });

  it('does NOT rename parent when parent name is real', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: 'My existing chat name' });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'Build billing', makeDeps(state));
    expect(result.subChatRenamed).toBe('Build billing');
    expect(result.parentChatRenamed).toBeUndefined();
    expect(state.chats.get('c1')?.name).toBe('My existing chat name');
  });

  it('renames parent when parent name is "New Chat" placeholder', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: 'New Chat' });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'Build billing', makeDeps(state));
    expect(result.parentChatRenamed).toBe('Build billing');
  });
});

describe('renameSubChatOnFirstPlan — gate races', () => {
  it('returns {} when the sub-chat UPDATE gate misses (concurrent rename race)', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const deps = makeDeps(state);
    // Simulate: read saw NULL, but by the time UPDATE runs, another writer
    // set the name to something user-meaningful. The UPDATE-with-WHERE-gate
    // affects 0 rows and we must bail.
    const realUpdate = deps.renameSubChatIfPlaceholder;
    deps.renameSubChatIfPlaceholder = (id, newName) => {
      const row = state.subChats.get(id);
      if (row) row.name = 'beat-you-to-it';
      return realUpdate.call(deps, id, newName);
    };
    const result = renameSubChatOnFirstPlan('s1', 'Build billing', deps);
    expect(result).toEqual({});
  });

  it('returns only subChatRenamed when parent UPDATE gate misses', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const deps = makeDeps(state);
    deps.renameChatIfPlaceholder = () => false; // simulate gate race
    const result = renameSubChatOnFirstPlan('s1', 'Build billing', deps);
    expect(result.subChatRenamed).toBe('Build billing');
    expect(result.parentChatRenamed).toBeUndefined();
  });
});

describe('renameSubChatOnFirstPlan — sanitization integration', () => {
  it('strips a leading "Plan:" prefix before applying', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'Plan: build billing', makeDeps(state));
    expect(result.subChatRenamed).toBe('build billing');
  });

  it('clamps an overlong title before applying', () => {
    const state = seed();
    state.chats.set('c1', { id: 'c1', name: null });
    state.subChats.set('s1', { id: 's1', name: null, chatId: 'c1', createdAt: 1 });
    const result = renameSubChatOnFirstPlan('s1', 'a'.repeat(200), makeDeps(state));
    expect(result.subChatRenamed?.length).toBe(80);
    expect(result.subChatRenamed?.endsWith('…')).toBe(true);
  });
});
