// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAgentSubChatStore } from './sub-chat-store';

describe('sub-chat-store expectedChatId guard', () => {
  beforeEach(() => {
    useAgentSubChatStore.getState().reset();
    vi.restoreAllMocks();
  });

  test('mutates when expectedChatId matches the active workspace', () => {
    useAgentSubChatStore.getState().setChatId('workspace-a');

    useAgentSubChatStore.getState().addToOpenSubChats('sub-1', 'workspace-a');
    useAgentSubChatStore.getState().setActiveSubChat('sub-1', 'workspace-a');

    expect(useAgentSubChatStore.getState().openSubChatIds).toEqual(['sub-1']);
    expect(useAgentSubChatStore.getState().activeSubChatId).toBe('sub-1');
  });

  test('refuses cross-workspace mutations and warns', () => {
    useAgentSubChatStore.setState({
      chatId: 'workspace-a',
      openSubChatIds: ['sub-1'],
      activeSubChatId: 'sub-1'
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useAgentSubChatStore.getState().addToOpenSubChats('sub-2', 'workspace-b');
    useAgentSubChatStore.getState().setActiveSubChat('sub-2', 'workspace-b');

    expect(useAgentSubChatStore.getState().openSubChatIds).toEqual(['sub-1']);
    expect(useAgentSubChatStore.getState().activeSubChatId).toBe('sub-1');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      '[SubChatStore] cross-workspace mutation refused',
      expect.objectContaining({
        action: 'addToOpenSubChats',
        currentChatId: 'kspace-a',
        expectedChatId: 'kspace-b',
        subChatId: 'sub-2'
      })
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      '[SubChatStore] cross-workspace mutation refused',
      expect.objectContaining({
        action: 'setActiveSubChat',
        currentChatId: 'kspace-a',
        expectedChatId: 'kspace-b',
        subChatId: 'sub-2'
      })
    );
  });

  test('preserves backward-compatible mutations when expectedChatId is omitted', () => {
    useAgentSubChatStore.getState().setChatId('workspace-a');

    useAgentSubChatStore.getState().addToOpenSubChats('sub-1');
    useAgentSubChatStore.getState().setActiveSubChat('sub-1');

    expect(useAgentSubChatStore.getState().openSubChatIds).toEqual(['sub-1']);
    expect(useAgentSubChatStore.getState().activeSubChatId).toBe('sub-1');
  });
});
