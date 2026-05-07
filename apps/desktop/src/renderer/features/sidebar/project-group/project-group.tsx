import { useAtomValue, useSetAtom } from 'jotai';
import { Collapsible, CollapsibleContent } from '../../../components/ui/collapsible';
import { cn } from '../../../lib/utils';
import { collapsedProjectsAtom } from '../grouping/collapsed-projects-atom';
import type { GroupedProject } from '../grouping/use-grouped-agent-chats';
import { ProjectGroupActionsMenu } from './project-group-actions-menu';
import { ProjectGroupHeader } from './project-group-header';

export function ProjectGroup({
  group,
  forceExpand,
  isSearching,
  children
}: {
  group: GroupedProject;
  forceExpand: boolean;
  isSearching: boolean;
  children: React.ReactNode;
}) {
  const collapsedProjects = useAtomValue(collapsedProjectsAtom);
  const setCollapsedProjects = useSetAtom(collapsedProjectsAtom);
  const collapsed = collapsedProjects[group.id] ?? false;
  const isOpen = forceExpand || !collapsed;

  function handleToggle() {
    setCollapsedProjects((prev) => ({
      ...prev,
      [group.id]: !collapsed
    }));
  }

  return (
    <Collapsible open={isOpen} className="mb-3">
      <ProjectGroupHeader
        group={group}
        isOpen={isOpen}
        count={group.chats.length}
        onToggle={handleToggle}
        menu={
          group.kind === 'local' && group.project ? (
            <ProjectGroupActionsMenu project={group.project} chatIds={group.chats.map((chat) => chat.id)} />
          ) : undefined
        }
      />
      <CollapsibleContent className="pt-1">
        {group.chats.length > 0 ? (
          children
        ) : !isSearching ? (
          <div className={cn('px-3 py-2 text-xs italic text-muted-foreground')}>No workspaces</div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
