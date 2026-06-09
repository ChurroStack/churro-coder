import { useEffect, useMemo, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useSetAtom } from 'jotai';
import { useDockWorkspace } from '../workspace-context';
import { workspaceProjectSettingsOpenAtomFamily, type ProjectSettingsPanelEntity } from '../atoms';
import { WorkspaceProjectSettings } from '../../settings/workspace-project-settings';

/**
 * ProjectSettingsPanel — dockview tab hosting the per-workspace Project Settings
 * view. Scoped to `params.path` (the workspace's own working tree) so edits land
 * in that tree and commit with the branch.
 *
 * Self-registers `psOpen=true` into `workspaceProjectSettingsOpenAtomFamily` on
 * mount so `ChatPanelSync` can treat this panel as an anchor (the `main`
 * placeholder exists iff a workspace has zero open chats AND no PS panel). The
 * atom is keyed by `params.chatId` (the workspace id), so there is no
 * cross-workspace contamination — unlike the single shared `openSubChatIds`
 * store, no active-workspace gate is required here. The matching `false` is set
 * by `dock-shell.tsx`'s `onDidRemovePanel` on real close (drag-guarded), mirroring
 * how chat panels are removed from `openSubChatIds`.
 */
export function ProjectSettingsPanel({ params, api }: IDockviewPanelProps<ProjectSettingsPanelEntity>) {
  const { active: isWorkspaceActive } = useDockWorkspace();
  const [isVisible, setIsVisible] = useState(api.isVisible);
  const [isActive, setIsActive] = useState(api.isActive);
  const psOpenAtom = useMemo(() => workspaceProjectSettingsOpenAtomFamily(params.chatId), [params.chatId]);
  const setPsOpen = useSetAtom(psOpenAtom);

  useEffect(() => {
    setPsOpen(true);
  }, [setPsOpen]);

  // Mount the heavy settings view only when this tab is visible/active so a
  // restored-but-background panel doesn't fire its trpc queries on cold start.
  useEffect(() => {
    const sync = () => {
      setIsVisible(api.isVisible);
      setIsActive(api.isActive);
    };
    sync();
    const subVisibility = api.onDidVisibilityChange((e) => setIsVisible(e.isVisible));
    const subActive = api.onDidActiveChange((e) => setIsActive(e.isActive));
    return () => {
      subVisibility.dispose();
      subActive.dispose();
    };
  }, [api]);

  const shouldMount = isVisible || isActive || isWorkspaceActive;
  if (!shouldMount) return null;

  return (
    <div className="h-full w-full overflow-hidden bg-background border-t border-border">
      <WorkspaceProjectSettings
        workspaceId={params.chatId}
        projectId={params.projectId}
        path={params.path}
        projectName={params.projectName}
      />
    </div>
  );
}
