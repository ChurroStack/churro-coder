export type ProjectStatsPeriod = '7d' | '30d' | '90d' | '1y' | 'all';

export type HeatmapCell = {
  date: string;
  dayOfWeek: number; // 0 = Mon, 6 = Sun  (matches activity-heatmap DAY_LABELS)
  weekIndex: number;
  commits: number;
};

export type DailyCommitBucket = {
  date: string; // YYYY-MM-DD
  commits: number;
};

export type ContributorRow = {
  name: string;
  email: string;
  commits: number;
  additions: number;
  deletions: number;
};

export type RecentCommit = {
  hash: string;
  author: string;
  dateISO: string;
  subject: string;
};

export type ProjectStats = {
  period: ProjectStatsPeriod;
  totals: {
    commitsInPeriod: number;
    commitsAllTime: number;
    contributorsInPeriod: number;
    branches: number;
    tags: number;
    additions: number;
    deletions: number;
    firstCommitISO: string | null;
    lastCommitISO: string | null;
  };
  heatmap: HeatmapCell[];
  daily: DailyCommitBucket[];
  contributors: ContributorRow[];
  recent: RecentCommit[];
  warnings: string[];
};

/** Hard cap on the period numstat log; in sync with the router's --max-count. */
export const COMMIT_LOG_CAP = 10_000;

export type RawInputs = {
  /** Output of `git log --numstat --no-merges --pretty=format:'C\t%H\t%an\t%ae\t%cI\t%s'` scoped to the selected period */
  logOutput: string;
  /** Output of `git log --since=365.days.ago --no-merges --pretty=format:%cI` for the always-1-year heatmap */
  heatmapLogOutput: string;
  allTimeCount: number;
  branches: number;
  tags: number;
  /** All-time first (root) commit ISO date — `git log -1` on the rev-list root commit. */
  firstCommitISO: string;
  /** All-time most-recent commit ISO date — `git log -1 --no-merges --pretty=format:%cI`. */
  lastCommitISO: string;
  /** Output of `git log --max-count=20 --pretty=format:%H\t%an\t%cI\t%s` (all-time) */
  recentLogOutput: string;
  warnings: string[];
};

type CommitEntry = {
  hash: string;
  author: string;
  email: string; // already lowercased
  dateISO: string;
  subject: string;
  additions: number;
  deletions: number;
};

/**
 * Parses a git log output that mixes a `C\t...` pretty header with numstat rows.
 *
 * Format per commit:
 *   C\t<hash>\t<author>\t<email>\t<isodate>\t<subject>
 *   <blank>
 *   <add>\t<del>\t<path>
 *   ...
 *   <blank>
 *
 * Binary files emit `-\t-\t<path>` — treated as 0/0.
 */
function parseNumstatLog(output: string): CommitEntry[] {
  const commits: CommitEntry[] = [];
  let current: CommitEntry | null = null;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('C\t')) {
      if (current) commits.push(current);
      const parts = line.split('\t');
      current = {
        hash: parts[1] ?? '',
        author: parts[2] ?? '',
        email: (parts[3] ?? '').toLowerCase(),
        dateISO: parts[4] ?? '',
        subject: parts.slice(5).join('\t'),
        additions: 0,
        deletions: 0
      };
    } else if (current && line.trim() !== '') {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const add = parseInt(parts[0]!, 10);
        const del = parseInt(parts[1]!, 10);
        if (!isNaN(add)) current.additions += add;
        if (!isNaN(del)) current.deletions += del;
      }
    }
  }
  if (current) commits.push(current);
  return commits;
}

/** Local-TZ YYYY-MM-DD; matches git's %cI date portion (committer's TZ). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildHeatmap(heatmapLogOutput: string, nowMs: number): HeatmapCell[] {
  const commitsByDate = new Map<string, number>();
  for (const rawLine of heatmapLogOutput.split('\n')) {
    const date = rawLine.trim().slice(0, 10);
    if (date.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      commitsByDate.set(date, (commitsByDate.get(date) ?? 0) + 1);
    }
  }

  // Build a 365-day grid, column-aligned to Monday so rows match DAY_LABELS.
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  const startRaw = new Date(today);
  startRaw.setDate(startRaw.getDate() - 364);
  const dowStart = (startRaw.getDay() + 6) % 7; // shift Sun=0→6, Mon=1→0
  const start = new Date(startRaw);
  start.setDate(start.getDate() - dowStart); // rewind to preceding Monday

  const cells: HeatmapCell[] = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const isoDate = localDateKey(cursor);
    const dayOfWeek = (cursor.getDay() + 6) % 7;
    const diffDays = Math.round((cursor.getTime() - start.getTime()) / 86400000);
    const weekIndex = Math.floor(diffDays / 7);
    cells.push({ date: isoDate, dayOfWeek, weekIndex, commits: commitsByDate.get(isoDate) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return cells;
}

function buildDailyBuckets(commits: CommitEntry[]): DailyCommitBucket[] {
  const byDate = new Map<string, number>();
  for (const c of commits) {
    const date = c.dateISO.slice(0, 10);
    if (date) byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, commits]) => ({ date, commits }));
}

function buildContributors(commits: CommitEntry[]): ContributorRow[] {
  // Keyed by lowercased email so the same person with multiple name spellings merges.
  // git log is newest-first, so the first encounter is the most recent name spelling — we keep it.
  const map = new Map<string, ContributorRow>();
  for (const c of commits) {
    const existing = map.get(c.email);
    if (existing) {
      existing.commits += 1;
      existing.additions += c.additions;
      existing.deletions += c.deletions;
    } else {
      map.set(c.email, { name: c.author, email: c.email, commits: 1, additions: c.additions, deletions: c.deletions });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 20);
}

function parseRecentLog(recentLogOutput: string): RecentCommit[] {
  const recent: RecentCommit[] = [];
  for (const rawLine of recentLogOutput.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    recent.push({
      hash: parts[0] ?? '',
      author: parts[1] ?? '',
      dateISO: parts[2] ?? '',
      subject: parts.slice(3).join('\t')
    });
  }
  return recent.slice(0, 20);
}

export function aggregateProjectStats(
  raw: RawInputs,
  period: ProjectStatsPeriod,
  nowMs: number = Date.now()
): ProjectStats {
  const commits = parseNumstatLog(raw.logOutput);

  const totalAdditions = commits.reduce((s, c) => s + c.additions, 0);
  const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);
  const uniqueEmails = new Set(commits.map((c) => c.email)).size;

  // If the period log hit the cap, totals (commits/additions/deletions/contributors) may be partial.
  const warnings =
    commits.length >= COMMIT_LOG_CAP
      ? [...raw.warnings, `Showing the most recent ${COMMIT_LOG_CAP.toLocaleString()} commits — totals may be partial.`]
      : raw.warnings;

  return {
    period,
    totals: {
      commitsInPeriod: commits.length,
      commitsAllTime: raw.allTimeCount,
      contributorsInPeriod: uniqueEmails,
      branches: raw.branches,
      tags: raw.tags,
      additions: totalAdditions,
      deletions: totalDeletions,
      firstCommitISO: raw.firstCommitISO || null,
      lastCommitISO: raw.lastCommitISO || null
    },
    heatmap: buildHeatmap(raw.heatmapLogOutput, nowMs),
    daily: buildDailyBuckets(commits),
    contributors: buildContributors(commits),
    recent: parseRecentLog(raw.recentLogOutput),
    warnings
  };
}
