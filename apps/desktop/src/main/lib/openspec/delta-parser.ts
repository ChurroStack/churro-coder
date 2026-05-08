import type { DeltaSpec, Requirement, Scenario } from './types';

/**
 * Delta-spec parser for `<change>/specs/<capability>/spec.md`.
 *
 * The OpenSpec convention defines four section types:
 *   ## ADDED Requirements
 *   ## MODIFIED Requirements
 *   ## REMOVED Requirements
 *   ## RENAMED Requirements
 *
 * Inside the first three, requirements are split by `### Requirement: <name>`
 * and scenarios by `#### Scenario: <name>`. RENAMED uses bullet pairs of
 * `- FROM: ...` / `- TO: ...`.
 *
 * Header matching is whitespace-insensitive (trim) per the OpenSpec spec.
 */

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/;
const REQUIREMENT_REGEX = /^###\s+Requirement\s*:\s*(.+?)\s*$/i;
const SCENARIO_REGEX = /^####\s+Scenario\s*:\s*(.+?)\s*$/i;
const RENAME_FROM_REGEX = /^\s*-\s*FROM\s*:\s*(?:`)?(?:###\s+Requirement\s*:\s*)?(.+?)(?:`)?\s*$/i;
const RENAME_TO_REGEX = /^\s*-\s*TO\s*:\s*(?:`)?(?:###\s+Requirement\s*:\s*)?(.+?)(?:`)?\s*$/i;

type SectionKind = 'added' | 'modified' | 'removed' | 'renamed';

interface SectionRange {
  kind: SectionKind;
  bodyStart: number;
  bodyEnd: number;
}

function classifySection(headingText: string): SectionKind | undefined {
  const t = headingText.trim().replace(/\s+/g, ' ').toLowerCase();
  if (t === 'added requirements') return 'added';
  if (t === 'modified requirements') return 'modified';
  if (t === 'removed requirements') return 'removed';
  if (t === 'renamed requirements') return 'renamed';
  return undefined;
}

function splitSections(lines: string[]): SectionRange[] {
  const sections: SectionRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_REGEX.exec(lines[i]!);
    if (!m || m[1] !== '##') continue;
    const kind = classifySection(m[2]!);
    if (!kind) continue;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const inner = HEADING_REGEX.exec(lines[j]!);
      if (inner && (inner[1] === '#' || inner[1] === '##')) {
        end = j;
        break;
      }
    }
    sections.push({ kind, bodyStart: i + 1, bodyEnd: end });
  }
  return sections;
}

function parseRequirements(lines: string[]): Requirement[] {
  const requirements: Requirement[] = [];

  // First pass: capture every requirement header (index + parsed name) once.
  const requirementHeaders: { index: number; name: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = REQUIREMENT_REGEX.exec(lines[i]!);
    if (m) requirementHeaders.push({ index: i, name: m[1]!.trim() });
  }

  for (let r = 0; r < requirementHeaders.length; r++) {
    const { index: start, name } = requirementHeaders[r]!;
    const end = r + 1 < requirementHeaders.length ? requirementHeaders[r + 1]!.index : lines.length;

    // Capture scenarios in a single pass — store both index and parsed name.
    const scenarios: { index: number; name: string }[] = [];
    for (let i = start + 1; i < end; i++) {
      const m = SCENARIO_REGEX.exec(lines[i]!);
      if (m) scenarios.push({ index: i, name: m[1]!.trim() });
    }

    const bodyEnd = scenarios.length > 0 ? scenarios[0]!.index : end;
    const body = lines
      .slice(start + 1, bodyEnd)
      .join('\n')
      .trim();

    const scenariosOut: Scenario[] = scenarios.map((s, idx) => {
      const sEnd = idx + 1 < scenarios.length ? scenarios[idx + 1]!.index : end;
      const sBody = lines
        .slice(s.index + 1, sEnd)
        .join('\n')
        .trim();
      return { name: s.name, body: sBody };
    });

    requirements.push({ name, body, scenarios: scenariosOut });
  }

  return requirements;
}

function parseRenames(lines: string[]): { from: string; to: string }[] {
  const renames: { from: string; to: string }[] = [];
  let pendingFrom: string | undefined;
  for (const raw of lines) {
    const fromMatch = RENAME_FROM_REGEX.exec(raw);
    const toMatch = RENAME_TO_REGEX.exec(raw);
    if (fromMatch) {
      pendingFrom = fromMatch[1]!;
      continue;
    }
    if (toMatch && pendingFrom !== undefined) {
      renames.push({ from: pendingFrom, to: toMatch[1]! });
      pendingFrom = undefined;
    }
  }
  return renames;
}

export function parseDeltaSpec(capabilityId: string, raw: string): DeltaSpec {
  const lines = raw.split(/\r?\n/);
  const sections = splitSections(lines);

  const result: DeltaSpec = {
    capabilityId,
    added: [],
    modified: [],
    removed: [],
    renamed: []
  };

  for (const section of sections) {
    const body = lines.slice(section.bodyStart, section.bodyEnd);
    if (section.kind === 'renamed') {
      result.renamed.push(...parseRenames(body));
    } else {
      const requirements = parseRequirements(body);
      if (section.kind === 'added') result.added.push(...requirements);
      else if (section.kind === 'modified') result.modified.push(...requirements);
      else if (section.kind === 'removed') result.removed.push(...requirements);
    }
  }

  return result;
}
