/**
 * Workspace-id invariant for `cli:*` panes.
 *
 * The global `<CliStateSubscriber/>` on the renderer reads `parentChatId` from
 * the `terminal.allCliStates` broadcast and uses it as the value in
 * `loadingSubChatsAtom: Map<subChatId, parentChatId>`. The chats-sidebar
 * workspace spinner derives `loadingChatIds = new Set(loadingSubChats.values())`
 * from that map — so if a CLI pane was created without a `workspaceId`, the
 * workspace row spinner can never light up.
 *
 * This test exercises `listActiveCliSessions()` (the renderer-side snapshot
 * source) and asserts: a session created with a workspaceId surfaces it as
 * `parentChatId`, and a session created without one surfaces `null` rather
 * than the empty string the manager records internally.
 */
import { describe, expect, it } from 'vitest';

// Mock the manager module's external deps so we can construct sessions in
// isolation. We import the real `terminalManager` instance and seed its
// `sessions` Map directly via the test-only `addTestSession` shim added below.

interface FakeTerminalSession {
  paneId: string;
  workspaceId: string;
  isAlive: boolean;
  outputState?: 'idle' | 'running';
}

describe('terminalManager.listActiveCliSessions — workspaceId invariant', () => {
  it('emits parentChatId from session.workspaceId when present', async () => {
    const { terminalManager } = await import('./manager');
    const sessions = (terminalManager as unknown as { sessions: Map<string, FakeTerminalSession> }).sessions;

    sessions.set('cli:sc-ws-ok', {
      paneId: 'cli:sc-ws-ok',
      workspaceId: 'workspace-abc',
      isAlive: true,
      outputState: 'running'
    });

    try {
      const list = terminalManager.listActiveCliSessions();
      const entry = list.find((s) => s.subChatId === 'sc-ws-ok');
      expect(entry).toBeDefined();
      expect(entry?.parentChatId).toBe('workspace-abc');
      expect(entry?.state).toBe('running');
    } finally {
      sessions.delete('cli:sc-ws-ok');
    }
  });

  it('coerces empty-string workspaceId to null (no false-truthy sidebar key)', async () => {
    const { terminalManager } = await import('./manager');
    const sessions = (terminalManager as unknown as { sessions: Map<string, FakeTerminalSession> }).sessions;

    sessions.set('cli:sc-ws-empty', {
      paneId: 'cli:sc-ws-empty',
      workspaceId: '',
      isAlive: true,
      outputState: 'idle'
    });

    try {
      const list = terminalManager.listActiveCliSessions();
      const entry = list.find((s) => s.subChatId === 'sc-ws-empty');
      expect(entry).toBeDefined();
      expect(entry?.parentChatId).toBeNull();
    } finally {
      sessions.delete('cli:sc-ws-empty');
    }
  });

  it('skips non-cli panes and dead sessions', async () => {
    const { terminalManager } = await import('./manager');
    const sessions = (terminalManager as unknown as { sessions: Map<string, FakeTerminalSession> }).sessions;

    sessions.set('terminal:other', {
      paneId: 'terminal:other',
      workspaceId: 'ws-x',
      isAlive: true
    });
    sessions.set('cli:dead', {
      paneId: 'cli:dead',
      workspaceId: 'ws-y',
      isAlive: false
    });

    try {
      const list = terminalManager.listActiveCliSessions();
      expect(list.find((s) => s.subChatId === 'other')).toBeUndefined();
      expect(list.find((s) => s.subChatId === 'dead')).toBeUndefined();
    } finally {
      sessions.delete('terminal:other');
      sessions.delete('cli:dead');
    }
  });

  it('defaults state to idle when idleDetection was never enabled', async () => {
    const { terminalManager } = await import('./manager');
    const sessions = (terminalManager as unknown as { sessions: Map<string, FakeTerminalSession> }).sessions;

    sessions.set('cli:sc-no-idle', {
      paneId: 'cli:sc-no-idle',
      workspaceId: 'ws-z',
      isAlive: true
      // no outputState
    });

    try {
      const list = terminalManager.listActiveCliSessions();
      const entry = list.find((s) => s.subChatId === 'sc-no-idle');
      expect(entry?.state).toBe('idle');
    } finally {
      sessions.delete('cli:sc-no-idle');
    }
  });
});
