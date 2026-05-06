import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMcpHttpEndpoint } = vi.hoisted(() => ({
  getMcpHttpEndpoint: vi.fn()
}));

vi.mock('../mcp/http-transport', () => ({
  getMcpHttpEndpoint
}));

import { resolveAppOwnedMcpHeaders } from './codex-mcp-auth';

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
