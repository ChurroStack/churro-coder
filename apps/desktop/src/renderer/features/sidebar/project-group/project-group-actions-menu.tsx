import { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { BarChart3, Plus, Settings } from 'lucide-react';
import { ConfirmDeleteDialog } from '../../../components/confirm-delete-dialog';
import { OpenInMenuItems, getAppOption } from '../../../components/open-in-menu-items';
import { ProjectGroupMenuButton } from './project-group-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu';
import {
  selectedProjectAtom,
  selectedAgentChatIdAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSidebarOpenAtom,
  preferredEditorAtom,
  desktopViewAtom,
  projectStatsTargetIdAtom
} from '../../../lib/atoms';
import { getFileManagerUiMeta } from '../../../lib/utils/file-manager';
import { newWorkspaceFormKeyAtom, selectedDraftIdAtom, showNewChatFormAtom } from '../../agents/atoms';
import { trpc } from '../../../lib/trpc';
import type { ProjectRecord } from '../grouping/group-chats-by-project';

export function ProjectGroupActionsMenu({ project, chatIds }: { project: ProjectRecord; chatIds: string[] }) {
  const fileManager = getFileManagerUiMeta();
  const utils = trpc.useUtils();
  const [preferredEditor] = useAtom(preferredEditorAtom);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const setSelectedProject = useSetAtom(selectedProjectAtom);
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom);
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom);
  const bumpNewWorkspaceFormKey = useSetAtom(newWorkspaceFormKeyAtom);
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom);
  const setDesktopView = useSetAtom(desktopViewAtom);
  const setSidebarOpen = useSetAtom(agentsSidebarOpenAtom);
  const setProjectStatsTargetId = useSetAtom(projectStatsTargetIdAtom);
  const openInAppMutation = trpc.external.openInApp.useMutation();
  const openInFinderMutation = trpc.external.openInFinder.useMutation();
  const archiveBatchMutation = trpc.chats.archiveBatch.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate();
      setArchiveDialogOpen(false);
    }
  });
  const deleteProjectMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      utils.chats.list.invalidate();
      setRemoveDialogOpen(false);
    }
  });
  const preferredApp = getAppOption(preferredEditor);
  const removeDisabled = chatIds.length > 0;
  const archiveDisabled = chatIds.length === 0;

  function selectThisProject() {
    setSelectedProject({
      id: project.id,
      name: project.name ?? project.gitRepo ?? 'Untitled project',
      path: project.path,
      gitRemoteUrl: project.gitRemoteUrl ?? null,
      gitProvider: (project.gitProvider as 'github' | 'gitlab' | 'bitbucket' | null | undefined) ?? null,
      gitOwner: project.gitOwner ?? null,
      gitRepo: project.gitRepo ?? null
    });
  }

  function openProjectSettings() {
    selectThisProject();
    setSettingsTab('projects');
    setDesktopView('settings');
    setSidebarOpen(true);
  }

  function openProjectStats() {
    selectThisProject();
    setProjectStatsTargetId(project.id);
    setDesktopView('project-stats');
    setSidebarOpen(true);
  }

  function openNewWorkspace() {
    selectThisProject();
    setSelectedChatId(null);
    setSelectedDraftId(null);
    setShowNewChatForm(true);
    setDesktopView(null);
    bumpNewWorkspaceFormKey((key) => key + 1);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ProjectGroupMenuButton onClick={(e) => e.stopPropagation()} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => openInAppMutation.mutate({ path: project.path, app: preferredApp.id })}>
            Open in {preferredApp.displayLabel ?? preferredApp.label}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Open in…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <OpenInMenuItems path={project.path} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => openInFinderMutation.mutate(project.path)}>
            {fileManager.revealLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openNewWorkspace} className="flex items-center gap-2">
            <Plus className="size-4" />
            <span>New workspace</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openProjectStats} className="flex items-center gap-2">
            <BarChart3 className="size-4" />
            <span>Project statistics</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openProjectSettings} className="flex items-center gap-2">
            <Settings className="size-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={archiveDisabled} onClick={() => setArchiveDialogOpen(true)}>
            Archive workspaces
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={removeDisabled}
            onClick={() => setRemoveDialogOpen(true)}
            className="flex items-center justify-between gap-2 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400">
            Remove repository
            {removeDisabled && <span className="text-xs text-muted-foreground">Archive workspaces first</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDeleteDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        title={`Archive ${chatIds.length} workspace${chatIds.length === 1 ? '' : 's'} in ${project.name ?? 'project'}?`}
        description="The workspaces will be hidden from the sidebar and any running terminals will be stopped. The worktree directories on disk are preserved."
        confirmLabel={chatIds.length === 1 ? 'Archive workspace' : `Archive ${chatIds.length} workspaces`}
        onConfirm={() => archiveBatchMutation.mutate({ chatIds })}
        isDeleting={archiveBatchMutation.isPending}
      />
      <ConfirmDeleteDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={`Remove ${project.name ?? 'repository'} from list?`}
        description={
          <>
            The project entry will be removed from Churro Coder. The folder on disk at <code>{project.path}</code> stays
            intact.
          </>
        }
        confirmLabel="Remove repository"
        onConfirm={() => deleteProjectMutation.mutate({ id: project.id })}
        isDeleting={deleteProjectMutation.isPending}
      />
    </>
  );
}
