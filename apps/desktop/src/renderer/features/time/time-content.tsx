import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import {
  desktopViewAtom,
  timePeriodAtom,
  timeSpendAxisAtom,
  agentsSidebarOpenAtom,
  type TimePeriod,
  type TimeSpendAxis
} from '../agents/atoms';
import { trpc } from '../../lib/trpc';
import { StatCard } from '../usage/components/stat-card';
import { SegmentedToggle } from '../usage/components/segmented-toggle';
import { UsageTimeTabs } from '../usage/components/usage-time-tabs';
import { formatCompact, formatUSD } from '../usage/lib/format';
import { formatDuration, formatTimestamp } from './lib/format';
import { RefreshCw, AlignJustify, ChevronRight, ExternalLink } from 'lucide-react';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { AgentsHeaderControls } from '../agents/ui/agents-header-controls';
import { Button } from '../../components/ui/button';

const PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'all', label: 'All' }
];

const AXIS_OPTIONS: { value: TimeSpendAxis; label: string }[] = [
  { value: 'harness', label: 'By harness' },
  { value: 'provider', label: 'By provider' }
];

function labelFor(key: string): string {
  switch (key) {
    case 'builtin':
      return 'Built-in';
    case 'claude-cli':
      return 'Claude CLI';
    case 'codex-cli':
      return 'Codex CLI';
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    default:
      return 'Unknown';
  }
}

export function TimeContent() {
  const [period, setPeriod] = useAtom(timePeriodAtom);
  const [spendAxis, setSpendAxis] = useAtom(timeSpendAxisAtom);
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

  const { data, isLoading, isError, error, refetch, isFetching } = trpc.time.getOverview.useQuery(
    { period, groupSpendBy: spendAxis },
    { staleTime: 10_000, refetchOnWindowFocus: false }
  );

  const refreshMutation = trpc.time.refresh.useMutation({
    onSuccess: () => {
      refetch();
    }
  });

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
          <UsageTimeTabs />

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">Time</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Billable agent runtime and spend, per project, workspace, and session. Records survive archiving and
                deletion.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <SegmentedToggle value={spendAxis} onChange={setSpendAxis} options={AXIS_OPTIONS} size="sm" />
              <SegmentedToggle value={period} onChange={setPeriod} options={PERIOD_OPTIONS} size="sm" />
              <button
                type="button"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending || isFetching}
                aria-label="Refresh"
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive-foreground px-4 py-3 text-sm">
              Failed to load time data: {error?.message ?? 'unknown error'}
            </div>
          ) : null}

          {isLoading || !data ? (
            <LoadingSkeleton />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard label="Runtime" value={0} valueOverride={formatDuration(data.totals.runtimeMs)} />
                <StatCard
                  label="Total Cost"
                  value={data.totals.costUsd}
                  valueOverride={formatUSD(data.totals.costUsd)}
                />
                <StatCard
                  label="Total Tokens"
                  value={data.totals.totalTokens}
                  valueOverride={formatCompact(data.totals.totalTokens)}
                />
              </div>

              <ProjectRuntimeChart projects={data.projects} />

              <div className="rounded-lg border border-border bg-background p-4">
                <div className="text-sm font-medium mb-3">
                  Spend {spendAxis === 'harness' ? 'by harness' : 'by provider'}
                </div>
                {data.spendBreakdown.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No spend in this period.</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {data.spendBreakdown.map((b) => (
                      <div key={b.label} className="flex items-center justify-between text-sm">
                        <span>{labelFor(b.label)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatCompact(b.totalTokens)} tok · {formatUSD(b.costUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="text-sm font-medium">Projects</div>
                {data.projects.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No tracked time in this period yet.</div>
                ) : (
                  [...data.projects]
                    .sort((a, b) =>
                      (a.projectName ?? '').localeCompare(b.projectName ?? '', undefined, { sensitivity: 'base' })
                    )
                    .map((p, pi) => <ProjectSection key={p.projectId ?? `__p${pi}`} project={p} />)
                )}
              </div>

              {data.totals.otherCostUsd > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {formatUSD(data.totals.otherCostUsd)} of spend ran in a directory that maps to no known project —
                  grouped under “Other”.
                </div>
              ) : null}
              {data.totals.anyUnpriced ? (
                <div className="text-xs text-muted-foreground">
                  Some models are missing from the pricing table — their tokens are counted but cost is shown as $0.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type ModelRow = {
  source: string;
  model: string;
  totalTokens: number;
  costUsd: number;
  unpriced: boolean;
};
type SessionNode = {
  subChatId: string;
  subChatName: string | null;
  harness: string | null;
  runtimeMs: number;
  startedAt: number | null;
  costUsd: number;
  models: ModelRow[];
};
type WorkspaceNode = {
  chatId: string | null;
  chatName: string | null;
  runtimeMs: number;
  costUsd: number;
  sessions: SessionNode[];
};
type ProjectNode = {
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
  runtimeMs: number;
  totalTokens: number;
  costUsd: number;
  workspaces: WorkspaceNode[];
};

function ProjectRuntimeChart({ projects }: { projects: ProjectNode[] }) {
  const ranked = projects.filter((p) => p.runtimeMs > 0).sort((a, b) => b.runtimeMs - a.runtimeMs);
  if (ranked.length === 0) return null;
  const max = ranked[0].runtimeMs;
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-sm font-medium mb-3">Runtime by project</div>
      <div className="flex flex-col gap-1.5">
        {ranked.map((p, i) => (
          <div key={p.projectId ?? `__c${i}`} className="flex items-center gap-2 text-xs">
            <div
              className="w-32 flex-shrink-0 truncate text-muted-foreground"
              title={p.projectName ?? 'Unknown project'}>
              {p.projectName ?? 'Unknown project'}
            </div>
            <div className="flex-1 h-4 rounded bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded bg-primary/70"
                style={{ width: `${Math.max(2, (p.runtimeMs / max) * 100)}%` }}
              />
            </div>
            <div className="flex-shrink-0 text-right tabular-nums text-muted-foreground whitespace-nowrap">
              {formatDuration(p.runtimeMs)} · {formatCompact(p.totalTokens)} tok · {formatUSD(p.costUsd)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectSection({ project }: { project: ProjectNode }) {
  const [open, setOpen] = useState(false);
  const openInFinder = trpc.external.openInFinder.useMutation();
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${open ? 'border-b border-border' : ''}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <ChevronRight
            className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="font-medium text-sm truncate">{project.projectName ?? 'Unknown project'}</span>
          {project.projectPath ? (
            <span className="hidden md:inline text-sm text-muted-foreground/50 truncate" title={project.projectPath}>
              {project.projectPath}
            </span>
          ) : null}
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(project.runtimeMs)} · {formatCompact(project.totalTokens)} tok ·{' '}
            {formatUSD(project.costUsd)}
          </div>
          {project.projectPath ? (
            <button
              type="button"
              onClick={() => openInFinder.mutate(project.projectPath!)}
              aria-label="Open project folder"
              title={`Open ${project.projectPath}`}
              className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className={`divide-y divide-border ${open ? '' : 'hidden'}`}>
        {project.workspaces.map((w, wi) => (
          <div key={w.chatId ?? `__w${wi}`} className="px-4 py-2">
            <div className="flex items-center justify-between">
              <div className="text-sm">{w.chatName ?? 'Untitled workspace'}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatDuration(w.runtimeMs)} · {formatUSD(w.costUsd)}
              </div>
            </div>
            <div className="mt-1 flex flex-col gap-1.5 pl-3">
              {w.sessions.map((s, si) => (
                <div key={s.subChatId ?? `__s${si}`} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate">
                      {s.subChatName ?? 'Untitled session'}
                      {s.harness ? ` · ${labelFor(s.harness)}` : ''}
                      {s.startedAt ? ` · ${formatTimestamp(s.startedAt)}` : ''}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatDuration(s.runtimeMs)} · {formatUSD(s.costUsd)}
                    </span>
                  </div>
                  {s.models.map((m) => (
                    <div
                      key={`${m.source}-${m.model}`}
                      className="flex items-center justify-between text-[11px] text-muted-foreground/80 pl-3">
                      <span>{m.model}</span>
                      <span className="tabular-nums">
                        {formatCompact(m.totalTokens)} tok · {formatUSD(m.costUsd)}
                        {m.unpriced ? ' *' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-muted/20" />
        ))}
      </div>
      <div className="h-32 rounded-lg border border-border bg-muted/20" />
      <div className="h-40 rounded-lg border border-border bg-muted/20" />
    </div>
  );
}
