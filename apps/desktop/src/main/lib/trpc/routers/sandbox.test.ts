import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.fn();
const publicProcedure = {
  query: vi.fn((fn) => fn),
  input: vi.fn(() => ({
    mutation: (fn: unknown) => fn,
    query: (fn: unknown) => fn
  }))
};

vi.mock('fs/promises', () => ({
  default: { readFile },
  readFile
}));

vi.mock('../index', () => ({
  publicProcedure,
  router: (routes: unknown) => routes
}));

vi.mock('../../db', () => ({
  getDatabase: vi.fn(),
  sandboxSettings: {},
  projects: {},
  chats: {}
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn()
}));

const { readClaudeBypassReasons, readCodexBypassReason } = await import('./sandbox');

describe('sandbox bypass detection', () => {
  beforeEach(() => {
    readFile.mockReset();
  });

  it('parses Claude settings.local.json as JSONC and reports sandbox disablement', async () => {
    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('settings.json')) {
        throw new Error('missing');
      }
      if (filePath.endsWith('settings.local.json')) {
        return `{
          // local override
          "sandbox": {
            "enabled": false,
          },
        }`;
      }
      throw new Error(`unexpected file: ${filePath}`);
    });

    await expect(readClaudeBypassReasons('/fake/.claude')).resolves.toEqual([
      'Claude config (~/.claude/settings.local.json) sets sandbox.enabled = false.'
    ]);
  });

  it('prefers settings.local.json over settings.json and avoids duplicate reasons', async () => {
    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('settings.json')) {
        return JSON.stringify({
          sandbox: { enabled: false },
          permissions: { defaultMode: 'bypassPermissions' }
        });
      }
      if (filePath.endsWith('settings.local.json')) {
        return JSON.stringify({
          sandbox: { enabled: false }
        });
      }
      throw new Error(`unexpected file: ${filePath}`);
    });

    await expect(readClaudeBypassReasons('/fake/.claude')).resolves.toEqual([
      'Claude config (~/.claude/settings.local.json) sets sandbox.enabled = false.',
      'Claude config (~/.claude/settings.json) sets permissions.defaultMode = "bypassPermissions".'
    ]);
  });

  it('ignores profile-scoped Codex sandbox_mode and only reports top-level danger-full-access', async () => {
    readFile.mockResolvedValue(`[profiles.safe]\nsandbox_mode = "danger-full-access"\n`);
    await expect(readCodexBypassReason('/fake/.codex/config.toml')).resolves.toBeNull();

    readFile.mockResolvedValue(`sandbox_mode = "danger-full-access"\n[profiles.safe]\nsandbox_mode = "read-only"\n`);
    await expect(readCodexBypassReason('/fake/.codex/config.toml')).resolves.toBe(
      'Codex config (~/.codex/config.toml) sets top-level sandbox_mode = "danger-full-access".'
    );
  });

  it('swallows invalid Claude config content without crashing', async () => {
    readFile.mockResolvedValue('{ invalid jsonc');

    await expect(readClaudeBypassReasons('/fake/.claude')).resolves.toEqual([]);
  });
});
