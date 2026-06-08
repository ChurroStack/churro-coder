import { describe, test, expect, beforeEach, vi } from 'vitest';

// env.ts reads `app.isPackaged` at module load.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { remapAsarToUnpacked, resolveClaudeCodeExecutable, clearClaudeExecutableCache } from './env';

describe('remapAsarToUnpacked', () => {
  test('remaps a packaged app.asar path to its app.asar.unpacked twin', () => {
    const packed =
      '/Applications/Churro Coder.app/Contents/Resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
    expect(remapAsarToUnpacked(packed)).toBe(
      '/Applications/Churro Coder.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'
    );
  });

  test('leaves an already-unpacked path unchanged', () => {
    const unpacked = '/x/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
    expect(remapAsarToUnpacked(unpacked)).toBe(unpacked);
  });

  test('is a no-op for a dev path with no app.asar segment', () => {
    const dev = '/repo/apps/desktop/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
    expect(remapAsarToUnpacked(dev)).toBe(dev);
  });

  test('remaps the LAST app.asar segment (the bundle container), not an ancestor dir named app.asar', () => {
    expect(remapAsarToUnpacked('/a/app.asar/b/app.asar/claude')).toBe('/a/app.asar/b/app.asar.unpacked/claude');
  });
});

describe('resolveClaudeCodeExecutable', () => {
  beforeEach(() => clearClaudeExecutableCache());

  test('returns a real native-CLI path on this host, or null (never throws)', () => {
    const p = resolveClaudeCodeExecutable();
    if (p !== null) {
      // dev: a concrete, existing file ending in the platform binary name and
      // never pointing inside an asar archive.
      expect(p.endsWith('claude') || p.endsWith('claude.exe')).toBe(true);
      expect(p.includes('app.asar')).toBe(false);
    }
  });

  test('is cached / idempotent across calls', () => {
    const a = resolveClaudeCodeExecutable();
    const b = resolveClaudeCodeExecutable();
    expect(a).toBe(b);
  });
});
