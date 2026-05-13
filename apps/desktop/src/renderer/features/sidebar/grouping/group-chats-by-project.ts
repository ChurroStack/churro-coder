export type ProjectRecord = {
  id: string;
  name: string | null;
  path: string;
  gitRemoteUrl?: string | null;
  gitProvider?: string | null;
  gitOwner?: string | null;
  gitRepo?: string | null;
  iconPath?: string | null;
  updatedAt?: string | Date | null;
};

export type GroupableAgentChat = {
  id: string;
  name: string | null;
  branch: string | null;
  updatedAt: Date | null;
  projectId: string | null;
  isRemote: boolean;
};

export type ProjectGroup = {
  id: string;
  kind: 'local' | 'unknown';
  project: ProjectRecord | null;
  displayName: string;
  chats: GroupableAgentChat[];
  lastActivityAt: number;
};

export type WorkspaceStatus = 'pendingQuestion' | 'loading' | 'pendingPlan' | 'unseen' | 'none';

const STATUS_PRIORITY: WorkspaceStatus[] = ['pendingQuestion', 'loading', 'pendingPlan', 'unseen', 'none'];

export function reduceProjectStatus(statuses: WorkspaceStatus[]): WorkspaceStatus {
  for (const status of STATUS_PRIORITY) {
    if (statuses.includes(status)) {
      return status;
    }
  }

  return 'none';
}

export function groupChatsByProject(
  chats: GroupableAgentChat[],
  projectsMap: Map<string, ProjectRecord>,
  opts: { excludePinnedChatIds?: Set<string> } = {}
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const excludePinnedChatIds = opts.excludePinnedChatIds ?? new Set<string>();

  for (const chat of chats) {
    if (chat.isRemote || excludePinnedChatIds.has(chat.id)) {
      continue;
    }

    const project = chat.projectId ? (projectsMap.get(chat.projectId) ?? null) : null;
    const isKnownProject = Boolean(chat.projectId && project);
    const id = isKnownProject && project ? project.id : '__unknown__';
    const kind: ProjectGroup['kind'] = isKnownProject ? 'local' : 'unknown';
    const displayName = isKnownProject && project ? project.gitRepo || project.name || 'Untitled project' : 'Other';
    const lastActivityAt = chat.updatedAt?.getTime() ?? 0;

    const group = groups.get(id);
    if (group) {
      group.chats.push(chat);
      group.lastActivityAt = Math.max(group.lastActivityAt, lastActivityAt);
      continue;
    }

    groups.set(id, {
      id,
      kind,
      project,
      displayName,
      chats: [chat],
      lastActivityAt
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      chats: [...group.chats].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
    }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
