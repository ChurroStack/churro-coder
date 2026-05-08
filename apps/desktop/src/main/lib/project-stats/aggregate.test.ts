import { describe, expect, it } from 'vitest';
import { aggregateProjectStats, COMMIT_LOG_CAP, type RawInputs } from './aggregate';

function makeRaw(overrides: Partial<RawInputs> = {}): RawInputs {
  return {
    logOutput: '',
    heatmapLogOutput: '',
    allTimeCount: 0,
    branches: 0,
    tags: 0,
    firstCommitISO: '',
    lastCommitISO: '',
    recentLogOutput: '',
    warnings: [],
    ...overrides
  };
}

describe('aggregateProjectStats', () => {
  it('returns zeroes for an empty repository', () => {
    const result = aggregateProjectStats(makeRaw(), '30d');
    expect(result.totals.commitsInPeriod).toBe(0);
    expect(result.totals.commitsAllTime).toBe(0);
    expect(result.totals.contributorsInPeriod).toBe(0);
    expect(result.totals.firstCommitISO).toBeNull();
    expect(result.totals.lastCommitISO).toBeNull();
    expect(result.contributors).toHaveLength(0);
    expect(result.recent).toHaveLength(0);
    expect(result.daily).toHaveLength(0);
  });

  it('parses a single commit with numstat lines', () => {
    const logOutput = [
      'C\tabc1234\tAlice\talice@example.com\t2026-04-01T10:00:00+00:00\tInitial commit',
      '',
      '10\t5\tsrc/index.ts',
      '3\t0\tREADME.md'
    ].join('\n');

    const result = aggregateProjectStats(
      makeRaw({ logOutput, allTimeCount: 1, lastCommitISO: '2026-04-01T10:00:00+00:00' }),
      'all'
    );
    expect(result.totals.commitsInPeriod).toBe(1);
    expect(result.totals.commitsAllTime).toBe(1);
    expect(result.totals.additions).toBe(13);
    expect(result.totals.deletions).toBe(5);
    expect(result.totals.contributorsInPeriod).toBe(1);
    expect(result.totals.lastCommitISO).toBe('2026-04-01T10:00:00+00:00');
    expect(result.contributors[0]).toMatchObject({
      name: 'Alice',
      email: 'alice@example.com',
      commits: 1,
      additions: 13,
      deletions: 5
    });
  });

  it('merges contributors by lowercased email', () => {
    const logOutput = [
      'C\taaa1111\tAlice\tAlice@EXAMPLE.COM\t2026-04-01T10:00:00+00:00\tCommit 1',
      '',
      '5\t2\tfoo.ts',
      '',
      'C\tbbb2222\tAlice Smith\talice@example.com\t2026-04-02T10:00:00+00:00\tCommit 2',
      '',
      '3\t1\tbar.ts'
    ].join('\n');

    const result = aggregateProjectStats(makeRaw({ logOutput }), 'all');
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0]).toMatchObject({ commits: 2, additions: 8, deletions: 3 });
    expect(result.totals.contributorsInPeriod).toBe(1);
  });

  it('excludes binary files (- lines) from addition/deletion counts', () => {
    const logOutput = [
      'C\tccc3333\tBob\tbob@example.com\t2026-04-01T10:00:00+00:00\tAdd binary',
      '',
      '-\t-\timage.png',
      '4\t2\ttext.ts'
    ].join('\n');

    const result = aggregateProjectStats(makeRaw({ logOutput }), 'all');
    expect(result.totals.additions).toBe(4);
    expect(result.totals.deletions).toBe(2);
  });

  it('handles multiple contributors and sorts by commit count', () => {
    const lines: string[] = [];
    // Bob: 3 commits, Alice: 1 commit
    for (let i = 0; i < 3; i++) {
      lines.push(`C\thash${i}\tBob\tbob@example.com\t2026-04-0${i + 1}T10:00:00+00:00\tCommit ${i}`);
      lines.push('');
      lines.push('1\t0\tfile.ts');
      lines.push('');
    }
    lines.push('C\thashA\tAlice\talice@example.com\t2026-04-04T10:00:00+00:00\tAlice commit');
    lines.push('');
    lines.push('2\t1\tother.ts');

    const result = aggregateProjectStats(makeRaw({ logOutput: lines.join('\n') }), 'all');
    expect(result.contributors[0]?.email).toBe('bob@example.com');
    expect(result.contributors[0]?.commits).toBe(3);
    expect(result.contributors[1]?.email).toBe('alice@example.com');
    expect(result.contributors[1]?.commits).toBe(1);
  });

  it('limits contributors to top 20', () => {
    const lines: string[] = [];
    for (let i = 0; i < 25; i++) {
      lines.push(`C\thash${i}\tUser${i}\tuser${i}@example.com\t2026-04-01T10:00:00+00:00\tCommit`);
      lines.push('');
      lines.push('1\t0\tfile.ts');
      lines.push('');
    }
    const result = aggregateProjectStats(makeRaw({ logOutput: lines.join('\n') }), 'all');
    expect(result.contributors).toHaveLength(20);
  });

  it('builds daily buckets from commit dates', () => {
    const logOutput = [
      'C\thash1\tAlice\ta@x.com\t2026-04-01T10:00:00+00:00\tA',
      '',
      '1\t0\tf.ts',
      '',
      'C\thash2\tAlice\ta@x.com\t2026-04-01T12:00:00+00:00\tB',
      '',
      '1\t0\tf.ts',
      '',
      'C\thash3\tAlice\ta@x.com\t2026-04-02T09:00:00+00:00\tC',
      '',
      '1\t0\tf.ts'
    ].join('\n');

    const result = aggregateProjectStats(makeRaw({ logOutput }), 'all');
    expect(result.daily).toHaveLength(2);
    const april1 = result.daily.find((d) => d.date === '2026-04-01');
    const april2 = result.daily.find((d) => d.date === '2026-04-02');
    expect(april1?.commits).toBe(2);
    expect(april2?.commits).toBe(1);
  });

  it('parses recent commits log', () => {
    const recentLogOutput = [
      'abc1234\tAlice\t2026-04-05T10:00:00+00:00\tFix bug',
      'def5678\tBob\t2026-04-04T09:00:00+00:00\tAdd feature\twith\ttabs'
    ].join('\n');

    const result = aggregateProjectStats(makeRaw({ recentLogOutput }), '30d');
    expect(result.recent).toHaveLength(2);
    expect(result.recent[0]).toMatchObject({ hash: 'abc1234', author: 'Alice', subject: 'Fix bug' });
    expect(result.recent[1]?.subject).toBe('Add feature\twith\ttabs');
  });

  it('limits recent commits to 20', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `hash${i}\tUser\t2026-04-01T00:00:00+00:00\tCommit ${i}`);
    const result = aggregateProjectStats(makeRaw({ recentLogOutput: lines.join('\n') }), 'all');
    expect(result.recent).toHaveLength(20);
  });

  it('builds a heatmap with 365 days worth of cells', () => {
    // Pin "now" so the test isn't affected by clock drift / DST.
    const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime(); // 2026-05-08 local
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    function localKey(d: Date): string {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    const todayKey = localKey(today);
    const yesterdayKey = localKey(yesterday);

    // Heatmap parser keys on first 10 chars of each line — which is the local date in git's %cI.
    const heatmapLogOutput = [
      `${todayKey}T10:00:00+00:00`,
      `${todayKey}T11:00:00+00:00`,
      `${yesterdayKey}T10:00:00+00:00`
    ].join('\n');

    const result = aggregateProjectStats(makeRaw({ heatmapLogOutput }), '30d', nowMs);
    expect(result.heatmap.length).toBeGreaterThan(360);
    for (const c of result.heatmap) {
      expect(c.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(c.dayOfWeek).toBeLessThanOrEqual(6);
    }
    const todayCell = result.heatmap.find((c) => c.date === todayKey);
    expect(todayCell?.commits).toBe(2);
    const yesterdayCell = result.heatmap.find((c) => c.date === yesterdayKey);
    expect(yesterdayCell?.commits).toBe(1);
  });

  it('uses raw.lastCommitISO so the card shows a date even when the period log is empty', () => {
    // Period filter returned no commits but the repo does have an all-time last commit.
    const result = aggregateProjectStats(makeRaw({ logOutput: '', lastCommitISO: '2026-03-01T10:00:00+00:00' }), '7d');
    expect(result.totals.commitsInPeriod).toBe(0);
    expect(result.totals.lastCommitISO).toBe('2026-03-01T10:00:00+00:00');
  });

  it('appends a truncation warning when the commit log hits the cap', () => {
    const lines: string[] = [];
    for (let i = 0; i < COMMIT_LOG_CAP; i++) {
      lines.push(`C\thash${i}\tUser\tu@x.com\t2026-04-01T10:00:00+00:00\tCommit ${i}`);
      lines.push('');
      lines.push('1\t0\tfile.ts');
      lines.push('');
    }
    const result = aggregateProjectStats(makeRaw({ logOutput: lines.join('\n'), warnings: ['existing'] }), 'all');
    expect(result.totals.commitsInPeriod).toBe(COMMIT_LOG_CAP);
    expect(result.warnings).toContain('existing');
    expect(result.warnings.some((w) => w.includes('totals may be partial'))).toBe(true);
  });

  it('keeps the most recent name spelling for a contributor (newest-first log)', () => {
    // Commits are newest-first in the log: newest = "Alice Smith", older = "Alice"
    const logOutput = [
      'C\tnewer\tAlice Smith\talice@example.com\t2026-04-10T10:00:00+00:00\tNew',
      '',
      '1\t0\tf.ts',
      '',
      'C\tolder\tAlice\talice@example.com\t2026-04-01T10:00:00+00:00\tOld',
      '',
      '1\t0\tf.ts'
    ].join('\n');

    const result = aggregateProjectStats(makeRaw({ logOutput }), 'all');
    expect(result.contributors[0]?.name).toBe('Alice Smith');
  });

  it('passes through all-time totals and metadata', () => {
    const result = aggregateProjectStats(
      makeRaw({
        allTimeCount: 500,
        branches: 3,
        tags: 7,
        firstCommitISO: '2020-01-01T00:00:00+00:00',
        warnings: ['test warning']
      }),
      '90d'
    );
    expect(result.totals.commitsAllTime).toBe(500);
    expect(result.totals.branches).toBe(3);
    expect(result.totals.tags).toBe(7);
    expect(result.totals.firstCommitISO).toBe('2020-01-01T00:00:00+00:00');
    expect(result.warnings).toEqual(['test warning']);
  });

  it('handles empty firstCommitISO as null', () => {
    const result = aggregateProjectStats(makeRaw({ firstCommitISO: '' }), 'all');
    expect(result.totals.firstCommitISO).toBeNull();
  });

  it('subject with tabs in commit header is preserved', () => {
    const logOutput = 'C\thash1\tAlice\ta@x.com\t2026-04-01T10:00:00+00:00\tFix\ttabbed\tsubject';
    const result = aggregateProjectStats(makeRaw({ logOutput }), 'all');
    expect(result.totals.commitsInPeriod).toBe(1);
  });
});
