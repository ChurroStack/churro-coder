import type { SelectedProject } from './atoms';

export type AutoSelectProjectRow = NonNullable<SelectedProject>;

export type PickProjectInput = {
  validatedProject: SelectedProject;
  paramProjectId: string | null;
  chatProjectId: string | null | undefined;
  projects: AutoSelectProjectRow[] | undefined;
  selectedChatId: string | null;
};

export type PickProjectOutput =
  | { kind: 'keep' }
  | { kind: 'wait' }
  | { kind: 'show-empty' }
  | {
      kind: 'select';
      project: AutoSelectProjectRow;
      source: 'window-param' | 'chat-lookup' | 'most-recent';
    };

export function pickProject(input: PickProjectInput): PickProjectOutput {
  if (input.validatedProject) return { kind: 'keep' };
  if (input.projects === undefined) return { kind: 'wait' };
  // Defensive: a corrupted react-query cache can hand us a non-array value
  // (e.g. `{}` from a malformed persisted blob). Treat that the same as empty
  // — Sentry #118566392 was `input.projects.find is not a function`.
  if (!Array.isArray(input.projects) || input.projects.length === 0) return { kind: 'show-empty' };

  const fromParam = input.paramProjectId ? input.projects.find((project) => project.id === input.paramProjectId) : null;
  if (fromParam) {
    return { kind: 'select', project: fromParam, source: 'window-param' };
  }

  if (input.selectedChatId && input.chatProjectId === undefined) {
    return { kind: 'wait' };
  }

  const fromChat = input.chatProjectId ? input.projects.find((project) => project.id === input.chatProjectId) : null;
  if (fromChat) {
    return { kind: 'select', project: fromChat, source: 'chat-lookup' };
  }

  // Defensive: `projects.length > 0` does not guarantee `projects[0]` is defined
  // (sparse arrays, cache corruption — see #85's non-array oldData guard).
  const mostRecent = input.projects.find((project): project is AutoSelectProjectRow => project != null);
  if (!mostRecent) return { kind: 'show-empty' };

  return {
    kind: 'select',
    project: mostRecent,
    source: 'most-recent'
  };
}
