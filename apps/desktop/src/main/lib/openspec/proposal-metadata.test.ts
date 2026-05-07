import { describe, expect, test } from 'vitest';
import { parseProposalMetadata } from './proposal-metadata';

describe('parseProposalMetadata - sections only', () => {
  test('parses canonical OpenSpec proposal', () => {
    const raw = `# Change: Add Two-Factor Auth

## Why
Users want stronger account protection. Compliance also requires MFA for admin accounts.

## What Changes
- Add OTP delivery via email
- Add backup codes
- **BREAKING** require admin re-enrollment

## Impact
- Affected specs: auth
- Affected code: src/auth, src/api/login.ts
`;
    const m = parseProposalMetadata('add-two-factor-auth', raw);
    expect(m.changeId).toBe('add-two-factor-auth');
    expect(m.title).toBe('Add Two-Factor Auth');
    expect(m.why).toContain('stronger account protection');
    expect(m.whatChanges).toEqual([
      'Add OTP delivery via email',
      'Add backup codes',
      '**BREAKING** require admin re-enrollment'
    ]);
    expect(m.impact?.specs).toEqual(['auth']);
    expect(m.impact?.code).toEqual(['src/auth', 'src/api/login.ts']);
    expect(m.attributes).toEqual({});
  });

  test('handles plain H1 without "Change:" prefix', () => {
    const m = parseProposalMetadata('foo', '# Just a title\n\n## Why\nbody\n');
    expect(m.title).toBe('Just a title');
  });

  test('falls back to changeId when no H1 is present', () => {
    const m = parseProposalMetadata('add-foo', '## Why\nbecause\n');
    expect(m.title).toBe('add-foo');
  });

  test('returns empty whatChanges when no bullets are present', () => {
    const m = parseProposalMetadata('foo', '# foo\n## What Changes\n\nNot a bullet line\n');
    expect(m.whatChanges).toEqual([]);
  });

  test('returns undefined impact when section absent', () => {
    const m = parseProposalMetadata('foo', '# foo\n## Why\nbecause\n');
    expect(m.impact).toBeUndefined();
  });

  test('header matching is case-insensitive and trim-tolerant', () => {
    const raw = `# x

##   what changes
- a
- b
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.whatChanges).toEqual(['a', 'b']);
  });

  test('impact bullets without labels still populate code list', () => {
    const raw = `# foo
## Impact
- src/foo.ts
- src/bar.ts
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.impact?.specs).toEqual([]);
    expect(m.impact?.code).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  test('impact with inline comma-separated values', () => {
    const raw = `# foo
## Impact
- Affected specs: auth, payments
- Affected code: src/auth, src/payments
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.impact?.specs).toEqual(['auth', 'payments']);
    expect(m.impact?.code).toEqual(['src/auth', 'src/payments']);
  });
});

describe('parseProposalMetadata - frontmatter override', () => {
  test('frontmatter title overrides H1', () => {
    const raw = `---
title: Frontmatter Wins
status: draft
---

# Change: Section title

## Why
because
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.title).toBe('Frontmatter Wins');
    expect(m.attributes.status).toBe('draft');
  });

  test('frontmatter passthrough exposes arbitrary attributes', () => {
    const raw = `---
owner: alice
priority: high
---

# foo
## Why
because
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.attributes.owner).toBe('alice');
    expect(m.attributes.priority).toBe('high');
  });

  test('frontmatter why overrides section why', () => {
    const raw = `---
why: from frontmatter
---

# foo
## Why
section text
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.why).toBe('from frontmatter');
  });

  test('frontmatter whatChanges array overrides section bullets', () => {
    const raw = `---
whatChanges:
  - first
  - second
---

# foo
## What Changes
- ignored
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.whatChanges).toEqual(['first', 'second']);
  });

  test('frontmatter impact merges with parsed when only one side is provided', () => {
    const raw = `---
impact:
  specs:
    - auth
---

# foo
## Impact
- Affected code: src/foo.ts
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.impact?.specs).toEqual(['auth']);
    expect(m.impact?.code).toEqual(['src/foo.ts']);
  });

  test('malformed frontmatter falls back to section parsing', () => {
    const raw = `---
title: "unterminated
---

# Section Title

## Why
because
`;
    // gray-matter may either throw or successfully parse the broken YAML;
    // either way we should end up with valid output.
    const m = parseProposalMetadata('foo', raw);
    expect(m.title.length).toBeGreaterThan(0);
    expect(typeof m.attributes).toBe('object');
  });
});

describe('parseProposalMetadata - top 50 lines cap', () => {
  test('sections beyond line 50 are ignored', () => {
    const padding = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const raw = `# foo
${padding}

## What Changes
- should-be-ignored
`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.whatChanges).toEqual([]);
  });

  test('CRLF line endings parse the same as LF', () => {
    const raw = `# foo\r\n\r\n## What Changes\r\n- a\r\n- b\r\n`;
    const m = parseProposalMetadata('foo', raw);
    expect(m.whatChanges).toEqual(['a', 'b']);
  });
});
