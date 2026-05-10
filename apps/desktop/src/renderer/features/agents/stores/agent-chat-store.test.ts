import { beforeEach, describe, expect, test, vi } from 'vitest';
import { agentChatStore } from './agent-chat-store';

function makeChat(cleanup = vi.fn()) {
  return {
    transport: {
      cleanup
    }
  } as any;
}

describe('agentChatStore', () => {
  beforeEach(() => {
    agentChatStore.clear();
    vi.clearAllMocks();
  });

  test('delete tears down transport cleanup before removing chat metadata', () => {
    const cleanup = vi.fn();
    agentChatStore.set('sub-delete', makeChat(cleanup), 'parent-a');
    agentChatStore.setStreamId('sub-delete', 'run-1');
    agentChatStore.setManuallyAborted('sub-delete', true);

    agentChatStore.delete('sub-delete');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(agentChatStore.get('sub-delete')).toBeUndefined();
    expect(agentChatStore.getParentChatId('sub-delete')).toBeUndefined();
    expect(agentChatStore.getStreamId('sub-delete')).toBeUndefined();
    expect(agentChatStore.wasManuallyAborted('sub-delete')).toBe(false);
  });

  test('evict removes chat metadata without calling transport cleanup', () => {
    const cleanup = vi.fn();
    agentChatStore.set('sub-evict', makeChat(cleanup), 'parent-a');
    agentChatStore.setStreamId('sub-evict', 'run-2');
    agentChatStore.setManuallyAborted('sub-evict', true);

    agentChatStore.evict('sub-evict');

    expect(cleanup).not.toHaveBeenCalled();
    expect(agentChatStore.get('sub-evict')).toBeUndefined();
    expect(agentChatStore.getParentChatId('sub-evict')).toBeUndefined();
    expect(agentChatStore.getStreamId('sub-evict')).toBeUndefined();
    expect(agentChatStore.wasManuallyAborted('sub-evict')).toBe(false);
  });

  test('nextChatInstanceId bumps per recreate and resets on full clear', () => {
    expect(agentChatStore.nextChatInstanceId('sub-gen', 3)).toBe('sub-gen::n3g1');
    expect(agentChatStore.nextChatInstanceId('sub-gen', 3)).toBe('sub-gen::n3g2');

    agentChatStore.set('sub-gen', makeChat(), 'parent-a');
    agentChatStore.delete('sub-gen');
    expect(agentChatStore.nextChatInstanceId('sub-gen', 4)).toBe('sub-gen::n4g3');

    agentChatStore.clear();

    expect(agentChatStore.nextChatInstanceId('sub-gen', 4)).toBe('sub-gen::n4g1');
  });
});
