/**
 * Parses a tasks.md file into a structured outline of sections and tasks.
 *
 * Expected format (OpenSpec standard):
 *   ## N. Section Title
 *   - [ ] N.M Task title path/to/optional/file.ts
 *   - [x] N.M Done task
 *
 * H1 is treated as a document title and skipped.
 * H2+ become sections.
 */

export interface Task {
  /** Full task label as it appears in the markdown, e.g. "1.1" or "Task title". */
  id: string;
  title: string;
  done: boolean;
  /** Indentation depth: 0 = top-level, 1+ = nested. */
  depth: number;
  /** Best-effort file path extracted from the task title. */
  filePath?: string;
  /** 0-based index of this task's line in the raw content (used for in-place toggling). */
  lineIndex: number;
}

export interface TaskSection {
  /** Section heading text (without leading ## or numbering). */
  title: string;
  tasks: Task[];
}

export interface TasksOutline {
  /** Raw text before the first section heading (intro/preamble). */
  intro: string;
  sections: TaskSection[];
}

const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
// Match common code file paths. Try not to match bare numbers or single words.
const FILE_PATH_RE = /\b((?:[\w./\-]+\/)?[\w\-]+\.(?:ts|tsx|js|jsx|go|cs|py|rs|md|json|yaml|yml|toml|sql))\b/;

export function parseTasksOutline(raw: string): TasksOutline {
  const lines = raw.split(/\r?\n/);
  const sections: TaskSection[] = [];
  let intro = '';
  let inIntro = true;
  let currentSection: TaskSection | null = null;
  let taskCounter = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const rawTitle = headingMatch[2]!.trim();

      if (level === 1) {
        // H1 = document title, skip as section
        inIntro = false;
        continue;
      }

      inIntro = false;
      taskCounter = 0;
      currentSection = { title: rawTitle, tasks: [] };
      sections.push(currentSection);
      continue;
    }

    const checkboxMatch = CHECKBOX_RE.exec(line);
    if (checkboxMatch) {
      inIntro = false;
      const indent = checkboxMatch[1]!;
      const mark = checkboxMatch[2]!;
      const text = checkboxMatch[3]!.trim();
      const depth = Math.floor(indent.length / 2);

      if (!currentSection) {
        currentSection = { title: '', tasks: [] };
        sections.push(currentSection);
      }

      if (depth === 0) taskCounter++;

      // Extract a leading task ID like "1.1" or "1.1.2" if present.
      // Fall back to the section-local counter; ensure it's at least 1 so an
      // indented or unnumbered first task in a section never gets `id = "0"`.
      const idMatch = /^(\d+(?:\.\d+)*)\s+(.+)$/.exec(text);
      const id = idMatch ? idMatch[1]! : String(Math.max(taskCounter, 1));
      const title = idMatch ? idMatch[2]! : text;

      const fileMatch = FILE_PATH_RE.exec(title);
      const filePath = fileMatch ? fileMatch[1] : undefined;

      currentSection.tasks.push({ id, title, done: mark === 'x' || mark === 'X', depth, filePath, lineIndex: lineIdx });
      continue;
    }

    if (inIntro && line.trim() !== '') {
      intro += (intro ? '\n' : '') + line;
    }
  }

  return { intro, sections };
}
