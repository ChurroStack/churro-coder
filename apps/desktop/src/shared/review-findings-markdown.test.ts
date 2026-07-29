import { describe, expect, test } from 'vitest';
import {
  normalizeNativeReviewMarkdown,
  renderCodexReviewOutputMarkdown,
  renderReportFindingsMarkdown
} from './review-findings-markdown';

describe('native review markdown', () => {
  test('preserves already-canonical markdown unchanged', () => {
    const canonical =
      '# Code Review\n\n## Summary\n\nOne issue.\n\n## Issues Found\n\n' +
      '| Severity | File:Line | Issue | Suggestion |\n' +
      '|----------|-----------|-------|------------|\n' +
      '| 🔴 high | src/a.ts:3 | Broken | Guard it |';

    expect(normalizeNativeReviewMarkdown(canonical)).toBe(canonical);
  });

  test('renders Codex priorities as canonical semaphore rows', () => {
    const markdown = renderCodexReviewOutputMarkdown({
      overall_explanation: 'The change has two correctness issues.',
      findings: [
        {
          priority: 1,
          title: 'Reject invalid input',
          body: 'Validate the value before saving.',
          code_location: { absolute_file_path: 'src/input.ts', line_range: { start: 12 } }
        },
        {
          priority: 3,
          title: 'Clarify name',
          body: 'Use a descriptive variable name.',
          code_location: { absolute_file_path: 'src/name.ts', line_range: { start: 4 } }
        }
      ]
    });

    expect(markdown).toContain('## Summary\n\nThe change has two correctness issues.');
    expect(markdown).toContain('| 🔴 high | src/input.ts:12 | Reject invalid input | Validate the value before saving. |');
    expect(markdown).toContain('| 🟢 low | src/name.ts:4 | Clarify name | Use a descriptive variable name. |');
  });

  test('renders Claude ReportFindings severity and preserves low findings', () => {
    const markdown = renderReportFindingsMarkdown([
      {
        severity: 'high',
        file: 'src/auth.ts',
        line: 9,
        summary: 'Authorization is bypassed.',
        failure_scenario: 'Check ownership before returning the record.'
      },
      {
        severity: 'low',
        file: 'src/log.ts',
        line: 5,
        summary: 'The message is unclear.'
      }
    ]);

    expect(markdown).toContain('## Summary\n\nFound 2 issues.');
    expect(markdown).toContain('| 🔴 high | src/auth.ts:9 | Authorization is bypassed. | Check ownership before returning the record. |');
    expect(markdown).toContain('| 🟢 low | src/log.ts:5 | The message is unclear. |  |');
  });

  test('renders a canonical summary when Claude reports no findings', () => {
    expect(renderReportFindingsMarkdown([])).toBe('# Code Review\n\n## Summary\n\nCode looks good.');
  });

  test('best-effort parses known Claude local-command finding blocks', () => {
    const markdown = normalizeNativeReviewMarkdown(
      '## Findings\n\n### [high] Missing authorization\n- File: `src/auth.ts:42`\n- Suggestion: Check ownership.\n\n### [low] Ambiguous log\n- File: `src/log.ts:8`\n- Suggestion: Name the event.'
    );

    expect(markdown).toContain('## Summary\n\nFound 2 issues.');
    expect(markdown).toContain('| 🔴 high | src/auth.ts:42 | Missing authorization | Check ownership. |');
    expect(markdown).toContain('| 🟢 low | src/log.ts:8 | Ambiguous log | Name the event. |');
  });

  test('preserves Claude local-command summary and detail outside canonical table fields', () => {
    const markdown = normalizeNativeReviewMarkdown(
      '## Summary\n\nAuthentication paths need attention.\n\n## Findings\n\n' +
        '### [high] Missing authorization\n' +
        '- File: `src/auth.ts:42`\n' +
        '- Evidence: Tenant B can read tenant A.\n' +
        '- Suggestion: Check ownership.'
    );

    expect(markdown).toContain('## Summary\n\nAuthentication paths need attention.');
    expect(markdown).toContain('| 🔴 high | src/auth.ts:42 | Missing authorization | Check ownership. |');
    expect(markdown).toContain('## Details\n\n### Missing authorization\n\n- Evidence: Tenant B can read tenant A.');
  });

  test('renders a fallback summary for structured Codex findings without an explanation', () => {
    const markdown = renderCodexReviewOutputMarkdown({
      findings: [{ priority: 2, title: 'Handle the empty state', body: 'Return before indexing the array.' }]
    });

    expect(markdown).toContain('## Summary\n\nFound 1 issue.');
  });

  test('falls back to headed markdown without inventing a severity', () => {
    const raw = 'I found an issue but the CLI did not provide a structured finding.';
    const markdown = normalizeNativeReviewMarkdown(raw);

    expect(markdown).toBe(`# Code Review\n\n## Summary\n\n${raw}`);
    expect(markdown).not.toContain('| Severity |');
  });
});
