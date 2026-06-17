import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { Info } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { AgentsSkillsTab } from '../../components/dialogs/settings-tabs/agents-skills-tab';
import { AgentsCustomAgentsTab } from '../../components/dialogs/settings-tabs/agents-custom-agents-tab';
import { AgentsMcpTab } from '../../components/dialogs/settings-tabs/agents-mcp-tab';
import { WorktreeConfigSection } from '../../components/dialogs/settings-tabs/worktree-config-section';
import { EnvironmentVariablesSection } from '../../components/dialogs/settings-tabs/environment-variables-section';
import type { SettingsScopeMode } from '../../components/dialogs/settings-tabs/settings-scope-mode';
import { workspaceProjectSettingsSectionAtomFamily, type ProjectSettingsSection } from '../dock/atoms';

const SECTIONS: { id: ProjectSettingsSection; label: string }[] = [
  { id: 'worktree', label: 'Worktree' },
  { id: 'env', label: 'Environment' },
  { id: 'skills', label: 'Skills' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP' }
];

/**
 * Per-workspace Project Settings, scoped to `path` (the workspace's own working
 * tree). Hosted in a dockview `project-settings` panel.
 *
 * Path scoping per section:
 * - Worktree config / Skills / Agents → the worktree `path` (committable with
 *   the branch).
 * - MCP → the **base-repo** path. Claude keys project MCP servers per-project in
 *   `~/.claude.json` (worktree paths resolve back to the base repo), so MCP is
 *   shared across the repo's worktrees and is NOT committed with the branch — a
 *   caveat surfaced inline below the MCP section.
 */
export function WorkspaceProjectSettings({
  workspaceId,
  projectId,
  path,
  projectName
}: {
  workspaceId: string;
  projectId: string;
  path: string;
  projectName?: string;
}) {
  // Section lives in a per-workspace atom (keyed by workspaceId) so the
  // details-sidebar Scripts/MCP gears can deep-link to a section even when this
  // panel is already open.
  const sectionAtom = useMemo(() => workspaceProjectSettingsSectionAtomFamily(workspaceId), [workspaceId]);
  const [section, setSection] = useAtom(sectionAtom);

  // Base-repo path for MCP scoping (and the display name fallback).
  const { data: project } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });
  const basePath = project?.path ?? path;
  const name = projectName ?? project?.name;

  const worktreeMode = useMemo<SettingsScopeMode>(() => ({ kind: 'project', path, projectName: name }), [path, name]);
  const mcpMode = useMemo<SettingsScopeMode>(
    () => ({ kind: 'project', path: basePath, projectName: name }),
    [basePath, name]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header + section nav */}
      <div className="flex-shrink-0 border-b border-border px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{name ?? 'Project Settings'}</h3>
          <span className="text-xs text-muted-foreground truncate" title={path}>
            {path}
          </span>
        </div>
        <div
          className="mt-2 flex items-center gap-1"
          role="tablist"
          aria-label="Project settings sections"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer',
                section === s.id
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
              )}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'worktree' && <WorktreeConfigSection projectId={projectId} path={path} />}
        {section === 'env' && <EnvironmentVariablesSection projectId={projectId} />}
        {section === 'skills' && <AgentsSkillsTab mode={worktreeMode} />}
        {section === 'agents' && <AgentsCustomAgentsTab mode={worktreeMode} />}
        {section === 'mcp' && (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2 text-xs text-muted-foreground bg-muted/40 border-b border-border">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                MCP servers are stored in your user config (<code className="font-mono">~/.claude.json</code>) and
                shared across this repo&apos;s worktrees — they are not committed with the branch.
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {/* Wait for the project record so MCP scopes to the base-repo path,
                  not the worktree-path fallback (which would show an empty list
                  and hide a just-added server until the query resolved). */}
              {project ? (
                <AgentsMcpTab mode={mcpMode} />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
