import { describe, expect, test } from 'vitest';
import { join } from 'node:path';
import {
  archivedFolderRegex,
  parseArchivedFolder,
  resolveRoot,
  validateCapabilityId,
  validateChangeId,
  validateInsideOpenspec
} from './paths';

describe('resolveRoot', () => {
  test('returns derived openspec subdirectories', () => {
    const r = resolveRoot('/tmp/proj');
    expect(r.rootDir).toBe('/tmp/proj');
    expect(r.openspecDir).toBe('/tmp/proj/openspec');
    expect(r.changesDir).toBe('/tmp/proj/openspec/changes');
    expect(r.archiveDir).toBe('/tmp/proj/openspec/changes/archive');
    expect(r.specsDir).toBe('/tmp/proj/openspec/specs');
  });

  test('rejects relative paths', () => {
    expect(() => resolveRoot('proj')).toThrow(/absolute/);
  });

  test('rejects empty input', () => {
    expect(() => resolveRoot('')).toThrow(/non-empty/);
  });

  test('rejects null bytes', () => {
    expect(() => resolveRoot('/tmp/proj\0evil')).toThrow(/invalid characters/);
  });
});

describe('validateChangeId / validateCapabilityId', () => {
  test('accepts kebab-case ids', () => {
    expect(() => validateChangeId('add-two-factor-auth')).not.toThrow();
    expect(() => validateChangeId('add')).not.toThrow();
    expect(() => validateChangeId('a1-b2')).not.toThrow();
    expect(() => validateCapabilityId('user-auth')).not.toThrow();
  });

  test('rejects path traversal', () => {
    expect(() => validateChangeId('..')).toThrow();
    expect(() => validateChangeId('.')).toThrow();
    expect(() => validateChangeId('foo/bar')).toThrow(/path separators/);
    expect(() => validateChangeId('foo\\bar')).toThrow(/path separators/);
    expect(() => validateChangeId('foo\0bar')).toThrow(/invalid characters/);
  });

  test('rejects non-kebab-case', () => {
    expect(() => validateChangeId('CamelCase')).toThrow(/kebab-case/);
    expect(() => validateChangeId('snake_case')).toThrow(/kebab-case/);
    expect(() => validateChangeId('with spaces')).toThrow(/kebab-case/);
    expect(() => validateChangeId('-leading')).toThrow(/kebab-case/);
    expect(() => validateChangeId('trailing-')).toThrow(/kebab-case/);
    expect(() => validateChangeId('double--hyphen')).toThrow(/kebab-case/);
  });

  test('rejects empty / oversized', () => {
    expect(() => validateChangeId('')).toThrow(/non-empty/);
    expect(() => validateChangeId('a'.repeat(101))).toThrow(/too long/);
  });

  test('rejects leading dot', () => {
    expect(() => validateChangeId('.hidden')).toThrow(/dot/);
  });
});

describe('parseArchivedFolder', () => {
  test('parses YYYY-MM-DD prefix and change id', () => {
    expect(parseArchivedFolder('2026-03-05-add-two-factor-auth')).toEqual({
      archivedAt: '2026-03-05',
      changeId: 'add-two-factor-auth'
    });
  });

  test('rejects names without date prefix', () => {
    expect(() => parseArchivedFolder('add-two-factor-auth')).toThrow();
  });

  test('rejects malformed dates', () => {
    expect(() => parseArchivedFolder('20260305-foo')).toThrow();
    expect(() => parseArchivedFolder('2026-3-5-foo')).toThrow();
  });

  test('rejects calendar-invalid dates that match the regex shape', () => {
    expect(() => parseArchivedFolder('2026-13-05-foo')).toThrow(/date/);
    expect(() => parseArchivedFolder('2026-02-30-foo')).toThrow(/date/);
    expect(() => parseArchivedFolder('2026-00-01-foo')).toThrow(/date/);
  });

  test('archivedFolderRegex captures groups directly', () => {
    const m = archivedFolderRegex.exec('2026-12-31-some-change');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('2026-12-31');
    expect(m![2]).toBe('some-change');
  });
});

describe('validateInsideOpenspec', () => {
  const openspecDir = '/tmp/proj/openspec';

  test('accepts paths inside openspec', () => {
    expect(() => validateInsideOpenspec(join(openspecDir, 'changes', 'foo', 'proposal.md'), openspecDir)).not.toThrow();
    expect(() => validateInsideOpenspec(openspecDir, openspecDir)).not.toThrow();
  });

  test('rejects path-traversal attempts', () => {
    expect(() => validateInsideOpenspec('/tmp/proj/openspec/../etc/passwd', openspecDir)).toThrow(/escapes/);
    expect(() => validateInsideOpenspec('/tmp/proj/somewhere-else', openspecDir)).toThrow(/escapes/);
  });

  test('rejects sibling with shared prefix', () => {
    // /tmp/proj/openspec-evil should NOT pass even though it starts with /tmp/proj/openspec
    expect(() => validateInsideOpenspec('/tmp/proj/openspec-evil/file.md', openspecDir)).toThrow(/escapes/);
  });

  test('rejects relative input', () => {
    expect(() => validateInsideOpenspec('changes/foo', openspecDir)).toThrow(/absolute/);
  });

  test('rejects null bytes', () => {
    expect(() => validateInsideOpenspec('/tmp/proj/openspec/foo\0', openspecDir)).toThrow(/invalid characters/);
  });
});
