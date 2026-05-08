/**
 * Reproduces the in-flight-coalescing pattern from
 * codex.ts:ensureChurroCoderMcpReady and the bearer-rotation invalidation
 * branch from codex.ts:getOrCreateAppServerClient. Tests the decision logic
 * in isolation since codex.ts pulls in electron / sentry / drizzle and
 * is impractical to import in a unit test.
 *
 * Mirrors the guard-extraction pattern used by codex-duplicate-start.test.ts.
 */
import { describe, test, expect, vi } from 'vitest';

type Endpoint = { url: string; bearer: string } | null;

// Mirrors the export from codex.ts. Kept small to keep the test focused on
// the single decision: skip / await-inflight / bootstrap.
function makeEnsureMcpReady(deps: {
  getStatus: () => { state: 'pending' | 'ready' | 'cli-missing' | 'failed'; url?: string };
  getEndpoint: () => Endpoint;
  bootstrap: () => Promise<void>;
}) {
  let inFlight: Promise<void> | null = null;
  const actions: Array<'skip' | 'await-inflight' | 'bootstrap'> = [];

  async function ensure(opts?: { force?: boolean }): Promise<void> {
    const endpoint = deps.getEndpoint();
    const status = deps.getStatus();
    const ready =
      status.state === 'ready' && Boolean(endpoint) && endpoint?.url === status.url && Boolean(endpoint?.bearer);

    if (!opts?.force && ready) {
      actions.push('skip');
      return;
    }
    if (inFlight) {
      actions.push('await-inflight');
      return inFlight;
    }
    actions.push('bootstrap');
    inFlight = (async () => {
      try {
        await deps.bootstrap();
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  }

  return { ensure, actions };
}

describe('ensureChurroCoderMcpReady decision logic', () => {
  test('skips when ready and endpoint matches', async () => {
    const bootstrap = vi.fn(async () => {});
    const { ensure, actions } = makeEnsureMcpReady({
      getStatus: () => ({ state: 'ready', url: 'http://127.0.0.1:1/' }),
      getEndpoint: () => ({ url: 'http://127.0.0.1:1/', bearer: 'b' }),
      bootstrap
    });

    await ensure();
    expect(actions).toEqual(['skip']);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  test('runs bootstrap when status is pending', async () => {
    const bootstrap = vi.fn(async () => {});
    const { ensure, actions } = makeEnsureMcpReady({
      getStatus: () => ({ state: 'pending' }),
      getEndpoint: () => null,
      bootstrap
    });

    await ensure();
    expect(actions).toEqual(['bootstrap']);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  test('force=true bypasses skip', async () => {
    const bootstrap = vi.fn(async () => {});
    const { ensure, actions } = makeEnsureMcpReady({
      getStatus: () => ({ state: 'ready', url: 'http://127.0.0.1:1/' }),
      getEndpoint: () => ({ url: 'http://127.0.0.1:1/', bearer: 'b' }),
      bootstrap
    });

    await ensure({ force: true });
    expect(actions).toEqual(['bootstrap']);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  test('coalesces 10 parallel callers to a single bootstrap run', async () => {
    let resolveBootstrap: (() => void) | null = null;
    const bootstrap = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveBootstrap = resolve;
        })
    );
    const { ensure, actions } = makeEnsureMcpReady({
      getStatus: () => ({ state: 'pending' }),
      getEndpoint: () => null,
      bootstrap
    });

    const calls = Array.from({ length: 10 }, () => ensure());
    // Allow the first call to set inFlight before subsequent ones run.
    await new Promise((r) => setImmediate(r));
    expect(bootstrap).toHaveBeenCalledTimes(1);

    resolveBootstrap!();
    await Promise.all(calls);

    const bootstrapActions = actions.filter((a) => a === 'bootstrap');
    const awaitActions = actions.filter((a) => a === 'await-inflight');
    expect(bootstrapActions).toHaveLength(1);
    expect(awaitActions).toHaveLength(9);
  });

  test('detects URL drift after HTTP server restart and re-bootstraps', async () => {
    const bootstrap = vi.fn(async () => {});
    let endpoint: Endpoint = { url: 'http://127.0.0.1:1/', bearer: 'b' };
    const { ensure, actions } = makeEnsureMcpReady({
      getStatus: () => ({ state: 'ready', url: 'http://127.0.0.1:1/' }),
      getEndpoint: () => endpoint,
      bootstrap
    });

    await ensure();
    expect(actions).toEqual(['skip']);

    // Simulate restart: endpoint port changes but status still reports old URL.
    endpoint = { url: 'http://127.0.0.1:9999/', bearer: 'b' };
    await ensure();
    expect(actions).toEqual(['skip', 'bootstrap']);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});

// Mirrors the cache-invalidation branch in getOrCreateAppServerClient, which
// disposes the cached client when authFingerprint OR mcpBearer changes.
type Session = {
  client: { dispose: () => void; id: string };
  authFingerprint: string | null;
  mcpBearer: string | null;
};

function decideSessionAction(args: {
  existing: Session | undefined;
  authFingerprint: string | null;
  currentMcpBearer: string | null;
}): { reuse: boolean; reason?: 'auth' | 'bearer' | 'both' } {
  const { existing, authFingerprint, currentMcpBearer } = args;
  if (existing && existing.authFingerprint === authFingerprint && existing.mcpBearer === currentMcpBearer) {
    return { reuse: true };
  }
  if (!existing) return { reuse: false };
  const authChanged = existing.authFingerprint !== authFingerprint;
  const bearerChanged = existing.mcpBearer !== currentMcpBearer;
  const reason = authChanged && bearerChanged ? 'both' : authChanged ? 'auth' : 'bearer';
  return { reuse: false, reason };
}

describe('Codex app-server session bearer-rotation invalidation', () => {
  test('reuses cached session when fingerprint and bearer match', () => {
    const existing: Session = {
      client: { dispose: vi.fn(), id: 'a' },
      authFingerprint: 'auth-1',
      mcpBearer: 'bearer-1'
    };
    const result = decideSessionAction({ existing, authFingerprint: 'auth-1', currentMcpBearer: 'bearer-1' });
    expect(result).toEqual({ reuse: true });
  });

  test('invalidates when MCP bearer rotates (long-running stale-env path)', () => {
    const existing: Session = {
      client: { dispose: vi.fn(), id: 'a' },
      authFingerprint: 'auth-1',
      mcpBearer: null
    };
    const result = decideSessionAction({ existing, authFingerprint: 'auth-1', currentMcpBearer: 'bearer-1' });
    expect(result).toEqual({ reuse: false, reason: 'bearer' });
  });

  test('invalidates when auth fingerprint changes', () => {
    const existing: Session = {
      client: { dispose: vi.fn(), id: 'a' },
      authFingerprint: 'auth-old',
      mcpBearer: 'bearer-1'
    };
    const result = decideSessionAction({ existing, authFingerprint: 'auth-new', currentMcpBearer: 'bearer-1' });
    expect(result).toEqual({ reuse: false, reason: 'auth' });
  });

  test('reports both when auth and bearer rotate together', () => {
    const existing: Session = {
      client: { dispose: vi.fn(), id: 'a' },
      authFingerprint: 'auth-old',
      mcpBearer: 'bearer-old'
    };
    const result = decideSessionAction({ existing, authFingerprint: 'auth-new', currentMcpBearer: 'bearer-new' });
    expect(result).toEqual({ reuse: false, reason: 'both' });
  });

  test('no-existing returns reuse=false with no reason (initial spawn)', () => {
    const result = decideSessionAction({ existing: undefined, authFingerprint: 'a', currentMcpBearer: 'b' });
    expect(result).toEqual({ reuse: false });
  });
});
