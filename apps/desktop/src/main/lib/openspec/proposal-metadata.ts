import matter from 'gray-matter';
import type { ProposalMetadata } from './types';

/**
 * Maximum number of lines from the proposal body (after stripping frontmatter)
 * that the section parser will consider. The user's task asked for ~50 lines
 * "from the header" — proposals always start with metadata sections, so this
 * is plenty for title + Why + What Changes + Impact in practice.
 */
const MAX_HEADER_LINES = 50;

/**
 * Strip the optional `Change: ` prefix and any leading `# ` from the H1.
 * "Change: Add OAuth" -> "Add OAuth"
 * "Add OAuth" -> "Add OAuth"
 */
function cleanTitle(raw: string): string {
  return raw.replace(/^change\s*:\s*/i, '').trim();
}

interface ParsedSections {
  title?: string;
  why?: string;
  whatChanges: string[];
  impact?: { specs: string[]; code: string[] };
}

interface SectionRange {
  startLine: number; // line index of the `## Heading` itself
  bodyStart: number; // first line after the heading
  bodyEnd: number; // exclusive
}

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/;

function findH1(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = HEADING_REGEX.exec(line);
    if (!m) continue;
    if (m[1] === '#') return cleanTitle(m[2]!);
  }
  return undefined;
}

/**
 * Locate `## <name>` blocks. Matching is case-insensitive and trims whitespace,
 * which mirrors the OpenSpec convention ("Headers matched with trim(header)").
 * The block runs until the next H2 (or higher) or EOF.
 */
function findSection(lines: string[], name: string): SectionRange | undefined {
  const target = name.trim().replace(/\s+/g, ' ').toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_REGEX.exec(lines[i]!);
    if (!m) continue;
    if (m[1] === '##' && m[2]!.trim().replace(/\s+/g, ' ').toLowerCase() === target) {
      start = i;
      break;
    }
  }
  if (start === -1) return undefined;

  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const m = HEADING_REGEX.exec(lines[j]!);
    if (m && (m[1] === '#' || m[1] === '##')) {
      end = j;
      break;
    }
  }
  return { startLine: start, bodyStart: start + 1, bodyEnd: end };
}

function firstParagraph(lines: string[]): string | undefined {
  // Skip blanks, then collect contiguous non-blank, non-bullet, non-heading lines.
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  if (i >= lines.length) return undefined;
  // If the first non-blank line is a bullet, treat the bullet line as the paragraph.
  const collected: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') break;
    if (HEADING_REGEX.test(line)) break;
    collected.push(line.trim());
  }
  const out = collected.join(' ').trim();
  return out.length > 0 ? out : undefined;
}

const BULLET_REGEX = /^\s*[-*]\s+(.+?)\s*$/;

function bullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = BULLET_REGEX.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

const IMPACT_LABEL_REGEX = /^(?:\*\*)?affected\s+(specs?|code)(?:\*\*)?\s*:\s*(.*)$/i;

/**
 * Extract `## Impact` data. The OpenSpec convention uses labeled bullets:
 *
 *     - Affected specs: auth, payments
 *     - Affected code: src/auth, src/payments
 *
 * When bullets are not labeled, we fall back to attributing them to `code` —
 * `specs` will be empty in that case. UI consumers should treat `code` as the
 * authoritative list and only rely on `specs` when at least one labeled
 * "Affected specs:" bullet is present.
 */
function parseImpact(lines: string[]): { specs: string[]; code: string[] } | undefined {
  const specs: string[] = [];
  const code: string[] = [];
  let labeled = false;

  for (const raw of lines) {
    const m = BULLET_REGEX.exec(raw);
    if (!m) continue;
    const text = m[1]!;
    const labelMatch = IMPACT_LABEL_REGEX.exec(text);
    if (labelMatch) {
      labeled = true;
      const kind = labelMatch[1]!.toLowerCase();
      const rest = labelMatch[2]!.trim();
      if (rest.length > 0) {
        // Inline list: "Affected specs: auth, payments"
        const parts = rest
          .split(/[,;]/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (kind.startsWith('spec')) specs.push(...parts);
        else code.push(...parts);
      }
    } else if (labeled) {
      // After a label, plain bullets attribute to whichever was last labeled.
      // Without a clean way to disambiguate, append to `code` as the catch-all.
      code.push(text);
    } else {
      code.push(text);
    }
  }

  if (specs.length === 0 && code.length === 0) return undefined;
  return { specs, code };
}

function parseSections(body: string): ParsedSections {
  const allLines = body.split(/\r?\n/);
  const lines = allLines.slice(0, MAX_HEADER_LINES);

  const title = findH1(lines);
  const whyRange = findSection(lines, 'Why');
  const whatRange = findSection(lines, 'What Changes');
  const impactRange = findSection(lines, 'Impact');

  const why = whyRange ? firstParagraph(lines.slice(whyRange.bodyStart, whyRange.bodyEnd)) : undefined;
  const whatChanges = whatRange ? bullets(lines.slice(whatRange.bodyStart, whatRange.bodyEnd)) : [];
  const impact = impactRange ? parseImpact(lines.slice(impactRange.bodyStart, impactRange.bodyEnd)) : undefined;

  return { title, why, whatChanges, impact };
}

/**
 * Try to read frontmatter without crashing on malformed YAML. gray-matter throws
 * when the frontmatter block is unparseable; in that case we fall back to
 * treating the whole input as the body.
 */
function safeFrontmatter(text: string): { data: Record<string, unknown>; content: string } {
  try {
    const parsed = matter(text);
    return {
      data: (parsed.data ?? {}) as Record<string, unknown>,
      content: parsed.content
    };
  } catch (err) {
    console.warn('[openspec] Failed to parse proposal frontmatter, using full body:', (err as Error).message);
    return { data: {}, content: text };
  }
}

export function parseProposalMetadata(changeId: string, raw: string): ProposalMetadata {
  const { data, content } = safeFrontmatter(raw);
  const sections = parseSections(content);

  // Frontmatter overrides parsed sections key-by-key.
  const fmTitle = typeof data.title === 'string' ? data.title : undefined;
  const fmWhy = typeof data.why === 'string' ? data.why : undefined;
  const fmWhatChanges = Array.isArray(data.whatChanges)
    ? data.whatChanges.filter((v) => typeof v === 'string')
    : undefined;

  let impact = sections.impact;
  if (data.impact && typeof data.impact === 'object' && !Array.isArray(data.impact)) {
    const fmImpact = data.impact as Record<string, unknown>;
    const fmSpecs = Array.isArray(fmImpact.specs)
      ? fmImpact.specs.filter((v): v is string => typeof v === 'string')
      : undefined;
    const fmCode = Array.isArray(fmImpact.code)
      ? fmImpact.code.filter((v): v is string => typeof v === 'string')
      : undefined;
    if (fmSpecs || fmCode) {
      impact = {
        specs: fmSpecs ?? impact?.specs ?? [],
        code: fmCode ?? impact?.code ?? []
      };
    }
  }

  const title = fmTitle ?? sections.title ?? changeId;

  return {
    changeId,
    title,
    why: fmWhy ?? sections.why,
    whatChanges: fmWhatChanges ?? sections.whatChanges,
    impact,
    attributes: data
  };
}
