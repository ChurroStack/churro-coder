// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useGroupedAgentChats } from './use-grouped-agent-chats';

describe('useGroupedAgentChats', () => {
  const chats = [
    {
      id: 'c1',
      name: 'Alpha one',
      updatedAt: new Date('2026-05-07T10:00:00Z'),
      projectId: 'p1',
      isRemote: false,
      branch: null
    },
    {
      id: 'c2',
      name: 'Beta two',
      updatedAt: new Date('2026-05-07T11:00:00Z'),
      projectId: 'p2',
      isRemote: false,
      branch: null
    }
  ];
  const projectsMap = new Map([
    ['p1', { id: 'p1', name: 'Alpha', path: '/alpha' }],
    ['p2', { id: 'p2', name: 'Beta', path: '/beta' }],
    ['p3', { id: 'p3', name: 'Gamma', path: '/gamma' }]
  ]);
  const statusMaps = {
    loadingChatIds: new Set<string>(),
    workspacePendingQuestions: new Set<string>(),
    workspacePendingPlans: new Set<string>(),
    unseenChanges: new Set<string>()
  };

  it('hides empty groups and force-expands during search', () => {
    const { result } = renderHook(() => useGroupedAgentChats(chats, projectsMap, new Set(), 'alpha', statusMaps));

    expect(result.current.isSearching).toBe(true);
    expect(result.current.forceExpandAll).toBe(true);
    expect(result.current.visibleGroups.map((group) => group.id)).toEqual(['p1']);
  });

  it('restores empty groups when search is cleared', () => {
    const { result } = renderHook(() => useGroupedAgentChats(chats, projectsMap, new Set(), '', statusMaps));

    expect(result.current.isSearching).toBe(false);
    expect(result.current.forceExpandAll).toBe(false);
    expect(result.current.visibleGroups.map((group) => group.id)).toEqual(['p2', 'p1', 'p3']);
    expect(result.current.visibleGroups.find((group) => group.id === 'p3')?.chats).toEqual([]);
  });

  it('shows loading (not pendingQuestion) when a busy workspace still carries a question', () => {
    // Regression: a workspace that is busy AND has a stale/expired question must
    // resolve to 'loading' at the project level, mirroring the workspace-row badge.
    const busyAndQuestion = {
      ...statusMaps,
      loadingChatIds: new Set(['c1']),
      workspacePendingQuestions: new Set(['c1'])
    };
    const { result } = renderHook(() => useGroupedAgentChats(chats, projectsMap, new Set(), '', busyAndQuestion));

    expect(result.current.visibleGroups.find((group) => group.id === 'p1')?.status).toBe('loading');
  });

  it('surfaces pendingQuestion across siblings even when one workspace is busy', () => {
    // Two workspaces in one project: c1 busy, c2 genuinely waiting (not busy).
    // The cross-workspace reducer must still surface the question.
    const sharedProjectChats = [
      { ...chats[0], id: 'c1', projectId: 'p1' },
      { ...chats[1], id: 'c2', projectId: 'p1' }
    ];
    const busyPlusWaiting = {
      ...statusMaps,
      loadingChatIds: new Set(['c1']),
      workspacePendingQuestions: new Set(['c2'])
    };
    const { result } = renderHook(() =>
      useGroupedAgentChats(sharedProjectChats, projectsMap, new Set(), '', busyPlusWaiting)
    );

    expect(result.current.visibleGroups.find((group) => group.id === 'p1')?.status).toBe('pendingQuestion');
  });
});
