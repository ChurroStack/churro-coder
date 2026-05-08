import { describe, expect, it } from 'vitest';
import { pickProject, type AutoSelectProjectRow } from './auto-select-project';

const projects: AutoSelectProjectRow[] = [
  { id: 'p1', name: 'Alpha', path: '/alpha', gitProvider: 'github', gitOwner: 'a', gitRepo: 'alpha' },
  { id: 'p2', name: 'Beta', path: '/beta', gitProvider: 'github', gitOwner: 'b', gitRepo: 'beta' }
];

describe('pickProject', () => {
  it('keeps a validated project', () => {
    expect(
      pickProject({
        validatedProject: projects[1],
        paramProjectId: null,
        chatProjectId: undefined,
        projects,
        selectedChatId: null
      })
    ).toEqual({ kind: 'keep' });
  });

  it('waits while the projects query is still loading', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: undefined,
        projects: undefined,
        selectedChatId: null
      })
    ).toEqual({ kind: 'wait' });
  });

  it('shows the empty-state only when the database is genuinely empty', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: undefined,
        projects: [],
        selectedChatId: null
      })
    ).toEqual({ kind: 'show-empty' });
  });

  it('prefers the explicit projectId window param', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: 'p2',
        chatProjectId: 'p1',
        projects,
        selectedChatId: 'chat-1'
      })
    ).toEqual({
      kind: 'select',
      project: projects[1],
      source: 'window-param'
    });
  });

  it('waits for chat lookup before falling back to the most-recent project', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: undefined,
        projects,
        selectedChatId: 'chat-1'
      })
    ).toEqual({ kind: 'wait' });
  });

  it('uses the chat lookup result when available', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: 'p2',
        projects,
        selectedChatId: 'chat-1'
      })
    ).toEqual({
      kind: 'select',
      project: projects[1],
      source: 'chat-lookup'
    });
  });

  it('selects the most-recent project when no hints are present (the original bug)', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: null,
        projects,
        selectedChatId: null
      })
    ).toEqual({
      kind: 'select',
      project: projects[0],
      source: 'most-recent'
    });
  });

  it('falls back to the most-recent project when ids are missing or stale', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: 'missing',
        chatProjectId: null,
        projects,
        selectedChatId: null
      })
    ).toEqual({
      kind: 'select',
      project: projects[0],
      source: 'most-recent'
    });
  });

  // Regression: a corrupted/sparse projects array (e.g. [undefined]) used to make
  // pickProject return { kind: 'select', project: undefined }, crashing App.tsx with
  // "Cannot read properties of undefined (reading 'id')".
  it('returns show-empty if the projects array contains only nullish entries', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: null,
        projects: [undefined as unknown as AutoSelectProjectRow],
        selectedChatId: null
      })
    ).toEqual({ kind: 'show-empty' });
  });

  it('skips nullish entries and returns the first defined project', () => {
    expect(
      pickProject({
        validatedProject: null,
        paramProjectId: null,
        chatProjectId: null,
        projects: [undefined as unknown as AutoSelectProjectRow, projects[1]!],
        selectedChatId: null
      })
    ).toEqual({
      kind: 'select',
      project: projects[1],
      source: 'most-recent'
    });
  });
});
