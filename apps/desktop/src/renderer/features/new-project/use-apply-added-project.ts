import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../main/lib/trpc/routers';
import { trpc } from '@/lib/trpc';
import { selectedProjectAtom } from '@/lib/atoms';

/**
 * Row returned by the "add a project" mutations (openFolder / cloneFromGitHub).
 * Both return the full DB row via `.returning()`, so a single shape covers them.
 */
type AddedProject = NonNullable<inferRouterOutputs<AppRouter>['projects']['openFolder']>;

/**
 * Centralizes the success path for every "a project was just added" flow
 * (welcome-screen Open/Clone, in-app project selector).
 *
 * App.tsx only renders the workspace when `selectedProject` is found in the
 * `projects.list` react-query cache (`validatedProject`). If we set the selection
 * without writing that cache, App falls back to `show-empty` → the blank
 * EmptyStateShell (the white-screen bug). So we:
 *   1. optimistically insert the project into the list cache (synchronous validation),
 *   2. invalidate (non-awaited) so any in-flight first fetch can't strand the row,
 *   3. set it as the selected project.
 */
export function useApplyAddedProject() {
  const utils = trpc.useUtils();
  const setSelectedProject = useSetAtom(selectedProjectAtom);

  return useCallback(
    (project: AddedProject) => {
      utils.projects.list.setData(undefined, (oldData) => {
        if (!Array.isArray(oldData)) return [project];
        const exists = oldData.some((p) => p.id === project.id);
        if (exists) {
          return oldData.map((p) => (p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p));
        }
        return [project, ...oldData];
      });
      // Reconcile against the server in the background; setData above already made
      // validation pass synchronously, so this can't paint a blank frame.
      void utils.projects.list.invalidate();

      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider as 'github' | 'gitlab' | 'bitbucket' | null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo
      });
    },
    [utils, setSelectedProject]
  );
}
