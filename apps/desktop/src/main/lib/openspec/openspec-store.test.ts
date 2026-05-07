import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Mock electron BEFORE importing the store. The store calls `shell.trashItem`
// for deletes; redirect that to a destructive `rm -rf` so tests can assert
// folders are gone.
const trashItemMock = vi.fn(async (path: string) => {
  await rm(path, { recursive: true, force: true });
});
vi.mock('electron', () => ({
  shell: { trashItem: (p: string) => trashItemMock(p) }
}));

import {
  createChange,
  deleteChange,
  deleteChangeDelta,
  isInitialized,
  listArchivedChanges,
  listCapabilities,
  listChangeDeltas,
  listChanges,
  readArchivedChange,
  readArchivedChangeFile,
  readCapabilityFile,
  readChange,
  readChangeDelta,
  readChangeFile,
  readProjectContext,
  writeCapabilityFile,
  writeChangeDelta,
  writeChangeFile
} from './openspec-store';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'openspec-store-'));
  trashItemMock.mockClear();
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

async function seedFile(...parts: string[]): Promise<string> {
  const content = parts.pop()!;
  const filePath = join(rootDir, ...parts);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

const PROPOSAL_FIXTURE = `# Change: Add Two-Factor Auth

## Why
Stronger account protection.

## What Changes
- OTP delivery
- Backup codes

## Impact
- Affected specs: auth
- Affected code: src/auth
`;

const TASKS_FIXTURE = `## 1. Implementation
- [x] 1.1 Schema
- [ ] 1.2 Endpoint
- [ ] 1.3 UI
`;

const DELTA_FIXTURE = `## ADDED Requirements
### Requirement: Two-Factor Authentication
Users MUST provide a second factor.

#### Scenario: OTP required
- **WHEN** valid creds
- **THEN** OTP challenge
`;

describe('isInitialized', () => {
  test('false when openspec/ does not exist', async () => {
    expect(await isInitialized(rootDir)).toBe(false);
  });

  test('true when openspec/ exists', async () => {
    await mkdir(join(rootDir, 'openspec'), { recursive: true });
    expect(await isInitialized(rootDir)).toBe(true);
  });
});

describe('listChanges', () => {
  test('returns empty array when no changes/ folder', async () => {
    expect(await listChanges(rootDir)).toEqual([]);
  });

  test('lists active changes with parsed metadata', async () => {
    await seedFile('openspec', 'changes', 'add-two-factor-auth', 'proposal.md', PROPOSAL_FIXTURE);
    await seedFile('openspec', 'changes', 'add-two-factor-auth', 'tasks.md', TASKS_FIXTURE);
    await seedFile('openspec', 'changes', 'add-two-factor-auth', 'specs', 'auth', 'spec.md', DELTA_FIXTURE);

    const changes = await listChanges(rootDir);
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.changeId).toBe('add-two-factor-auth');
    expect(c.hasProposal).toBe(true);
    expect(c.hasTasks).toBe(true);
    expect(c.hasDesign).toBe(false);
    expect(c.capabilities).toEqual(['auth']);
    expect(c.taskProgress).toEqual({ total: 3, done: 1 });
    expect(c.proposal?.title).toBe('Add Two-Factor Auth');
    expect(c.proposal?.whatChanges).toEqual(['OTP delivery', 'Backup codes']);
  });

  test('skips archive/ folder', async () => {
    await seedFile('openspec', 'changes', 'add-foo', 'proposal.md', '# foo');
    await seedFile('openspec', 'changes', 'archive', '2026-01-01-old', 'proposal.md', '# old');
    const changes = await listChanges(rootDir);
    expect(changes.map((c) => c.changeId)).toEqual(['add-foo']);
  });

  test('skips folders that are not legal change ids', async () => {
    await seedFile('openspec', 'changes', 'add-foo', 'proposal.md', '# foo');
    await seedFile('openspec', 'changes', 'NotKebab', 'proposal.md', '# x');
    const changes = await listChanges(rootDir);
    expect(changes.map((c) => c.changeId)).toEqual(['add-foo']);
  });

  test('changes without proposal.md still appear (with hasProposal=false)', async () => {
    await mkdir(join(rootDir, 'openspec', 'changes', 'add-bare'), { recursive: true });
    const changes = await listChanges(rootDir);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.hasProposal).toBe(false);
    expect(changes[0]!.proposal).toBeUndefined();
  });

  test('result is sorted by modifiedAt descending', async () => {
    await seedFile('openspec', 'changes', 'first', 'proposal.md', '# first');
    // Force a small mtime gap so ordering is deterministic.
    await new Promise((r) => setTimeout(r, 20));
    await seedFile('openspec', 'changes', 'second', 'proposal.md', '# second');
    const changes = await listChanges(rootDir);
    expect(changes.map((c) => c.changeId)).toEqual(['second', 'first']);
  });
});

describe('readChange / readChangeFile', () => {
  test('readChange returns null for missing change', async () => {
    expect(await readChange(rootDir, 'nope-nope')).toBeNull();
  });

  test('readChangeFile returns null for missing file', async () => {
    await seedFile('openspec', 'changes', 'add-foo', 'proposal.md', '# foo');
    expect(await readChangeFile(rootDir, 'add-foo', 'design')).toBeNull();
  });

  test('readChangeFile returns content + mtime when file exists', async () => {
    await seedFile('openspec', 'changes', 'add-foo', 'proposal.md', PROPOSAL_FIXTURE);
    const r = await readChangeFile(rootDir, 'add-foo', 'proposal');
    expect(r).not.toBeNull();
    expect(r!.content).toBe(PROPOSAL_FIXTURE);
    expect(typeof r!.modifiedAt).toBe('string');
  });

  test('rejects invalid changeId', async () => {
    await expect(readChange(rootDir, '../escape')).rejects.toThrow();
    await expect(readChangeFile(rootDir, '../escape', 'proposal')).rejects.toThrow();
  });
});

describe('writeChangeFile', () => {
  test('creates the change folder + file', async () => {
    await writeChangeFile(rootDir, 'add-foo', 'proposal', '# hi');
    const r = await readChangeFile(rootDir, 'add-foo', 'proposal');
    expect(r!.content).toBe('# hi');
  });

  test('overwrites existing content', async () => {
    await writeChangeFile(rootDir, 'add-foo', 'proposal', 'first');
    await writeChangeFile(rootDir, 'add-foo', 'proposal', 'second');
    const r = await readChangeFile(rootDir, 'add-foo', 'proposal');
    expect(r!.content).toBe('second');
  });

  test('atomic: no .tmp leftovers after success', async () => {
    await writeChangeFile(rootDir, 'add-foo', 'proposal', 'body');
    const dir = join(rootDir, 'openspec', 'changes', 'add-foo');
    const files = await readdir(dir);
    expect(files.some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(files).toContain('proposal.md');
  });

  test('rejects path traversal in changeId', async () => {
    await expect(writeChangeFile(rootDir, '..', 'proposal', 'body')).rejects.toThrow();
  });
});

describe('createChange', () => {
  test('writes only the files provided', async () => {
    await createChange(rootDir, 'add-foo', { proposal: '# hi', tasks: '- [ ] do' });
    expect((await readChangeFile(rootDir, 'add-foo', 'proposal'))!.content).toBe('# hi');
    expect((await readChangeFile(rootDir, 'add-foo', 'tasks'))!.content).toBe('- [ ] do');
    expect(await readChangeFile(rootDir, 'add-foo', 'design')).toBeNull();
  });

  test('throws when change already exists', async () => {
    await createChange(rootDir, 'add-foo', { proposal: '# hi' });
    await expect(createChange(rootDir, 'add-foo', { proposal: '# again' })).rejects.toThrow(/already exists/);
  });

  test('rejects invalid changeId', async () => {
    await expect(createChange(rootDir, 'BadId', { proposal: '# x' })).rejects.toThrow(/kebab-case/);
  });

  test('creates an empty change folder when no files provided', async () => {
    await createChange(rootDir, 'add-empty', {});
    const summary = await readChange(rootDir, 'add-empty');
    expect(summary).not.toBeNull();
    expect(summary!.hasProposal).toBe(false);
    expect(summary!.hasTasks).toBe(false);
    expect(summary!.hasDesign).toBe(false);
  });
});

describe('deleteChange', () => {
  test('moves the change folder to trash via shell.trashItem', async () => {
    await createChange(rootDir, 'add-foo', { proposal: '# hi' });
    await deleteChange(rootDir, 'add-foo');
    expect(trashItemMock).toHaveBeenCalledTimes(1);
    expect(trashItemMock.mock.calls[0]![0]).toContain(join('changes', 'add-foo'));
    // Mock implementation hard-deletes, so the folder is gone.
    await expect(stat(join(rootDir, 'openspec', 'changes', 'add-foo'))).rejects.toThrow(/ENOENT/);
  });

  test('throws when change is missing', async () => {
    await expect(deleteChange(rootDir, 'nope-nope')).rejects.toThrow(/not found/);
  });

  test('rejects invalid changeId', async () => {
    await expect(deleteChange(rootDir, '..')).rejects.toThrow();
  });
});

describe('change deltas (specs/ inside a change)', () => {
  test('listChangeDeltas returns capabilities with paths', async () => {
    await seedFile('openspec', 'changes', 'add-foo', 'specs', 'auth', 'spec.md', DELTA_FIXTURE);
    await seedFile('openspec', 'changes', 'add-foo', 'specs', 'notifications', 'spec.md', DELTA_FIXTURE);

    const deltas = await listChangeDeltas(rootDir, 'add-foo');
    expect(deltas.map((d) => d.capabilityId)).toEqual(['auth', 'notifications']);
    expect(deltas[0]!.path).toContain(join('changes', 'add-foo', 'specs', 'auth', 'spec.md'));
  });

  test('listChangeDeltas returns [] when specs/ missing', async () => {
    await createChange(rootDir, 'add-foo', { proposal: '# hi' });
    expect(await listChangeDeltas(rootDir, 'add-foo')).toEqual([]);
  });

  test('readChangeDelta parses well-formed content', async () => {
    await seedFile('openspec', 'changes', 'add-foo', 'specs', 'auth', 'spec.md', DELTA_FIXTURE);
    const r = await readChangeDelta(rootDir, 'add-foo', 'auth');
    expect(r).not.toBeNull();
    expect(r!.parsed?.added).toHaveLength(1);
    expect(r!.parsed?.added[0]!.name).toBe('Two-Factor Authentication');
  });

  test('readChangeDelta returns null for missing file', async () => {
    expect(await readChangeDelta(rootDir, 'add-foo', 'auth')).toBeNull();
  });

  test('writeChangeDelta creates capability folder + file', async () => {
    await writeChangeDelta(rootDir, 'add-foo', 'auth', DELTA_FIXTURE);
    const r = await readChangeDelta(rootDir, 'add-foo', 'auth');
    expect(r!.content).toBe(DELTA_FIXTURE);
    expect(r!.parsed?.added).toHaveLength(1);
  });

  test('deleteChangeDelta removes the capability folder', async () => {
    await writeChangeDelta(rootDir, 'add-foo', 'auth', DELTA_FIXTURE);
    await deleteChangeDelta(rootDir, 'add-foo', 'auth');
    expect(trashItemMock).toHaveBeenCalledTimes(1);
    expect(await readChangeDelta(rootDir, 'add-foo', 'auth')).toBeNull();
  });

  test('rejects invalid capability id', async () => {
    await expect(readChangeDelta(rootDir, 'add-foo', '../evil')).rejects.toThrow();
    await expect(writeChangeDelta(rootDir, 'add-foo', '..', DELTA_FIXTURE)).rejects.toThrow();
  });
});

describe('archived changes', () => {
  test('listArchivedChanges parses YYYY-MM-DD prefix', async () => {
    await seedFile(
      'openspec',
      'changes',
      'archive',
      '2026-03-05-add-foo',
      'proposal.md',
      '# Change: Old foo\n\n## Why\nbecause\n'
    );
    await seedFile(
      'openspec',
      'changes',
      'archive',
      '2026-04-12-add-bar',
      'proposal.md',
      '# Change: Old bar\n\n## Why\nbecause\n'
    );

    const archives = await listArchivedChanges(rootDir);
    expect(archives).toHaveLength(2);
    expect(archives.map((a) => a.archiveFolder)).toEqual(['2026-04-12-add-bar', '2026-03-05-add-foo']);
    expect(archives[0]!.changeId).toBe('add-bar');
    expect(archives[0]!.archivedAt).toBe('2026-04-12');
    expect(archives[0]!.proposal?.title).toBe('Old bar');
  });

  test('listArchivedChanges ignores folders that do not match the date pattern', async () => {
    await seedFile('openspec', 'changes', 'archive', '2026-03-05-add-foo', 'proposal.md', '# x');
    await mkdir(join(rootDir, 'openspec', 'changes', 'archive', 'not-a-date'), { recursive: true });
    const archives = await listArchivedChanges(rootDir);
    expect(archives).toHaveLength(1);
  });

  test('readArchivedChange returns null for malformed folder name', async () => {
    expect(await readArchivedChange(rootDir, 'not-a-date')).toBeNull();
  });

  test('readArchivedChangeFile returns content for valid archive', async () => {
    await seedFile('openspec', 'changes', 'archive', '2026-03-05-add-foo', 'proposal.md', '# hi');
    const r = await readArchivedChangeFile(rootDir, '2026-03-05-add-foo', 'proposal');
    expect(r!.content).toBe('# hi');
  });
});

describe('current specs (capabilities)', () => {
  test('listCapabilities returns sorted capability summaries', async () => {
    await seedFile('openspec', 'specs', 'auth', 'spec.md', '# Auth spec');
    await seedFile('openspec', 'specs', 'auth', 'design.md', '# Auth design');
    await seedFile('openspec', 'specs', 'payments', 'spec.md', '# Payments');
    const caps = await listCapabilities(rootDir);
    expect(caps.map((c) => c.capabilityId)).toEqual(['auth', 'payments']);
    expect(caps[0]!.hasSpec).toBe(true);
    expect(caps[0]!.hasDesign).toBe(true);
    expect(caps[1]!.hasSpec).toBe(true);
    expect(caps[1]!.hasDesign).toBe(false);
  });

  test('listCapabilities returns [] when specs/ missing', async () => {
    expect(await listCapabilities(rootDir)).toEqual([]);
  });

  test('readCapabilityFile round-trips with writeCapabilityFile', async () => {
    await writeCapabilityFile(rootDir, 'auth', 'spec', '# Auth');
    const r = await readCapabilityFile(rootDir, 'auth', 'spec');
    expect(r!.content).toBe('# Auth');
  });

  test('readCapabilityFile returns null for missing file', async () => {
    expect(await readCapabilityFile(rootDir, 'auth', 'spec')).toBeNull();
  });
});

describe('readProjectContext', () => {
  test('returns empty object when neither file exists', async () => {
    expect(await readProjectContext(rootDir)).toEqual({});
  });

  test('returns project.md and AGENTS.md when present', async () => {
    await seedFile('openspec', 'project.md', '# Project');
    await seedFile('openspec', 'AGENTS.md', '# Agents');
    const ctx = await readProjectContext(rootDir);
    expect(ctx.projectMd).toBe('# Project');
    expect(ctx.agentsMd).toBe('# Agents');
  });

  test('returns only the file that exists', async () => {
    await seedFile('openspec', 'project.md', '# Project');
    const ctx = await readProjectContext(rootDir);
    expect(ctx.projectMd).toBe('# Project');
    expect(ctx.agentsMd).toBeUndefined();
  });
});

describe('rootDir validation', () => {
  test('rejects relative rootDir', async () => {
    await expect(listChanges('relative/path')).rejects.toThrow(/absolute/);
  });

  test('rejects empty rootDir', async () => {
    await expect(listChanges('')).rejects.toThrow(/non-empty/);
  });
});
