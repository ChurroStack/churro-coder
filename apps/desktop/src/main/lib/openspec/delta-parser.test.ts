import { describe, expect, test } from 'vitest';
import { parseDeltaSpec } from './delta-parser';

describe('parseDeltaSpec', () => {
  test('parses ADDED requirement with single scenario', () => {
    const raw = `## ADDED Requirements
### Requirement: Two-Factor Authentication
Users MUST provide a second factor during login.

#### Scenario: OTP required
- **WHEN** valid credentials are provided
- **THEN** an OTP challenge is required
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.capabilityId).toBe('auth');
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.name).toBe('Two-Factor Authentication');
    expect(d.added[0]!.body).toContain('Users MUST provide');
    expect(d.added[0]!.scenarios).toHaveLength(1);
    expect(d.added[0]!.scenarios[0]!.name).toBe('OTP required');
    expect(d.added[0]!.scenarios[0]!.body).toContain('valid credentials');
  });

  test('parses multiple sections in one file', () => {
    const raw = `## ADDED Requirements
### Requirement: A
text

#### Scenario: a1
- **WHEN** x
- **THEN** y

## MODIFIED Requirements
### Requirement: B
text

#### Scenario: b1
- **WHEN** x
- **THEN** y

## REMOVED Requirements
### Requirement: C
**Reason**: deprecated

#### Scenario: c1
- **WHEN** x
- **THEN** y
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.added.map((r) => r.name)).toEqual(['A']);
    expect(d.modified.map((r) => r.name)).toEqual(['B']);
    expect(d.removed.map((r) => r.name)).toEqual(['C']);
  });

  test('whitespace-insensitive section headings', () => {
    const raw = `##   ADDED   Requirements
### Requirement: X
body

#### Scenario: s
- **WHEN** w
- **THEN** t
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.name).toBe('X');
  });

  test('multiple scenarios under one requirement', () => {
    const raw = `## ADDED Requirements
### Requirement: Multi
body

#### Scenario: first
- **WHEN** a
- **THEN** b

#### Scenario: second
- **WHEN** c
- **THEN** d
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.added[0]!.scenarios.map((s) => s.name)).toEqual(['first', 'second']);
  });

  test('multiple requirements under one section', () => {
    const raw = `## ADDED Requirements
### Requirement: One
body1

#### Scenario: s1
- **WHEN** a
- **THEN** b

### Requirement: Two
body2

#### Scenario: s2
- **WHEN** a
- **THEN** b
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.added.map((r) => r.name)).toEqual(['One', 'Two']);
  });

  test('parses RENAMED Requirements pairs', () => {
    const raw = `## RENAMED Requirements
- FROM: \`### Requirement: Login\`
- TO: \`### Requirement: User Authentication\`
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.renamed).toEqual([{ from: 'Login', to: 'User Authentication' }]);
  });

  test('returns empty arrays for empty input', () => {
    const d = parseDeltaSpec('auth', '');
    expect(d.added).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.renamed).toEqual([]);
  });

  test('handles CRLF line endings', () => {
    const raw = `## ADDED Requirements\r\n### Requirement: X\r\nbody\r\n\r\n#### Scenario: s\r\n- **WHEN** a\r\n- **THEN** b\r\n`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.scenarios).toHaveLength(1);
  });

  test('requirement with no scenarios still parses (body captured, scenarios empty)', () => {
    const raw = `## ADDED Requirements
### Requirement: Bare
body content
`;
    const d = parseDeltaSpec('auth', raw);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.body).toBe('body content');
    expect(d.added[0]!.scenarios).toEqual([]);
  });
});
