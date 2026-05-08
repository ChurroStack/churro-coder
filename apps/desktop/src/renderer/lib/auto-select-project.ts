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
  if (!input.projects) return { kind: 'wait' };
  if (input.projects.length === 0) return { kind: 'show-empty' };

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

  return {
    kind: 'select',
    project: input.projects[0]!,
    source: 'most-recent'
  };
}
