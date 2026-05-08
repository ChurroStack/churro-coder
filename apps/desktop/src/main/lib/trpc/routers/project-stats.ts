import { z } from 'zod';
import { publicProcedure, router } from '../index';
import { getDatabase, projects } from '../../db';
import { eq } from 'drizzle-orm';
import { createGit } from '../../git/git-factory';
import {
  aggregateProjectStats,
  type ProjectStats,
  type ProjectStatsPeriod,
  type RawInputs
} from '../../project-stats/aggregate';

const periodSchema = z.enum(['7d', '30d', '90d', '1y', 'all']);

type CacheEntry = { value: ProjectStats; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

function periodToSince(period: ProjectStatsPeriod): string | null {
  const map: Record<ProjectStatsPeriod, string | null> = {
    '7d': '7.days.ago',
    '30d': '30.days.ago',
    '90d': '90.days.ago',
    '1y': '365.days.ago',
    all: null
  };
  return map[period];
}

function invalidateForProject(projectId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${projectId}:`)) cache.delete(key);
  }
}

function humanizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const projectStatsRouter = router({
  getStats: publicProcedure
    .input(z.object({ projectId: z.string(), period: periodSchema }))
    .query(async ({ input }): Promise<{ ok: true; data: ProjectStats } | { ok: false; error: string }> => {
      const { projectId, period } = input;
      const cacheKey = `${projectId}:${period}`;
      const now = Date.now();

      const cached = cache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        return { ok: true, data: cached.value };
      }

      const start = Date.now();
      try {
        const db = getDatabase();
        const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
        if (!project) {
          return { ok: false, error: 'Project not found' };
        }

        const git = createGit(project.path, 10_000);

        try {
          await git.revparse(['--is-inside-work-tree']);
        } catch {
          return { ok: false, error: 'Not a git repository' };
        }

        const warnings: string[] = [];
        try {
          const shallow = await git.revparse(['--is-shallow-repository']);
          if (shallow.trim() === 'true') {
            warnings.push('Repository is shallow — commit counts may be partial');
          }
        } catch {
          // older git versions don't support --is-shallow-repository; ignore
        }

        const since = periodToSince(period);
        const logArgs = [
          'log',
          '--numstat',
          '--no-merges',
          '--pretty=format:C\t%H\t%an\t%ae\t%cI\t%s',
          '--max-count=10000'
        ];
        if (since) logArgs.push(`--since=${since}`);

        const [
          logOutput,
          heatmapLogOutput,
          allTimeCountRaw,
          branchListRaw,
          tagListRaw,
          firstCommitRaw,
          lastCommitRaw,
          recentLogRaw
        ] = await Promise.all([
          git.raw(logArgs),
          git.raw(['log', '--since=365.days.ago', '--no-merges', '--pretty=format:%cI']),
          git.raw(['rev-list', '--count', 'HEAD']).catch(() => '0'),
          git.raw(['branch', '--list']).catch(() => ''),
          git.raw(['tag', '--list']).catch(() => ''),
          // rev-list --max-parents=0 gives the root commit hash(es); log -1
          // on that hash gives its committer date. Two chained calls are
          // needed because `git log --reverse --max-count=1` applies the
          // limit before reversing (returns the newest, not oldest, commit).
          git
            .raw(['rev-list', '--max-parents=0', 'HEAD'])
            .then((out) => {
              const hash = out.trim().split('\n')[0]?.trim();
              return hash ? git.raw(['log', '-1', '--pretty=format:%cI', hash]).catch(() => '') : '';
            })
            .catch(() => ''),
          // All-time most-recent non-merge commit. The period numstat log can be
          // empty for a short window (e.g. 7d with no recent activity); this
          // ensures "Last commit" still shows a real date.
          git.raw(['log', '-1', '--no-merges', '--pretty=format:%cI']).catch(() => ''),
          git.raw(['log', '--max-count=20', '--pretty=format:%H\t%an\t%cI\t%s']).catch(() => '')
        ]);

        const allTimeCount = parseInt(allTimeCountRaw.trim(), 10) || 0;
        const branches = branchListRaw.split('\n').filter((l) => l.trim()).length;
        const tags = tagListRaw.split('\n').filter((l) => l.trim()).length;

        const raw: RawInputs = {
          logOutput,
          heatmapLogOutput,
          allTimeCount,
          branches,
          tags,
          firstCommitISO: firstCommitRaw.trim(),
          lastCommitISO: lastCommitRaw.trim(),
          recentLogOutput: recentLogRaw,
          warnings
        };

        const data = aggregateProjectStats(raw, period);
        const durationMs = Date.now() - start;
        console.log(
          `[project-stats] projectId=${projectId} period=${period} durationMs=${durationMs} commitsInPeriod=${data.totals.commitsInPeriod} ok=true`
        );

        cache.set(cacheKey, { value: data, expiresAt: now + CACHE_TTL_MS });
        return { ok: true, data };
      } catch (err) {
        const durationMs = Date.now() - start;
        console.error(
          `[project-stats] projectId=${projectId} period=${period} durationMs=${durationMs} error=${humanizeError(err)}`
        );
        return { ok: false, error: humanizeError(err) };
      }
    }),

  refresh: publicProcedure.input(z.object({ projectId: z.string() })).mutation(({ input }) => {
    invalidateForProject(input.projectId);
    return { ok: true };
  })
});
