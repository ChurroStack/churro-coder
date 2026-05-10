import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMcpHttpEndpoint } = vi.hoisted(() => ({
  getMcpHttpEndpoint: vi.fn()
}));

vi.mock('../mcp/http-transport', () => ({
  getMcpHttpEndpoint
}));

import {
  buildApprovedPlanReadPlanUnavailableMessage,
  getAppOwnedChurroCoderMcpServerName,
  getAppOwnedChurroCoderReadPlanToolName,
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

describe('app-owned MCP naming helpers', () => {
  test('returns the canonical prod/dev server names', () => {
    expect(getAppOwnedChurroCoderMcpServerName(false)).toBe('churro-coder');
    expect(getAppOwnedChurroCoderMcpServerName(true)).toBe('churro-coder-dev');
  });

  test('formats the Codex MCP read_plan tool name from the server name', () => {
    expect(getAppOwnedChurroCoderReadPlanToolName('churro-coder')).toBe('mcp__churro-coder__read_plan');
    expect(getAppOwnedChurroCoderReadPlanToolName('churro-coder-dev')).toBe('mcp__churro-coder-dev__read_plan');
  });

  test('builds a recovery message for cli-missing approved-plan aborts', () => {
    expect(
      buildApprovedPlanReadPlanUnavailableMessage({
        mcpToolName: 'mcp__churro-coder-dev__read_plan',
        status: { state: 'cli-missing' }
      })
    ).toContain('Open Settings -> Integrations to reinstall the Codex CLI');
  });

  test('builds a recovery message for failed approved-plan aborts', () => {
    expect(
      buildApprovedPlanReadPlanUnavailableMessage({
        mcpToolName: 'mcp__churro-coder__read_plan',
        status: { state: 'failed', error: 'boom' }
      })
    ).toContain('boom Open Settings -> Integrations to verify the Codex CLI installation.');
  });
});
