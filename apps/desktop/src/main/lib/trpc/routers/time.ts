import { z } from 'zod';
import { and, gt, gte, isNull, lt, lte, or } from 'drizzle-orm';
import { publicProcedure, router } from '../index';
import { getDatabase } from '../../db';
import { workIntervals, tokenDaily, projects as projectsTbl } from '../../db/schema';
import { periodRange, type TimePeriod } from '../../time/time-periods';
import { splitByDay } from '../../time/sessionize';
import { runRollups } from '../../time/rollup';
import { derivedBasePathFor } from '../../time/project-resolver';

// Sessions whose cwd matched no known project land here (see project-resolver).
const OTHER_PROJECT = 'Other';

const periodSchema = z.enum(['today', 'week', '7d', '30d', 'thisMonth', 'lastMonth', 'all']);
const groupSpendSchema = z.enum(['harness', 'provider']);

const MICRO = 1_000_000;

// Short-lived cache so toggling period/axis in the UI doesn't re-scan each time.
type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10_000;

type ModelRow = {
  source: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  unpriced: boolean;
};

type SessionAgg = {
  subChatId: string;
  subChatName: string | null;
  harness: string | null;
  chatId: string | null;
  chatName: string | null;
  projectId: string | null;
  projectName: string | null;
  runtimeMs: number;
  /** Earliest activity ms across this session's intervals (for a "created" hint). */
  startedAt: number | null;
  models: Map<string, ModelRow>;
};

function sessionTokens(s: SessionAgg) {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let costUsd = 0;
  let unpriced = false;
  for (const m of s.models.values()) {
    input += m.inputTokens;
    output += m.outputTokens;
    cacheRead += m.cacheReadTokens;
    cacheWrite += m.cacheWriteTokens;
    costUsd += m.costUsd;
    unpriced = unpriced || m.unpriced;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    costUsd,
    unpriced
  };
}

function computeOverview(period: TimePeriod, groupSpendBy: 'harness' | 'provider', now: number) {
  const db = getDatabase();
  const range = periodRange(period, now);

  // projectId → canonical base path (for the "open project folder" link).
  const projectPaths = new Map<string, string>();
  for (const p of db.select({ id: projectsTbl.id, path: projectsTbl.path }).from(projectsTbl).all()) {
    if (p.path) projectPaths.set(p.id, p.path);
  }

  const sessions = new Map<string, SessionAgg>();
  const ensure = (id: string): SessionAgg => {
    let s = sessions.get(id);
    if (!s) {
      s = {
        subChatId: id,
        subChatName: null,
        harness: null,
        chatId: null,
        chatName: null,
        projectId: null,
        projectName: null,
        runtimeMs: 0,
        startedAt: null,
        models: new Map()
      };
      sessions.set(id, s);
    }
    return s;
  };

  const daily = new Map<string, { runtimeMs: number; costUsd: number }>();
  const bumpDaily = (key: string, field: 'runtimeMs' | 'costUsd', v: number) => {
    const d = daily.get(key) ?? { runtimeMs: 0, costUsd: 0 };
    d[field] += v;
    daily.set(key, d);
  };

  // --- Runtime (work_intervals, clipped to the window) ---
  // Open intervals (endedAt IS NULL) are live, in-progress turns; treat their
  // end as "now" so an actively-streaming turn shows its accrued runtime instead
  // of zero until it closes. `now` is the request time (also the window's end
  // for current periods), so this never counts past the window.
  const intervals = db
    .select()
    .from(workIntervals)
    .where(
      and(
        lt(workIntervals.startedAt, range.endMs),
        or(isNull(workIntervals.endedAt), gt(workIntervals.endedAt, range.startMs))
      )
    )
    .all();

  for (const iv of intervals) {
    const rawEnd = iv.endedAt ?? now;
    const start = Math.max(iv.startedAt, range.startMs);
    const end = Math.min(rawEnd, range.endMs);
    if (end <= start) continue;
    const s = ensure(iv.subChatId);
    s.startedAt = s.startedAt == null ? iv.startedAt : Math.min(s.startedAt, iv.startedAt);
    s.subChatName ??= iv.subChatName;
    s.harness ??= iv.harness;
    s.chatId ??= iv.chatId;
    s.chatName ??= iv.chatName;
    s.projectId ??= iv.projectId;
    s.projectName ??= iv.projectName;
    for (const slice of splitByDay(start, end)) {
      s.runtimeMs += slice.ms;
      bumpDaily(slice.dateKey, 'runtimeMs', slice.ms);
    }
  }

  // --- Tokens + cost (token_daily, by date key) ---
  const tokenRows = db
    .select()
    .from(tokenDaily)
    .where(and(gte(tokenDaily.dateKey, range.startKey), lte(tokenDaily.dateKey, range.endKey)))
    .all();

  const spend = new Map<string, { label: string; costUsd: number; totalTokens: number }>();
  let otherCostUsd = 0;
  let anyUnpriced = false;

  for (const row of tokenRows) {
    const s = ensure(row.subChatId);
    s.subChatName ??= row.subChatName;
    s.harness ??= row.harness;
    s.chatId ??= row.chatId;
    s.chatName ??= row.chatName;
    s.projectId ??= row.projectId;
    s.projectName ??= row.projectName;

    const costUsd = row.costMicroUsd / MICRO;
    const tokens = row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens;
    const mKey = `${row.source}|${row.model}`;
    const m = s.models.get(mKey) ?? {
      source: row.source,
      model: row.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unpriced: false
    };
    m.inputTokens += row.inputTokens;
    m.outputTokens += row.outputTokens;
    m.cacheReadTokens += row.cacheReadTokens;
    m.cacheWriteTokens += row.cacheWriteTokens;
    m.totalTokens += tokens;
    m.costUsd += costUsd;
    m.unpriced = m.unpriced || row.unpriced;
    s.models.set(mKey, m);

    if (row.unpriced) anyUnpriced = true;
    if (row.projectId === null && (row.projectName ?? OTHER_PROJECT) === OTHER_PROJECT) otherCostUsd += costUsd;

    bumpDaily(row.dateKey, 'costUsd', costUsd);

    // Spend breakdown axis. Key and label derive from the SAME value so a
    // bucket's key can never diverge from its displayed label.
    const axisKey = groupSpendBy === 'provider' ? row.source : (row.harness ?? 'unknown');
    const bucket = spend.get(axisKey) ?? { label: axisKey, costUsd: 0, totalTokens: 0 };
    bucket.costUsd += costUsd;
    bucket.totalTokens += tokens;
    spend.set(axisKey, bucket);
  }

  // --- Assemble project → workspace → session tree ---
  type SessionNode = ReturnType<typeof sessionTokens> & {
    subChatId: string;
    subChatName: string | null;
    harness: string | null;
    runtimeMs: number;
    startedAt: number | null;
    models: ModelRow[];
  };
  type WorkspaceNode = {
    chatId: string | null;
    chatName: string | null;
    runtimeMs: number;
    totalTokens: number;
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

  const projects = new Map<string, ProjectNode>();
  let totalRuntimeMs = 0;
  let totalCostUsd = 0;
  let totalTokens = 0;

  for (const s of sessions.values()) {
    const tok = sessionTokens(s);
    const sessionNode: SessionNode = {
      ...tok,
      subChatId: s.subChatId,
      subChatName: s.subChatName,
      harness: s.harness,
      runtimeMs: s.runtimeMs,
      startedAt: s.startedAt,
      models: [...s.models.values()].sort((a, b) => b.costUsd - a.costUsd)
    };
    totalRuntimeMs += s.runtimeMs;
    totalCostUsd += tok.costUsd;
    totalTokens += tok.totalTokens;

    // Group by project id; sessions with no known project merge by their derived
    // project name (so e.g. every "AuditPro" terminal session lands on one line).
    // The derived key is case-folded so case-variant spellings of the same name
    // don't fragment into separate rows.
    const projName = s.projectName ?? OTHER_PROJECT;
    const projKey = s.projectId ?? `name:${projName.toLowerCase()}`;
    const proj =
      projects.get(projKey) ??
      ({
        projectId: s.projectId,
        projectName: projName,
        projectPath: s.projectId ? (projectPaths.get(s.projectId) ?? null) : derivedBasePathFor(projName),
        runtimeMs: 0,
        totalTokens: 0,
        costUsd: 0,
        workspaces: []
      } as ProjectNode);
    proj.runtimeMs += s.runtimeMs;
    proj.totalTokens += tok.totalTokens;
    proj.costUsd += tok.costUsd;

    const chatKey = s.chatId ?? '__none__';
    let ws = proj.workspaces.find((w) => (w.chatId ?? '__none__') === chatKey);
    if (!ws) {
      ws = {
        chatId: s.chatId,
        chatName: s.chatName,
        runtimeMs: 0,
        totalTokens: 0,
        costUsd: 0,
        sessions: []
      };
      proj.workspaces.push(ws);
    }
    ws.runtimeMs += s.runtimeMs;
    ws.totalTokens += tok.totalTokens;
    ws.costUsd += tok.costUsd;
    ws.sessions.push(sessionNode);

    projects.set(projKey, proj);
  }

  const projectList = [...projects.values()].sort((a, b) => b.costUsd - a.costUsd || b.runtimeMs - a.runtimeMs);
  for (const p of projectList) {
    p.workspaces.sort((a, b) => b.costUsd - a.costUsd || b.runtimeMs - a.runtimeMs);
    for (const w of p.workspaces) w.sessions.sort((a, b) => b.costUsd - a.costUsd || b.runtimeMs - a.runtimeMs);
  }

  const dailySeries = [...daily.entries()]
    .map(([date, v]) => ({ date, runtimeMs: v.runtimeMs, costUsd: v.costUsd }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    period,
    groupSpendBy,
    rangeStart: range.startKey,
    rangeEnd: range.endKey,
    totals: {
      runtimeMs: totalRuntimeMs,
      totalTokens,
      costUsd: totalCostUsd,
      otherCostUsd,
      anyUnpriced
    },
    spendBreakdown: [...spend.values()].sort((a, b) => b.costUsd - a.costUsd),
    daily: dailySeries,
    projects: projectList
  };
}

export const timeRouter = router({
  getOverview: publicProcedure
    .input(z.object({ period: periodSchema, groupSpendBy: groupSpendSchema.default('harness') }))
    .query(({ input }) => {
      const key = `${input.period}|${input.groupSpendBy}`;
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) return cached.value as ReturnType<typeof computeOverview>;
      const value = computeOverview(input.period, input.groupSpendBy, now);
      cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
      return value;
    }),

  /** Re-run the rollups and bust the cache (used by the page's refresh button). */
  refresh: publicProcedure.mutation(async () => {
    await runRollups(true);
    cache.clear();
    return { ok: true };
  })
});
