import { describe, it, expect } from 'vitest';
import { parseTasksOutline } from './tasks-outline';

const SAMPLE_TASKS = `
## 1. Backend Changes

- [ ] 1.1 Add openspec_change_id column to sub_chats schema apps/desktop/src/main/lib/db/schema/index.ts
- [x] 1.2 Add Drizzle migration SQL apps/desktop/drizzle/0015_subchats_openspec.sql
- [x] 1.3 Update _journal.json timestamp

## 2. Frontend Components

- [x] 2.1 Create openspec-change-panel.tsx
- [ ] 2.2 Create openspec-change-view.tsx
- [ ] 2.3 Create openspec-tasks-view.tsx src/renderer/features/openspec/openspec-tasks-view.tsx

## 3. Wiring

- [x] 3.1 Register panel in panel-registry.tsx
- [x] 3.2 Wire handleSelectSpec in new-chat-form.tsx
`.trim();

describe('parseTasksOutline', () => {
  it('returns three sections', () => {
    const result = parseTasksOutline(SAMPLE_TASKS);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0]!.title).toBe('1. Backend Changes');
    expect(result.sections[1]!.title).toBe('2. Frontend Components');
    expect(result.sections[2]!.title).toBe('3. Wiring');
  });

  it('parses done/undone state correctly', () => {
    const result = parseTasksOutline(SAMPLE_TASKS);
    const backend = result.sections[0]!.tasks;
    expect(backend[0]!.done).toBe(false);
    expect(backend[1]!.done).toBe(true);
    expect(backend[2]!.done).toBe(true);
  });

  it('counts total and done correctly', () => {
    const result = parseTasksOutline(SAMPLE_TASKS);
    const allTasks = result.sections.flatMap((s) => s.tasks);
    const done = allTasks.filter((t) => t.done).length;
    expect(allTasks.length).toBe(8);
    expect(done).toBe(5);
  });

  it('parses task IDs', () => {
    const result = parseTasksOutline(SAMPLE_TASKS);
    expect(result.sections[0]!.tasks[0]!.id).toBe('1.1');
    expect(result.sections[1]!.tasks[0]!.id).toBe('2.1');
  });

  it('captures file paths from task titles', () => {
    const result = parseTasksOutline(SAMPLE_TASKS);
    const task = result.sections[0]!.tasks[0]!;
    expect(task.filePath).toBeDefined();
    expect(task.filePath).toMatch(/\.ts$/);
  });

  it('handles empty input', () => {
    const result = parseTasksOutline('');
    expect(result.sections).toHaveLength(0);
    expect(result.intro).toBe('');
  });

  it('handles file with no sections (bare checkbox list)', () => {
    const raw = '- [x] Task one\n- [ ] Task two\n';
    const result = parseTasksOutline(raw);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.tasks).toHaveLength(2);
  });

  it('skips H1 as document title', () => {
    const raw = '# Tasks\n\n## 1. Section\n\n- [ ] 1.1 Do thing\n';
    const result = parseTasksOutline(raw);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.title).toBe('1. Section');
  });

  it('falls back to id="1" (not "0") when first task is indented and has no leading id', () => {
    // Section starts with an indented bullet, no explicit "1.1" prefix.
    const raw = '## 1. Section\n\n  - [ ] Nested first task with no id\n';
    const result = parseTasksOutline(raw);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.tasks).toHaveLength(1);
    expect(result.sections[0]!.tasks[0]!.id).toBe('1');
  });
});
