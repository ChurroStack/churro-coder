// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAgentSubChatStore } from './sub-chat-store';
import { useStreamingStatusStore } from './streaming-status-store';
import { useMessageQueueStore } from './message-queue-store';

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

  // Restart persistence rule: in-flight stream state is in-memory and dropped on restart.
  // The sub-chat store reset clears all open/active state; the streaming status and
  // message queue stores are independent in-memory stores that also reset between sessions.
  test('in-flight stream state is dropped on simulated restart (reset clears all volatile state)', () => {
    // Simulate an active workspace with an in-progress stream
    useAgentSubChatStore.getState().setChatId('workspace-restart');
    useAgentSubChatStore.getState().addToOpenSubChats('sub-stream');
    useAgentSubChatStore.getState().setActiveSubChat('sub-stream');
    useAgentSubChatStore.getState().setAllSubChats([{ id: 'sub-stream', name: 'Streaming chat' }]);

    // Mark the subChat as streaming in the companion store
    useStreamingStatusStore.setState({ statuses: { 'sub-stream': 'streaming' } });
    expect(useStreamingStatusStore.getState().isStreaming('sub-stream')).toBe(true);

    // Simulate restart: both stores are re-initialized from their defaults
    useAgentSubChatStore.getState().reset();
    useStreamingStatusStore.setState({ statuses: {} });

    // Sub-chat store: all open/active state is gone
    expect(useAgentSubChatStore.getState().chatId).toBeNull();
    expect(useAgentSubChatStore.getState().openSubChatIds).toEqual([]);
    expect(useAgentSubChatStore.getState().activeSubChatId).toBeNull();
    expect(useAgentSubChatStore.getState().allSubChats).toEqual([]);

    // Streaming status: in-flight stream is gone — matches in-memory-only contract
    expect(useStreamingStatusStore.getState().isStreaming('sub-stream')).toBe(false);
  });

  test('CLI harness persists across workspace switch without DB hydration', () => {
    const chatId = 'workspace-cli-persist';

    // Set up workspace with a claude-cli subChat
    useAgentSubChatStore.getState().setChatId(chatId);
    useAgentSubChatStore.getState().addToOpenSubChats('sc-cli', chatId);

    // Simulate DB hydration arriving with CLI harness
    useAgentSubChatStore.getState().setAllSubChats([{ id: 'sc-cli', name: 'CLI Chat', harness: 'claude-cli' }]);

    // Confirm harness was stored
    expect(useAgentSubChatStore.getState().allSubChats.find((s) => s.id === 'sc-cli')?.harness).toBe('claude-cli');

    // Switch to another workspace (resets allSubChats)
    useAgentSubChatStore.getState().setChatId('workspace-other');
    expect(useAgentSubChatStore.getState().allSubChats).toEqual([]);

    // Switch back — harness map should restore the stub immediately
    useAgentSubChatStore.getState().setChatId(chatId);
    const stub = useAgentSubChatStore.getState().allSubChats.find((s) => s.id === 'sc-cli');
    expect(stub).toBeDefined();
    expect(stub?.harness).toBe('claude-cli');
  });

  test('CLI harness cwd survives workspace switch and app restart via harness map', () => {
    const chatId = 'workspace-cwd-persist';
    const projectDir = '/Users/alex/Projects/my-app';

    useAgentSubChatStore.getState().setChatId(chatId);
    useAgentSubChatStore.getState().addToOpenSubChats('sc-cwd', chatId);
    useAgentSubChatStore
      .getState()
      .setAllSubChats([{ id: 'sc-cwd', name: 'CLI Chat', harness: 'claude-cli', cwd: projectDir }]);

    // cwd is visible on the stub
    expect(useAgentSubChatStore.getState().allSubChats.find((s) => s.id === 'sc-cwd')?.cwd).toBe(projectDir);

    // Switch away then back (simulates restart round-trip via localStorage)
    useAgentSubChatStore.getState().setChatId('workspace-other');
    useAgentSubChatStore.getState().setChatId(chatId);

    const restored = useAgentSubChatStore.getState().allSubChats.find((s) => s.id === 'sc-cwd');
    expect(restored).toBeDefined();
    expect(restored?.harness).toBe('claude-cli');
    expect(restored?.cwd).toBe(projectDir);
  });

  test('old harness map (plain string entries) is read without cwd — backward compat', () => {
    const chatId = 'workspace-legacy-harness';

    // Seed localStorage with the old string-only format directly
    useAgentSubChatStore.getState().setChatId(chatId);
    useAgentSubChatStore.getState().addToOpenSubChats('sc-legacy', chatId);
    // Simulate old format: plain string, no cwd
    useAgentSubChatStore.getState().setAllSubChats([{ id: 'sc-legacy', name: 'CLI Chat', harness: 'claude-cli' }]);

    useAgentSubChatStore.getState().setChatId('workspace-other');
    useAgentSubChatStore.getState().setChatId(chatId);

    const stub = useAgentSubChatStore.getState().allSubChats.find((s) => s.id === 'sc-legacy');
    expect(stub).toBeDefined();
    expect(stub?.harness).toBe('claude-cli');
    expect(stub?.cwd).toBeUndefined();
  });

  test('builtin subChats appear as harness stubs after workspace switch (fallback for legacy dockview snapshots without params.harness)', () => {
    const chatId = 'workspace-builtin-persist';

    useAgentSubChatStore.getState().setChatId(chatId);
    useAgentSubChatStore.getState().addToOpenSubChats('sc-builtin', chatId);
    useAgentSubChatStore.getState().setAllSubChats([{ id: 'sc-builtin', name: 'Builtin Chat', harness: 'builtin' }]);

    // Switch and back — builtin now persists in the harness map so the
    // stub is available before DB hydration completes, preventing a harness
    // loss when params.harness is absent from an older dockview snapshot.
    useAgentSubChatStore.getState().setChatId('workspace-other');
    useAgentSubChatStore.getState().setChatId(chatId);

    const stub = useAgentSubChatStore.getState().allSubChats.find((s) => s.id === 'sc-builtin');
    expect(stub).toBeDefined();
    expect(stub?.harness).toBe('builtin');
  });

  test('does not publish a state update when sub-chat mode is already current', () => {
    useAgentSubChatStore.setState({
      allSubChats: [{ id: 'sub-1', name: 'OpenSpec change', mode: 'execute' }]
    });
    const listener = vi.fn();
    const unsubscribe = useAgentSubChatStore.subscribe(listener);

    useAgentSubChatStore.getState().updateSubChatMode('sub-1', 'execute');
    useAgentSubChatStore.getState().updateSubChatMode('missing-sub-chat', 'execute');

    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
