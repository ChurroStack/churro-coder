import { useCallback, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { trpc } from '../../../lib/trpc';
import { selectedAgentChatIdAtom, selectedDraftIdAtom, showNewChatFormAtom, type SelectedProject } from '../atoms';
import { selectedProjectAtom, desktopViewAtom } from '../../../lib/atoms';
import { pendingProjectSettingsPanelAtom } from '../../dock/atoms';

type LocalWorkspaceProject = NonNullable<SelectedProject>;

/**
 * Opens a project's **Local workspace** — a project-level singleton whose
 * working tree is the base repo (`worktreePath === project.path`). Find-or-create
 * among non-archived chats, then select it and seed the Project Settings panel.
 *
 * The Local workspace opens with **only** the Project Settings panel and 0 chat
 * tabs: `chats.create` still makes its mandatory sub-chat, but we never add it to
 * `openSubChatIds`, so no chat panel renders (the "≥1 subChat" invariant is
 * untouched — see the phantom-subchat note in the plan). A single-flight ref
 * keyed by project id stops rapid double-clicks from creating two Local chats.
 */
export function useOpenLocalWorkspace() {
  const utils = trpc.useUtils();
  const createChat = trpc.chats.create.useMutation();
  const setSelectedProject = useSetAtom(selectedProjectAtom);
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom);
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom);
  const setDesktopView = useSetAtom(desktopViewAtom);
  const setPendingPS = useSetAtom(pendingProjectSettingsPanelAtom);
  const inFlightRef = useRef<string | null>(null);

  return useCallback(
    async (project: LocalWorkspaceProject) => {
      if (inFlightRef.current === project.id) return;
      inFlightRef.current = project.id;
      try {
        setSelectedProject(project);
        setSelectedDraftId(null);
        setShowNewChatForm(false);
        setDesktopView(null);

        // "One Local per project" holds among non-archived chats only (the list
        // is already archived-filtered server-side). An archived Local + click
        // intentionally makes a fresh active one.
        const list = await utils.chats.list.fetch({ projectId: project.id });
        const existing = Array.isArray(list)
          ? list.find((c) => c.projectId === project.id && c.worktreePath === project.path)
          : undefined;

        let chatId: string;
        if (existing) {
          chatId = existing.id;
        } else {
          const created = await createChat.mutateAsync({
            projectId: project.id,
            name: 'Local workspace',
            useWorktree: false,
            mode: 'execute'
          });
          chatId = created.id;
          await utils.chats.list.invalidate();
        }

        setSelectedChatId(chatId);
        setPendingPS({ chatId, projectId: project.id, path: project.path, projectName: project.name });
      } catch (err) {
        console.error('[open-local-workspace] failed:', err);
        toast.error('Failed to open local workspace');
      } finally {
        inFlightRef.current = null;
      }
    },
    [
      utils,
      createChat,
      setSelectedProject,
      setSelectedChatId,
      setSelectedDraftId,
      setShowNewChatForm,
      setDesktopView,
      setPendingPS
    ]
  );
}
