import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  default: { access: vi.fn() }
}));

import fs from 'node:fs/promises';
import { detectOpenspecState } from './init-detection';

const mockAccess = vi.mocked(fs.access);

function existsFor(...paths: string[]) {
  mockAccess.mockImplementation(async (p) => {
    if (paths.some((allowed) => (p as string).endsWith(allowed))) return;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  mockAccess.mockReset();
});

describe('detectOpenspecState', () => {
  it('returns uninitialized when openspec/ dir is absent', async () => {
    existsFor(); // nothing exists
    const result = await detectOpenspecState('/proj');
    expect(result.state).toBe('uninitialized');
    expect(result.hasOpenspecDir).toBe(false);
    expect(result.missingTools).toEqual(['claude', 'codex']);
  });

  it('returns tools-missing when openspec/ exists but tool sentinels are absent', async () => {
    existsFor('openspec'); // only the dir
    const result = await detectOpenspecState('/proj');
    expect(result.state).toBe('tools-missing');
    expect(result.hasOpenspecDir).toBe(true);
    expect(result.missingTools).toEqual(['claude', 'codex']);
  });

  it('returns tools-missing when only one sentinel is absent', async () => {
    existsFor('openspec', '.claude/skills/openspec-propose/SKILL.md');
    const result = await detectOpenspecState('/proj');
    expect(result.state).toBe('tools-missing');
    expect(result.missingTools).toEqual(['codex']);
  });

  it('returns ok when openspec/ and all sentinels are present (no AGENTS.md needed)', async () => {
    existsFor('openspec', '.claude/skills/openspec-propose/SKILL.md', '.codex/skills/openspec-propose/SKILL.md');
    const result = await detectOpenspecState('/proj');
    expect(result.state).toBe('ok');
    expect(result.hasOpenspecDir).toBe(true);
    expect(result.missingTools).toEqual([]);
  });

  it('returns ok for a subset of tools when only those are requested', async () => {
    existsFor('openspec', '.claude/skills/openspec-propose/SKILL.md');
    const result = await detectOpenspecState('/proj', ['claude']);
    expect(result.state).toBe('ok');
    expect(result.missingTools).toEqual([]);
  });
});
