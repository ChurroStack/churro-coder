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
  severity?: string;
  priority?: number;
  summary?: string;
  short_summary?: string;
  failure_scenario?: string;
  category?: string;
  verdict?: 'CONFIRMED' | 'PLAUSIBLE' | string;
}

/** Claude's `ReportFindings` tool input: `{ findings: ReportFinding[] }`. */
export function renderReportFindingsMarkdown(findings: ReportFinding[]): string {
  if (findings.length === 0) {
    return '# Code Review\n\n## Summary\n\nCode looks good.';
  }
  const rows = findings
    .map((f) => {
      const severity = severityForReportFinding(f);
      const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
      const issue = f.short_summary || f.summary || '';
      const suggestion = f.failure_scenario || '';
      return `| ${severity} | ${escapeCell(location)} | ${escapeCell(issue)} | ${escapeCell(suggestion)} |`;
    })
    .join('\n');
  return (
    '# Code Review\n\n' +
    `## Summary\n\n${summaryForFindingCount(findings.length)}\n\n` +
    '## Issues Found\n\n' +
    '| Severity | File:Line | Issue | Suggestion |\n' +
    '|----------|-----------|-------|------------|\n' +
    rows
  );
}

function severityForReportFinding(finding: ReportFinding): string {
  const explicit = finding.severity?.trim().toLowerCase();
  if (explicit === 'critical' || explicit === 'high' || explicit === 'p0' || explicit === 'p1') return '🔴 high';
  if (explicit === 'low' || explicit === 'info' || explicit === 'p3' || explicit === 'p4') return '🟢 low';
  if (explicit === 'medium' || explicit === 'moderate' || explicit === 'p2') return '🟡 medium';
  if (typeof finding.priority === 'number') return severityForPriority(finding.priority);
  // ReportFindings doesn't carry an explicit severity field — CONFIRMED findings
  // default to high, everything else to medium, matching the tool's own
  // "most-severe first" ordering convention.
  return finding.verdict === 'CONFIRMED' ? '🔴 high' : '🟡 medium';
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
  const summary =
    reviewOutput.overall_explanation?.trim() ||
    (findings.length === 0 ? 'Code looks good.' : summaryForFindingCount(findings.length));
  const summarySection = `## Summary\n\n${summary}`;

  if (findings.length === 0) {
    return `# Code Review\n\n${summarySection}`;
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
    `# Code Review\n\n${summarySection}\n\n` +
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

function summaryForFindingCount(count: number): string {
  return `Found ${count} ${count === 1 ? 'issue' : 'issues'}.`;
}

const CANONICAL_TABLE_HEADER = '| Severity | File:Line | Issue | Suggestion |';

interface ParsedLocalFinding {
  severity: string;
  location: string;
  issue: string;
  suggestion: string;
}

interface ParsedLocalReview {
  findings: ParsedLocalFinding[];
  summary: string;
  details: string[];
}

/**
 * Converts a completed native review into the Review widget's canonical shape.
 * Structured sources should use the rendering helpers above. This handles
 * Claude local-command stdout, where the CLI version controls the text shape.
 */
export function normalizeNativeReviewMarkdown(raw: string): string {
  return normalizeNativeReview(raw).markdown;
}

export function normalizeNativeReview(raw: string): { markdown: string; usedFallback: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { markdown: '# Code Review\n\n## Summary\n\nNo review details were returned.', usedFallback: true };
  if (trimmed.includes(CANONICAL_TABLE_HEADER) || /^# Code Review\n\n## Summary\b/.test(trimmed)) {
    return { markdown: raw, usedFallback: false };
  }

  const parsed = parseClaudeLocalCommandFindings(trimmed);
  if (parsed.findings.length > 0) return { markdown: renderParsedFindings(parsed), usedFallback: false };

  // Do not infer a severity from prose. The raw review remains visible and
  // useful even when a native CLI changed its unstructured output format.
  return { markdown: `# Code Review\n\n## Summary\n\n${trimmed}`, usedFallback: true };
}

function parseClaudeLocalCommandFindings(raw: string): ParsedLocalReview {
  const [preamble = '', ...blocks] = raw.split(/^###\s+/m);
  const findings: ParsedLocalFinding[] = [];
  const details: string[] = [];

  for (const block of blocks) {
    const [heading = '', ...bodyLines] = block.split('\n');
    const severityMatch = heading.match(/\[(critical|high|medium|moderate|low|p[0-4])\]/i);
    if (!severityMatch) {
      details.push(`### ${block.trim()}`);
      continue;
    }
    const body = bodyLines.join('\n');
    const location = body.match(/(?:file|location)\s*:\s*`?([^`\n]+)`?/i)?.[1]?.trim() ?? '';
    const suggestion = body.match(/(?:suggestion|recommendation)\s*:\s*(.+)/i)?.[1]?.trim() ?? '';
    const issue = heading.replace(/^\[[^\]]+\]\s*/, '').trim();
    if (!issue) {
      details.push(`### ${block.trim()}`);
      continue;
    }
    findings.push({
      severity: severityForLocalToken(severityMatch[1]),
      location,
      issue,
      suggestion
    });

    const extraBody = bodyLines
      .filter(
        (line) =>
          !/^\s*[-*]?\s*(?:\*\*)?(?:file|location|suggestion|recommendation)(?:\*\*)?\s*:/i.test(line)
      )
      .join('\n')
      .trim();
    if (extraBody) details.push(`### ${issue}\n\n${extraBody}`);
  }

  const summary =
    preamble
      .replace(/^##\s+(?:summary|findings)\s*$/gim, '')
      .trim() || summaryForFindingCount(findings.length);

  return { findings, summary, details };
}

function severityForLocalToken(token: string): string {
  const normalized = token.toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'p0' || normalized === 'p1') return '🔴 high';
  if (normalized === 'low' || normalized === 'p3' || normalized === 'p4') return '🟢 low';
  return '🟡 medium';
}

function renderParsedFindings(review: ParsedLocalReview): string {
  const rows = review.findings
    .map(
      (finding) =>
        `| ${finding.severity} | ${escapeCell(finding.location)} | ${escapeCell(finding.issue)} | ${escapeCell(
          finding.suggestion
        )} |`
    )
    .join('\n');
  const detailSection =
    review.details.length > 0 ? `\n\n## Details\n\n${review.details.join('\n\n')}` : '';
  return (
    '# Code Review\n\n' +
    `## Summary\n\n${review.summary}\n\n` +
    '## Issues Found\n\n' +
    `${CANONICAL_TABLE_HEADER}\n` +
    '|----------|-----------|-------|------------|\n' +
    rows +
    detailSection
  );
}
