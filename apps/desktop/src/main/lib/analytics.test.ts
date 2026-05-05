import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted shared mock state. The PostHog mock holds vi.fns the tests inspect;
// each beforeEach replaces them with a fresh set so call counts don't leak.
const phState: {
  capture: ReturnType<typeof vi.fn>;
  optIn: ReturnType<typeof vi.fn>;
  optOut: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  ctor: ReturnType<typeof vi.fn>;
} = {
  capture: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  ctor: vi.fn()
};

vi.mock('posthog-node', () => ({
  PostHog: function MockPostHog(this: any, ...args: unknown[]) {
    phState.ctor(...args);
    this.capture = phState.capture;
    this.optIn = phState.optIn;
    this.optOut = phState.optOut;
    this.shutdown = phState.shutdown;
  }
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/cscode-analytics-test',
    getVersion: () => '0.0.1-test',
    isPackaged: false
  }
}));

vi.mock('fs', () => ({
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: () => {}
}));

vi.mock('crypto', () => ({
  randomUUID: () => 'test-device-uuid'
}));

// Each test gets a fresh module state — the analytics module holds module-scope
// `client` / `_optedOut` / `appOpenedFired` flags that would otherwise leak.
async function freshModule(): Promise<typeof import('./analytics')> {
  vi.resetModules();
  return await import('./analytics');
}

beforeEach(() => {
  phState.capture = vi.fn();
  phState.optIn = vi.fn();
  phState.optOut = vi.fn();
  phState.shutdown = vi.fn().mockResolvedValue(undefined);
  phState.ctor = vi.fn();
  process.env.POSTHOG_API_KEY = 'phc_test_key';
  process.env.POSTHOG_HOST = 'https://test.posthog';
});

afterEach(() => {
  delete process.env.POSTHOG_API_KEY;
  delete process.env.POSTHOG_HOST;
});

describe('analytics — opt-out gating', () => {
  it('defaults to opted-out (strict opt-in)', async () => {
    const mod = await freshModule();
    expect(mod.isOptedOut()).toBe(true);
  });

  it('setOptOut(false) flips state to opted-in', async () => {
    const mod = await freshModule();
    mod.setOptOut(false);
    expect(mod.isOptedOut()).toBe(false);
  });

  it('capture is a no-op when opted out, even after init', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    mod.capture('test_event', { app_version: '1.0' });
    expect(phState.capture).not.toHaveBeenCalled();
  });

  it('capture is a no-op when client has not loaded yet', async () => {
    const mod = await freshModule();
    mod.setOptOut(false);
    // Init not called → no client. Capture before any init resolution.
    mod.capture('test_event', { app_version: '1.0' });
    expect(phState.capture).not.toHaveBeenCalled();
  });

  it('capture sends to PostHog after opt-in and init', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    mod.setOptOut(false);
    mod.capture('test_event', { app_version: '1.0', provider: 'claude' });
    expect(phState.capture).toHaveBeenCalledTimes(1);
    expect(phState.capture).toHaveBeenCalledWith({
      distinctId: 'test-device-uuid',
      event: 'test_event',
      properties: { app_version: '1.0', provider: 'claude' }
    });
  });
});

describe('analytics — init race regression (opted-in user, init resolves AFTER setOptOut)', () => {
  it('applies opt-in to PostHog client when setOptOut(false) ran before init resolved', async () => {
    const mod = await freshModule();
    // Renderer's syncOptOutStatus reaches us before the dynamic import resolves.
    mod.setOptOut(false);
    const initPromise = mod.initAnalytics();
    // At this point client is null; setOptOut had nothing to flip.
    expect(phState.optIn).not.toHaveBeenCalled();
    expect(phState.optOut).not.toHaveBeenCalled();

    await initPromise;

    // After init resolves, the client must reflect the synced opt-in state —
    // NOT an unconditional optOut() that would silently drop every event.
    expect(phState.optIn).toHaveBeenCalledTimes(1);
    expect(phState.optOut).not.toHaveBeenCalled();
  });

  it('applies opt-out to PostHog client when default opted-out state survives init', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    expect(phState.optOut).toHaveBeenCalledTimes(1);
    expect(phState.optIn).not.toHaveBeenCalled();
  });

  it('setOptOut after init flips PostHog client live', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    expect(phState.optOut).toHaveBeenCalledTimes(1); // init applied default opt-out

    mod.setOptOut(false);
    expect(phState.optIn).toHaveBeenCalledTimes(1);

    mod.setOptOut(true);
    expect(phState.optOut).toHaveBeenCalledTimes(2);
  });
});

describe('analytics — scrub', () => {
  it('drops keys not in the SAFE_KEYS allowlist', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    mod.setOptOut(false);
    mod.capture('test', {
      app_version: '1.0',
      provider: 'claude',
      file_path: '/secret/path', // not allowlisted
      user_message: 'private prompt', // not allowlisted
      home_dir: '/home/alice' // not allowlisted
    });
    expect(phState.capture).toHaveBeenCalledTimes(1);
    expect(phState.capture).toHaveBeenCalledWith({
      distinctId: 'test-device-uuid',
      event: 'test',
      properties: { app_version: '1.0', provider: 'claude' }
    });
  });

  it('keeps PostHog system keys (prefixed with $)', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    mod.setOptOut(false);
    mod.capture('test', { $session_id: 'sess-123', app_version: '1.0' });
    expect(phState.capture).toHaveBeenCalledWith({
      distinctId: 'test-device-uuid',
      event: 'test',
      properties: { $session_id: 'sess-123', app_version: '1.0' }
    });
  });

  it('drops nested objects on allowlisted keys (smuggling guard)', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    mod.setOptOut(false);
    // `provider` is allowlisted, but a nested object would smuggle arbitrary
    // fields past the allowlist — the value-type filter must reject it.
    mod.capture('test', {
      provider: { name: 'claude', api_key: 'sk-leak' } as unknown as string
    });
    expect(phState.capture).toHaveBeenCalledWith({
      distinctId: 'test-device-uuid',
      event: 'test',
      properties: {}
    });
  });

  it('drops arrays on allowlisted keys', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    mod.setOptOut(false);
    mod.capture('test', { provider: ['a', 'b'] as unknown as string });
    expect(phState.capture).toHaveBeenCalledWith({
      distinctId: 'test-device-uuid',
      event: 'test',
      properties: {}
    });
  });
});

describe('analytics — trackAppOpened deferral', () => {
  it('does not fire when called before init', async () => {
    const mod = await freshModule();
    mod.trackAppOpened();
    expect(phState.capture).not.toHaveBeenCalled();
  });

  it('does not fire after init while opted out', async () => {
    const mod = await freshModule();
    mod.trackAppOpened(); // requested before client + before opt-in
    await mod.initAnalytics();
    expect(phState.capture).not.toHaveBeenCalled();
  });

  it('fires once both client is ready and user is opted in', async () => {
    const mod = await freshModule();
    mod.trackAppOpened();
    await mod.initAnalytics();
    mod.setOptOut(false);
    expect(phState.capture).toHaveBeenCalledTimes(1);
    expect(phState.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'app_opened',
        properties: expect.objectContaining({
          app_version: '0.0.1-test',
          is_packaged: false
        })
      })
    );
  });

  it('fires only once per session even after toggling opt-out off and on', async () => {
    const mod = await freshModule();
    mod.trackAppOpened();
    await mod.initAnalytics();
    mod.setOptOut(false);
    expect(phState.capture).toHaveBeenCalledTimes(1);

    mod.setOptOut(true);
    mod.setOptOut(false);
    mod.trackAppOpened(); // second request

    expect(phState.capture).toHaveBeenCalledTimes(1);
  });
});

describe('analytics — module is inert without POSTHOG_API_KEY', () => {
  it('initAnalytics is a no-op when key is missing', async () => {
    delete process.env.POSTHOG_API_KEY;
    const mod = await freshModule();
    await mod.initAnalytics();
    expect(phState.ctor).not.toHaveBeenCalled();
    mod.setOptOut(false);
    mod.capture('foo', { app_version: '1' });
    expect(phState.capture).not.toHaveBeenCalled();
  });
});

describe('analytics — shutdown', () => {
  it('flushes the PostHog client', async () => {
    const mod = await freshModule();
    await mod.initAnalytics();
    await mod.shutdown();
    expect(phState.shutdown).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when init never ran', async () => {
    const mod = await freshModule();
    await mod.shutdown();
    expect(phState.shutdown).not.toHaveBeenCalled();
  });
});
