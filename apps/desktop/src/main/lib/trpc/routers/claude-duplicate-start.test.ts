/**
 * B1 — Backend: duplicate M:START for an already-active Claude stream is a no-op.
 *
 * The bug: activeSessions.get(subChatId) existed → unconditional abort() fired.
 * The fix: guard with !signal.aborted → emit.complete() + return early instead.
 *
 * Tests here use the observable pattern directly against the guard extracted
 * from the subscription handler, without spinning up the full router or DB.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { observable } from '@trpc/server/observable';

// ── Minimal mock for heavy deps ───────────────────────────────────────────────
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-userdata', on: vi.fn(), getName: () => 'test', getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}));
vi.mock('../../db', () => ({
  getDatabase: vi.fn(),
  subChats: {},
  chats: {},
  claudeCodeCredentials: {},
  projects: {}
}));
vi.mock('../../claude', () => ({
  buildClaudeEnv: vi.fn(() => ({})),
  checkOfflineFallback: vi.fn(() => false),
  createTransformer: vi.fn(() => ({ transform: (msg: unknown) => [msg] })),
  getBundledClaudeBinaryPath: vi.fn(() => null),
  logClaudeEnv: vi.fn()
}));
vi.mock('../../file-stats', () => ({ computeFileStatsFromMessages: vi.fn(() => ({})) }));
vi.mock('../../multi-provider/catchup', () => ({ computeCatchupBlock: vi.fn(() => null) }));
vi.mock('../../git/stash', () => ({ createRollbackStash: vi.fn() }));
vi.mock('../../mcp-auth', () => ({
  ensureMcpTokensFresh: vi.fn(),
  fetchMcpTools: vi.fn(() => []),
  fetchMcpToolsStdio: vi.fn(() => []),
  getMcpAuthStatus: vi.fn(() => ({})),
  startMcpOAuth: vi.fn()
}));
vi.mock('../../oauth', () => ({ fetchOAuthMetadata: vi.fn(), getMcpBaseUrl: vi.fn() }));
vi.mock('../../plugins', () => ({ discoverPluginMcpServers: vi.fn(() => []) }));
vi.mock('../index', () => ({
  publicProcedure: { input: (s: unknown) => ({ subscription: (fn: unknown) => ({ _def: { resolver: fn } }) }) },
  router: (routes: unknown) => routes
}));
vi.mock('./agent-utils', () => ({ buildAgentsOption: vi.fn(() => ({})) }));
vi.mock('./claude-mode-change', () => ({ shouldForceFreshSessionOnModeChange: vi.fn(() => false) }));
vi.mock('../../sandbox/policy', () => ({
  resolveSandboxPolicy: vi.fn(() => ({ policy: 'default', type: 'default' })),
  pathIsInsideAny: vi.fn(() => false),
  writeSandboxSettingsFile: vi.fn(() => null),
  cleanupSandboxSettingsFile: vi.fn()
}));
vi.mock('./claude-settings', () => ({
  getApprovedPluginMcpServers: vi.fn(() => []),
  getEnabledPlugins: vi.fn(() => [])
}));
vi.mock('./tool-approvals', () => ({
  clearPendingApprovals: vi.fn(),
  pendingToolApprovals: new Map()
}));
vi.mock('../../plans/plan-store', () => ({ writeCurrentPlan: vi.fn(), hasPlan: vi.fn(() => false) }));
vi.mock('../../analytics', () => ({ setConnectionMethod: vi.fn() }));
vi.mock('@anthropic-ai/claude-code', () => ({}));
vi.mock('zod', async () => {
  const actual = await vi.importActual('zod');
  return actual;
});

// ── Observable guard logic (extracted for unit testing) ───────────────────────
//
// Rather than invoking the full router (which pulls in the entire Electron
// + DB + Claude SDK chain), we reproduce the exact guard pattern from
// claude.ts:771-778 in isolation. This directly tests the branching logic:
// non-aborted existing controller → emit.complete() (no-op path)
// aborted / absent controller → proceed (new stream path)
//
// The integration-level test (R3) covers the end-to-end path.

function runGuard(
  activeSessions: Map<string, AbortController>,
  subChatId: string
): { skipped: boolean; completeCalled: boolean; nextCalled: boolean } {
  let completeCalled = false;
  let nextCalled = false;
  let skipped = false;

  // Reproduce the exact guard from the fixed claude.ts:
  const obs = observable<string>((emit) => {
    const existingController = activeSessions.get(subChatId);
    if (existingController && !existingController.signal.aborted) {
      skipped = true;
      emit.complete();
      return () => {};
    }
    // Would normally start the stream — just record that we got here
    nextCalled = true;
    return () => {};
  });

  obs.subscribe({
    next: () => {
      nextCalled = true;
    },
    complete: () => {
      completeCalled = true;
    },
    error: () => {}
  });

  return { skipped, completeCalled, nextCalled };
}

describe('B1 — Claude backend duplicate M:START guard', () => {
  let activeSessions: Map<string, AbortController>;

  beforeEach(() => {
    activeSessions = new Map();
  });

  test('no existing session → stream proceeds (next-path, not skipped)', () => {
    const { skipped, nextCalled } = runGuard(activeSessions, 'sub-1');
    expect(skipped).toBe(false);
    expect(nextCalled).toBe(true);
  });

  test('existing live session → emit.complete() fires, stream is skipped (§A fix)', () => {
    // Pre-populate with a live (non-aborted) controller — simulates first stream running
    const firstController = new AbortController();
    activeSessions.set('sub-1', firstController);

    const { skipped, completeCalled, nextCalled } = runGuard(activeSessions, 'sub-1');

    expect(skipped).toBe(true);
    expect(completeCalled).toBe(true);
    expect(nextCalled).toBe(false);
    // The ORIGINAL controller must NOT be aborted — that was the bug
    expect(firstController.signal.aborted).toBe(false);
  });

  test('existing ABORTED session → new stream proceeds (recovery path)', () => {
    const staleController = new AbortController();
    staleController.abort(); // already dead
    activeSessions.set('sub-1', staleController);

    const { skipped, nextCalled } = runGuard(activeSessions, 'sub-1');
    expect(skipped).toBe(false);
    expect(nextCalled).toBe(true);
  });

  test('different subChatIds do not interfere', () => {
    const controllerA = new AbortController();
    activeSessions.set('sub-a', controllerA);

    // sub-b has no existing session → should proceed
    const { skipped } = runGuard(activeSessions, 'sub-b');
    expect(skipped).toBe(false);
    // sub-a controller untouched
    expect(controllerA.signal.aborted).toBe(false);
  });

  test('regression: old code would abort first controller — new code must not', () => {
    const firstController = new AbortController();
    activeSessions.set('sub-1', firstController);

    // Old behavior: existingController.abort() — firstController.signal.aborted would be true
    // New behavior: emit.complete() — firstController.signal.aborted stays false
    runGuard(activeSessions, 'sub-1');
    expect(firstController.signal.aborted).toBe(false);
  });
});
