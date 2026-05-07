// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { groupChatsByProject } from './group-chats-by-project';

describe('groupChatsByProject', () => {
  it('groups local chats by project, sorts chats/groups, filters remote chats, and excludes pinned chats', () => {
    const projectsMap = new Map([
      ['p1', { id: 'p1', name: 'Alpha', path: '/alpha' }],
      ['p2', { id: 'p2', name: 'Beta', path: '/beta' }]
    ]);

    const groups = groupChatsByProject(
      [
        { id: 'c1', name: 'one', updatedAt: new Date('2026-05-07T10:00:00Z'), projectId: 'p1', isRemote: false },
        { id: 'c2', name: 'two', updatedAt: new Date('2026-05-07T12:00:00Z'), projectId: 'p1', isRemote: false },
        { id: 'c3', name: 'three', updatedAt: new Date('2026-05-07T11:00:00Z'), projectId: 'p2', isRemote: false },
        { id: 'c4', name: 'four', updatedAt: new Date('2026-05-07T13:00:00Z'), projectId: 'missing', isRemote: false },
        { id: 'remote_1', name: 'remote', updatedAt: new Date('2026-05-07T14:00:00Z'), projectId: null, isRemote: true }
      ],
      projectsMap,
      { excludePinnedChatIds: new Set(['c3']) }
    );

    expect(groups.map((group) => group.id)).toEqual(['__unknown__', 'p1']);
    expect(groups[0]?.kind).toBe('unknown');
    expect(groups[0]?.displayName).toBe('Other');
    expect(groups[1]?.chats.map((chat) => chat.id)).toEqual(['c2', 'c1']);
    expect(groups[1]?.lastActivityAt).toBe(new Date('2026-05-07T12:00:00Z').getTime());
  });
});
