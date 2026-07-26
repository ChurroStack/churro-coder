/**
 * Renders native harness review findings into the same severity-table markdown
 * shape the app's own `workflow/review.j2` prompt produces, so the Review
 * panel/milestone renders identically regardless of which source populated it
 * (an explicit `write_review` call, Codex's native `/review`, or a Claude
 * `ReportFindings` tool_use — should one ever surface outside a sidechain).
 *
 * Shared between main-process CLI ingestion (cli-session/jsonl-mapper.ts) and
 * the builtin Claude stream path (trpc/routers/claude.ts).
 */

/**
 * Claude's `/code-review` can fork itself into a detached background skill
 * agent instead of resolving inline — its local-command stdout is then just a
 * launch acknowledgment ("Running in the background as @code-review") plus
 * this tag carrying the background agent's id, not the review itself.
 * Verified against a real transcript; the forked agent's output never lands
 * back in the parent session, so there's nothing here worth persisting as a
 * review.
 */
export function isForkedSkillLaunch(rawLocalCommandContent: string): boolean {
  return rawLocalCommandContent.includes('<forked-skill-launch>');
}

export interface ReportFinding {
  file?: string;
  line?: number;
  summary?: string;
  short_summary?: string;
  failure_scenario?: string;
  category?: string;
  verdict?: 'CONFIRMED' | 'PLAUSIBLE' | string;
}

/** Claude's `ReportFindings` tool input: `{ findings: ReportFinding[] }`. */
export function renderReportFindingsMarkdown(findings: ReportFinding[]): string {
  if (findings.length === 0) {
    return '# Code Review\n\nCode looks good.';
  }
  const rows = findings
    .map((f) => {
      const severity = severityForVerdict(f.verdict);
      const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
      const issue = f.short_summary || f.summary || '';
      const suggestion = f.failure_scenario || '';
      return `| ${severity} | ${escapeCell(location)} | ${escapeCell(issue)} | ${escapeCell(suggestion)} |`;
    })
    .join('\n');
  return (
    '# Code Review\n\n' +
    '## Issues Found\n\n' +
    '| Severity | File:Line | Issue | Suggestion |\n' +
    '|----------|-----------|-------|------------|\n' +
    rows
  );
}

function severityForVerdict(verdict: string | undefined): string {
  // ReportFindings doesn't carry an explicit severity field — CONFIRMED findings
  // default to high, everything else to medium, matching the tool's own
  // "most-severe first" ordering convention.
  return verdict === 'CONFIRMED' ? '🔴 high' : '🟡 medium';
}

export interface CodexReviewFinding {
  title?: string;
  body?: string;
  confidence_score?: number;
  priority?: number;
  code_location?: {
    absolute_file_path?: string;
    line_range?: { start?: number; end?: number };
  };
}

export interface CodexReviewOutput {
  findings?: CodexReviewFinding[];
  overall_correctness?: string;
  overall_explanation?: string;
  overall_confidence_score?: number;
}

/** Codex's `exited_review_mode` event payload's `review_output` field. */
export function renderCodexReviewOutputMarkdown(reviewOutput: CodexReviewOutput): string {
  const findings = reviewOutput.findings ?? [];
  const summary = reviewOutput.overall_explanation?.trim();
  const summarySection = summary ? `## Summary\n\n${summary}\n\n` : '';

  if (findings.length === 0) {
    return `# Code Review\n\n${summarySection}Code looks good.`;
  }

  const rows = findings
    .map((f) => {
      // Codex priorities are P0/P1/P2/... (lower number = more severe) —
      // bucket 0/1 as high, 2 as medium, 3+ as low.
      const severity = severityForPriority(f.priority);
      const path = f.code_location?.absolute_file_path ?? '';
      const line = f.code_location?.line_range?.start;
      const location = path ? `${path}${line ? `:${line}` : ''}` : '';
      const issue = f.title || '';
      const suggestion = f.body || '';
      return `| ${severity} | ${escapeCell(location)} | ${escapeCell(issue)} | ${escapeCell(suggestion)} |`;
    })
    .join('\n');

  return (
    `# Code Review\n\n${summarySection}` +
    '## Issues Found\n\n' +
    '| Severity | File:Line | Issue | Suggestion |\n' +
    '|----------|-----------|-------|------------|\n' +
    rows
  );
}

function severityForPriority(priority: number | undefined): string {
  if (priority === undefined) return '🟡 medium';
  if (priority <= 1) return '🔴 high';
  if (priority === 2) return '🟡 medium';
  return '🟢 low';
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
