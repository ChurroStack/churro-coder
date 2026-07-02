import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { RefreshCw, ListTodo, AlertCircle } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { agentsSidebarOpenAtom } from '../../lib/atoms';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { AgentsHeaderControls } from '../agents/ui/agents-header-controls';
import { WorkItemRow } from './work-item-row';
import { StartSessionDialog } from './start-session-dialog';
import { CloneAndStartDialog } from './clone-and-start-dialog';
import { desktopViewAtom, showNewChatFormAtom, selectedDraftIdAtom } from '../agents/atoms';
import { selectWorkspace } from '../agents/stores/sub-chat-store';
import type { WorkItem } from '../../../main/lib/work-items/types';

type VisibilityFilter = 'all' | 'opened-locally' | 'needs-clone';
type SortMode = 'recently-updated' | 'recently-created' | 'repo-name';

function parseMyWorkChatName(name: string): { issueNumber: string; title: string } | null {
  const match = name.match(/^#(\d+):\s*(.+)$/);
  if (!match) return null;
  return { issueNumber: match[1], title: match[2] };
}

export function MyWorkView() {
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [cloneItem, setCloneItem] = useState<WorkItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recently-updated');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const setDesktopView = useSetAtom(desktopViewAtom);
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom);
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom);

  const { data: projects } = trpc.projects.list.useQuery();
  const { data, isLoading, error, refetch, isFetching } = trpc.workItems.list.useQuery(undefined, {
    staleTime: 60_000,
    gcTime: 120_000
  });

  const refresh = trpc.workItems.refresh.useMutation({
    onSuccess: () => {
      void refetch();
    }
  });

  const loadMore = trpc.workItems.loadMore.useMutation({
    onSuccess: () => {
      void refetch();
    }
  });

  const hasNextPage = data?.pageInfo?.hasNextPage ?? false;
  const endCursor = data?.pageInfo?.endCursor ?? null;

  const projectIdForItem = useCallback(
    (item: WorkItem): string | null => {
      if (!projects) return null;
      const match = projects.find(
        (project) =>
          project.gitProvider === 'github' && project.gitOwner === item.repoOwner && project.gitRepo === item.repoName
      );
      return match?.id ?? null;
    },
    [projects]
  );

  // Collect projectIds that appear in the issue list so we can query linked chats
  const linkedProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of data?.items ?? []) {
      const pid = projectIdForItem(item);
      if (pid) ids.add(pid);
    }
    return Array.from(ids);
  }, [data?.items, projectIdForItem]);

  const { data: linkedChatsData } = trpc.workItems.linkedChats.useQuery(
    { projectIds: linkedProjectIds },
    { enabled: linkedProjectIds.length > 0, staleTime: 30_000 }
  );

  const issueTitleByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.items ?? []) {
      const projectId = projectIdForItem(item);
      if (!projectId) continue;
      map.set(`${projectId}:${item.number}`, item.title);
    }
    return map;
  }, [data?.items, projectIdForItem]);

  // Map `${projectId}:${issueNumber}` → chatId for "Resume session" detection
  const resumeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const chat of linkedChatsData ?? []) {
      const parsed = chat.name ? parseMyWorkChatName(chat.name) : null;
      if (!parsed || !chat.projectId) continue;
      const key = `${chat.projectId}:${parsed.issueNumber}`;
      const expectedTitle = issueTitleByKey.get(key);
      if (expectedTitle !== parsed.title) continue;
      if (!map.has(key)) map.set(key, chat.id);
    }
    return map;
  }, [issueTitleByKey, linkedChatsData]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const items = (data?.items ?? [])
      .filter((item) => item.provider === 'github')
      .filter((item) => {
        const hasLocalProject = projectIdForItem(item) !== null;
        if (visibilityFilter === 'opened-locally' && !hasLocalProject) return false;
        if (visibilityFilter === 'needs-clone' && hasLocalProject) return false;
        if (!normalizedQuery) return true;
        const haystack = [item.title, item.repoOwner, item.repoName].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => {
        switch (sortMode) {
          case 'recently-created':
            return Date.parse(b.createdAt) - Date.parse(a.createdAt);
          case 'repo-name': {
            const repoCompare = `${a.repoOwner}/${a.repoName}`.localeCompare(`${b.repoOwner}/${b.repoName}`);
            return repoCompare !== 0 ? repoCompare : a.number - b.number;
          }
          default:
            return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        }
      });

    return items;
  }, [data?.items, projectIdForItem, searchQuery, sortMode, visibilityFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    for (const item of visibleItems) {
      const key = `${item.repoOwner}/${item.repoName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([repo, repoItems]) => ({ repo, items: repoItems }));
  }, [visibleItems]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      setActiveIndex(null);
      return;
    }
    setActiveIndex((current) => {
      if (current === null) return null;
      return Math.min(current, visibleItems.length - 1);
    });
  }, [visibleItems]);

  const handleStartSession = useCallback((item: WorkItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloneAndStart = useCallback((item: WorkItem) => {
    setCloneItem(item);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const handleCloseCloneDialog = useCallback(() => {
    setCloneItem(null);
  }, []);

  const handleResumeSession = useCallback(
    (chatId: string) => {
      setDesktopView(null);
      setShowNewChatForm(false);
      setSelectedDraftId(null);
      selectWorkspace(chatId);
    },
    [setDesktopView, setShowNewChatForm, setSelectedDraftId]
  );

  const selectedProjectId = selectedItem ? projectIdForItem(selectedItem) : null;

  const handleActivateItem = useCallback(
    (item: WorkItem) => {
      const projectId = projectIdForItem(item);
      const resumeChatId = projectId ? (resumeMap.get(`${projectId}:${item.number}`) ?? null) : null;
      if (resumeChatId) {
        handleResumeSession(resumeChatId);
        return;
      }
      if (projectId) {
        handleStartSession(item);
        return;
      }
      handleCloneAndStart(item);
    },
    [handleCloneAndStart, handleResumeSession, handleStartSession, projectIdForItem, resumeMap]
  );

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (visibleItems.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (current === null ? 0 : Math.min(current + 1, visibleItems.length - 1)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (current === null ? visibleItems.length - 1 : Math.max(current - 1, 0)));
        return;
      }
      if (event.key === 'Enter' && activeIndex !== null) {
        event.preventDefault();
        handleActivateItem(visibleItems[activeIndex]);
      }
    },
    [activeIndex, handleActivateItem, visibleItems]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-border/50 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <AgentsHeaderControls isSidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(true)} />
        <div
          className="flex items-center gap-2 flex-1 min-w-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ListTodo className="h-4 w-4 text-muted-foreground shrink-0" />
          <h1 className="text-sm font-semibold truncate">My Work</h1>
          <span className="text-xs text-muted-foreground ml-1">
            {data?.items.length ? `${data.items.length} open` : ''}
          </span>
        </div>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh work items"
            className="h-7 w-7"
            disabled={isFetching || refresh.isPending}
            onClick={() => refresh.mutate()}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching || refresh.isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Loading work items…</div>
        )}

        {!isLoading && (error || data?.error) && (
          <ErrorState error={data?.error ?? { code: 'unknown', message: String(error) }} />
        )}

        {!isLoading && !error && !data?.error && (
          <div className="px-4 py-3 border-b border-border/40">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
              <div className="space-y-1.5">
                <Label htmlFor="my-work-search">Search issues</Label>
                <Input
                  id="my-work-search"
                  type="search"
                  aria-label="Search issues"
                  placeholder="Search by title or repo"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="my-work-filter">Visibility</Label>
                <Select
                  value={visibilityFilter}
                  onValueChange={(value) => setVisibilityFilter(value as VisibilityFilter)}>
                  <SelectTrigger id="my-work-filter" aria-label="Visibility filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All issues</SelectItem>
                    <SelectItem value="opened-locally">Opened locally</SelectItem>
                    <SelectItem value="needs-clone">Needs clone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="my-work-sort">Sort</Label>
                <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                  <SelectTrigger id="my-work-sort" aria-label="Sort issues">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recently-updated">Recently updated</SelectItem>
                    <SelectItem value="recently-created">Recently created</SelectItem>
                    <SelectItem value="repo-name">Repo name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !error && !data?.error && grouped.length === 0 && (
          <EmptyState hasFilters={searchQuery.trim().length > 0 || visibilityFilter !== 'all'} />
        )}

        {!isLoading && !error && !data?.error && grouped.length > 0 && (
          <>
            <div
              role="list"
              aria-label="Work items"
              tabIndex={0}
              onKeyDown={handleListKeyDown}
              className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              {grouped.map(({ repo, items }) => (
                <div key={repo} className="mb-2">
                  <div className="px-4 py-2 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                    <span className="text-xs font-medium text-muted-foreground">{repo}</span>
                  </div>
                  {items.map((item) => {
                    const itemIndex = visibleItems.findIndex((candidate) => candidate.id === item.id);
                    const projectId = projectIdForItem(item);
                    const resumeChatId = projectId ? (resumeMap.get(`${projectId}:${item.number}`) ?? null) : null;
                    return (
                      <WorkItemRow
                        key={item.id}
                        item={item}
                        isActive={itemIndex === activeIndex}
                        hasLocalProject={projectId !== null}
                        resumeChatId={resumeChatId}
                        onStartSession={handleStartSession}
                        onCloneAndStart={handleCloneAndStart}
                        onResumeSession={handleResumeSession}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {hasNextPage && (
              <div className="flex justify-center py-4">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Load more issues"
                  disabled={loadMore.isPending}
                  onClick={() => {
                    if (endCursor) loadMore.mutate({ cursor: endCursor });
                  }}>
                  {loadMore.isPending ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <StartSessionDialog item={selectedItem} projectId={selectedProjectId} onClose={handleCloseDialog} />
      <CloneAndStartDialog item={cloneItem} onClose={handleCloseCloneDialog} />
    </div>
  );
}

function ErrorState({ error }: { error: { code: string; message: string; hint?: string; provider?: 'github' } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-48 px-6 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{friendlyTitle(error.code)}</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
        {error.hint && (
          <p className="text-xs text-muted-foreground mt-2 font-mono bg-muted/50 rounded px-2 py-1">{error.hint}</p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 h-48 px-6 text-center">
      <ListTodo className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">
        {hasFilters ? 'No GitHub issues match the current filters.' : 'No open GitHub issues assigned to you.'}
      </p>
    </div>
  );
}

function friendlyTitle(code: string): string {
  switch (code) {
    case 'cli-missing':
      return 'GitHub CLI not installed';
    case 'not-authenticated':
      return 'Not signed in to GitHub';
    case 'permission-denied':
      return 'Insufficient permissions';
    case 'network-error':
      return 'Network error';
    default:
      return 'Could not load work items';
  }
}
