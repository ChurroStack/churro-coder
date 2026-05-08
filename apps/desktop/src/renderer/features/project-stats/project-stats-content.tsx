import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { AlignJustify, RefreshCw } from 'lucide-react';
import {
  desktopViewAtom,
  projectStatsTargetIdAtom,
  projectStatsPeriodAtom,
  agentsSidebarOpenAtom,
  selectedProjectAtom,
  type ProjectStatsPeriod
} from '../../lib/atoms';
import { trpc } from '../../lib/trpc';
import { StatCard } from './components/stat-card';
import { CommitHeatmap } from './components/commit-heatmap';
import { DailyCommitsChart } from './components/daily-commits-chart';
import { ContributorsTable } from './components/contributors-table';
import { RecentCommitsList } from './components/recent-commits-list';
import { SegmentedToggle } from '../usage/components/segmented-toggle';
import { AgentsHeaderControls } from '../agents/ui/agents-header-controls';
import { Button } from '../../components/ui/button';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { formatRelativeDate } from './lib/format';

const PERIOD_OPTIONS: { value: ProjectStatsPeriod; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All' }
];

export function ProjectStatsContent() {
  const projectId = useAtomValue(projectStatsTargetIdAtom);
  const selectedProject = useAtomValue(selectedProjectAtom);
  const [period, setPeriod] = useAtom(projectStatsPeriodAtom);
  const setDesktopView = useSetAtom(desktopViewAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDesktopView(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setDesktopView]);

  const { data, isLoading, isError, error, refetch, isFetching } = trpc.projectStats.getStats.useQuery(
    { projectId: projectId ?? '', period },
    { enabled: !!projectId, staleTime: 15_000, refetchOnWindowFocus: false }
  );

  const refreshMutation = trpc.projectStats.refresh.useMutation({
    onSuccess: () => refetch()
  });

  const projectName = selectedProject?.name ?? selectedProject?.path?.split('/').pop() ?? 'Project';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center p-1.5" style={{ WebkitAppRegion: 'drag' }}>
        {isMobile ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDesktopView(null)}
            className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] text-foreground flex-shrink-0 rounded-md"
            aria-label="Back"
            style={{ WebkitAppRegion: 'no-drag' }}>
            <AlignJustify className="h-4 w-4" />
          </Button>
        ) : (
          <AgentsHeaderControls isSidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">{projectName}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Statistics from local git history.</p>
            </div>
            <div className="flex items-center gap-2">
              <SegmentedToggle value={period} onChange={setPeriod} options={PERIOD_OPTIONS} size="sm" />
              <button
                type="button"
                onClick={() => projectId && refreshMutation.mutate({ projectId })}
                disabled={refreshMutation.isPending || isFetching || !projectId}
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive-foreground px-4 py-3 text-sm">
              Failed to load statistics: {error?.message ?? 'unknown error'}
            </div>
          ) : null}

          {data && !data.ok ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive-foreground px-4 py-3 text-sm">
              {data.error}
            </div>
          ) : null}

          {data?.ok && data.data.warnings.length > 0 ? (
            <div className="rounded-md border border-yellow-400/40 bg-yellow-400/5 text-yellow-700 dark:text-yellow-300 px-4 py-3 text-sm">
              {data.data.warnings.join(' ')}
            </div>
          ) : null}

          {isLoading || !data ? (
            <LoadingSkeleton />
          ) : data.ok ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Commits" value={data.data.totals.commitsInPeriod} />
                <StatCard label="Contributors" value={data.data.totals.contributorsInPeriod} />
                <StatCard label="Local branches" value={data.data.totals.branches} />
                <StatCard label="Tags" value={data.data.totals.tags} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  label="Additions"
                  value={data.data.totals.additions}
                  className="[&_.tabular-nums]:text-green-600 dark:[&_.tabular-nums]:text-green-400"
                />
                <StatCard
                  label="Deletions"
                  value={data.data.totals.deletions}
                  className="[&_.tabular-nums]:text-red-500 dark:[&_.tabular-nums]:text-red-400"
                />
                <StatCard
                  label="First commit"
                  value={0}
                  valueOverride={
                    data.data.totals.firstCommitISO ? formatRelativeDate(data.data.totals.firstCommitISO) : '—'
                  }
                  className="[&_.tabular-nums]:text-sm [&_.tabular-nums]:font-medium"
                />
                <StatCard
                  label="Last commit"
                  value={0}
                  valueOverride={
                    data.data.totals.lastCommitISO ? formatRelativeDate(data.data.totals.lastCommitISO) : '—'
                  }
                  className="[&_.tabular-nums]:text-sm [&_.tabular-nums]:font-medium"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-background p-4">
                  <CommitHeatmap cells={data.data.heatmap} />
                </div>
                <div className="rounded-lg border border-border bg-background p-4">
                  <DailyCommitsChart daily={data.data.daily} />
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-4">
                <div className="text-sm font-medium mb-3">Top contributors</div>
                <ContributorsTable contributors={data.data.contributors} />
              </div>

              <div className="rounded-lg border border-border bg-background p-4">
                <div className="text-sm font-medium mb-3">Recent commits</div>
                <RecentCommitsList commits={data.data.recent} />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-muted/20" />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-muted/20" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="h-48 rounded-lg border border-border bg-muted/20" />
        <div className="h-48 rounded-lg border border-border bg-muted/20" />
      </div>
      <div className="h-40 rounded-lg border border-border bg-muted/20" />
      <div className="h-32 rounded-lg border border-border bg-muted/20" />
    </div>
  );
}
