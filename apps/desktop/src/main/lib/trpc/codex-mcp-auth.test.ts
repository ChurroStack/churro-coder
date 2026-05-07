import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMcpHttpEndpoint } = vi.hoisted(() => ({
  getMcpHttpEndpoint: vi.fn()
}));

vi.mock('../mcp/http-transport', () => ({
  getMcpHttpEndpoint
}));

import {
  isAppOwnedChurroCoderMcpServerName,
  resolveAppOwnedMcpHeaders,
  shouldRemoveStaleAppOwnedMcpEntry
} from './codex-mcp-auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAppOwnedMcpHeaders', () => {
  test('keeps explicit Authorization header', () => {
    getMcpHttpEndpoint.mockReturnValue({
      url: 'http://127.0.0.1:9999/',
      bearer: 'secret'
    });

    expect(
      resolveAppOwnedMcpHeaders({
        serverName: 'churro-coder-dev',
        serverUrl: 'http://127.0.0.1:9999/',
        headers: { Authorization: 'Bearer existing' }
      })
    ).toEqual({ Authorization: 'Bearer existing' });
  });

  test('injects bearer for app-owned churro-coder HTTP endpoint', () => {
    getMcpHttpEndpoint.mockReturnValue({
      url: 'http://127.0.0.1:59479/',
      bearer: 'secret'
    });

    expect(
      resolveAppOwnedMcpHeaders({
        serverName: 'churro-coder-dev',
        serverUrl: 'http://127.0.0.1:59479/',
        headers: undefined
      })
    ).toEqual({ Authorization: 'Bearer secret' });
  });

  test('does not inject bearer for unrelated servers or URL mismatch', () => {
    getMcpHttpEndpoint.mockReturnValue({
      url: 'http://127.0.0.1:59479/',
      bearer: 'secret'
    });

    expect(
      resolveAppOwnedMcpHeaders({
        serverName: 'other-server',
        serverUrl: 'http://127.0.0.1:59479/',
        headers: undefined
      })
    ).toBeUndefined();

    expect(
      resolveAppOwnedMcpHeaders({
        serverName: 'churro-coder-dev',
        serverUrl: 'http://127.0.0.1:60000/',
        headers: undefined
      })
    ).toBeUndefined();
  });
});

describe('shouldRemoveStaleAppOwnedMcpEntry', () => {
  test('removes legacy churro-memory entries', () => {
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-memory', 'churro-coder-dev')).toBe(true);
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-memory-dev', 'churro-coder-dev')).toBe(true);
  });

  test('removes only the inactive built-in churro-coder variant', () => {
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-coder', 'churro-coder-dev')).toBe(true);
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-coder-dev', 'churro-coder-dev')).toBe(false);
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-coder-dev', 'churro-coder')).toBe(true);
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-coder', 'churro-coder')).toBe(false);
  });

  test('preserves custom similarly named servers', () => {
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-coder-debug', 'churro-coder-dev')).toBe(false);
    expect(shouldRemoveStaleAppOwnedMcpEntry('churro-coder-coworker', 'churro-coder-dev')).toBe(false);
    expect(shouldRemoveStaleAppOwnedMcpEntry('other-server', 'churro-coder-dev')).toBe(false);
  });
});

describe('isAppOwnedChurroCoderMcpServerName', () => {
  test('matches only the built-in prod/dev server names', () => {
    expect(isAppOwnedChurroCoderMcpServerName('churro-coder')).toBe(true);
    expect(isAppOwnedChurroCoderMcpServerName('churro-coder-dev')).toBe(true);
    expect(isAppOwnedChurroCoderMcpServerName('churro-coder-debug')).toBe(false);
    expect(isAppOwnedChurroCoderMcpServerName('other-server')).toBe(false);
  });
});
