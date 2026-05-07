import { useMemo } from 'react';
import {
  groupChatsByProject,
  reduceProjectStatus,
  type GroupableAgentChat,
  type ProjectGroup,
  type ProjectRecord
} from './group-chats-by-project';

export type ChatStatusMaps = {
  loadingChatIds: Set<string>;
  workspacePendingQuestions: Set<string>;
  workspacePendingPlans: Set<string>;
  unseenChanges: Set<string>;
};

export type GroupedProject = ProjectGroup & {
  status: ReturnType<typeof reduceProjectStatus>;
};

export function useGroupedAgentChats(
  chats: GroupableAgentChat[],
  projectsMap: Map<string, ProjectRecord>,
  pinnedChatIds: Set<string>,
  searchQuery: string,
  statusMaps: ChatStatusMaps
) {
  return useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const isSearching = normalizedQuery.length > 0;
    const filteredChats = isSearching
      ? chats.filter((chat) => (chat.name ?? '').toLowerCase().includes(normalizedQuery))
      : chats;

    const groups = groupChatsByProject(filteredChats, projectsMap, {
      excludePinnedChatIds: pinnedChatIds
    }).map((group) => ({
      ...group,
      status: reduceProjectStatus(
        group.chats.map((chat) => {
          if (statusMaps.workspacePendingQuestions.has(chat.id)) return 'pendingQuestion';
          if (statusMaps.loadingChatIds.has(chat.id)) return 'loading';
          if (statusMaps.workspacePendingPlans.has(chat.id)) return 'pendingPlan';
          if (statusMaps.unseenChanges.has(chat.id)) return 'unseen';
          return 'none';
        })
      )
    }));

    if (!isSearching) {
      const seenGroupIds = new Set(groups.map((group) => group.id));
      for (const project of projectsMap.values()) {
        if (seenGroupIds.has(project.id)) continue;
        groups.push({
          id: project.id,
          kind: 'local',
          project,
          displayName: project.gitRepo || project.name || 'Untitled project',
          chats: [],
          lastActivityAt: 0,
          status: 'none'
        });
      }

      groups.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    }

    return {
      groups,
      visibleGroups: isSearching ? groups.filter((group) => group.chats.length > 0) : groups,
      isSearching,
      forceExpandAll: isSearching
    };
  }, [chats, projectsMap, pinnedChatIds, searchQuery, statusMaps]);
}
