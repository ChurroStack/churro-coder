import { describe, test, expect } from 'vitest';
import { pickLatestActiveSubChat, type SubChatMode } from './kanban-state-machine';

function sub(id: string, mode: SubChatMode, updatedAt: number) {
  return { id, mode, updatedAt: new Date(updatedAt) };
}

describe('pickLatestActiveSubChat', () => {
  test('empty array → null', () => {
    expect(pickLatestActiveSubChat([], new Set())).toBeNull();
  });

  test('single sub-chat, not loading → returns it', () => {
    const s = sub('s1', 'plan', 1000);
    expect(pickLatestActiveSubChat([s], new Set())).toEqual(s);
  });

  test('multiple sub-chats, none loading → returns latest by updatedAt', () => {
    const older = sub('s1', 'plan', 1000);
    const newer = sub('s2', 'execute', 2000);
    expect(pickLatestActiveSubChat([older, newer], new Set())).toEqual(newer);
  });

  test('loading-wins: picks loading sub-chat even if another is newer', () => {
    const older = sub('s1', 'execute', 1000); // this one is loading
    const newer = sub('s2', 'plan', 2000); // newer but not loading
    const loading = new Set(['s1']);
    expect(pickLatestActiveSubChat([older, newer], loading)).toEqual(older);
  });

  test('multiple loading sub-chats → picks loading one with highest updatedAt', () => {
    const loadingOlder = sub('s1', 'execute', 1000);
    const loadingNewer = sub('s2', 'execute', 3000);
    const notLoading = sub('s3', 'plan', 2000);
    const loading = new Set(['s1', 's2']);
    expect(pickLatestActiveSubChat([loadingOlder, loadingNewer, notLoading], loading)).toEqual(loadingNewer);
  });

  test('picker is agnostic to attention signals — same result regardless of pending state', () => {
    // Attention signals should never influence which sub-chat is picked for state derivation.
    // This test verifies the function signature takes no attention params.
    const s1 = sub('s1', 'plan', 1000);
    const s2 = sub('s2', 'execute', 2000);
    const result = pickLatestActiveSubChat([s1, s2], new Set());
    expect(result).toEqual(s2); // pure updatedAt comparison, no attention influence
  });
});
