// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { mergeStoreFilesIntoSubChatFiles } from './use-sub-chat-files-sync';
import type { SubChatFileChange } from '../atoms';

describe('mergeStoreFilesIntoSubChatFiles', () => {
  test('seeds store paths into an empty map', () => {
    const prev = new Map<string, SubChatFileChange[]>();
    const next = mergeStoreFilesIntoSubChatFiles(prev, 'sc1', [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]);
    const files = next.get('sc1')!;
    expect(files.map((f) => f.filePath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files.every((f) => f.additions === 0 && f.deletions === 0)).toBe(true);
  });

  test('preserves existing builtin entries and only adds new paths', () => {
    const prev = new Map<string, SubChatFileChange[]>([
      ['sc1', [{ filePath: 'src/a.ts', displayPath: 'src/a.ts', additions: 10, deletions: 2 }]]
    ]);
    const next = mergeStoreFilesIntoSubChatFiles(prev, 'sc1', [{ path: 'src/a.ts' }, { path: 'src/c.ts' }]);
    const files = next.get('sc1')!;
    // Existing entry keeps its additions/deletions; only the new path is added.
    expect(files).toHaveLength(2);
    const a = files.find((f) => f.filePath === 'src/a.ts')!;
    expect(a.additions).toBe(10);
    expect(a.deletions).toBe(2);
    expect(files.some((f) => f.filePath === 'src/c.ts')).toBe(true);
  });

  test('returns the same map reference when nothing new is added', () => {
    const prev = new Map<string, SubChatFileChange[]>([
      ['sc1', [{ filePath: 'src/a.ts', displayPath: 'src/a.ts', additions: 1, deletions: 0 }]]
    ]);
    const next = mergeStoreFilesIntoSubChatFiles(prev, 'sc1', [{ path: 'src/a.ts' }]);
    expect(next).toBe(prev);
  });

  test('ignores empty paths', () => {
    const prev = new Map<string, SubChatFileChange[]>();
    const next = mergeStoreFilesIntoSubChatFiles(prev, 'sc1', [{ path: '' }]);
    expect(next).toBe(prev);
  });

  test('does not mutate the input map for other sub-chats', () => {
    const prev = new Map<string, SubChatFileChange[]>([
      ['other', [{ filePath: 'x.ts', displayPath: 'x.ts', additions: 0, deletions: 0 }]]
    ]);
    const next = mergeStoreFilesIntoSubChatFiles(prev, 'sc1', [{ path: 'new.ts' }]);
    expect(next).not.toBe(prev);
    expect(next.get('other')).toBe(prev.get('other'));
    expect(next.get('sc1')!.map((f) => f.filePath)).toEqual(['new.ts']);
  });
});
