import { ChevronDown, MessageSquare, Terminal } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '../../components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { HarnessIcon } from '../agents/lib/harness-icons';
import { dockNewMenuPinnedAtom } from '../../lib/atoms';
import { usePanelActions } from './use-panel-actions';
import { NEW_MENU_REGISTRY, type NewMenuEntryKind } from './new-menu-registry';

/** Maps entry kind → icon element */
function EntryIcon({ kind }: { kind: NewMenuEntryKind }) {
  switch (kind) {
    case 'chat':
      return <MessageSquare className="h-4 w-4" />;
    case 'chat-claude-cli':
      return <HarnessIcon harness="claude-cli" size={16} />;
    case 'chat-codex-cli':
      return <HarnessIcon harness="codex-cli" size={16} />;
    case 'terminal':
      return <Terminal className="h-4 w-4" />;
    case 'openspec-change':
      return <MessageSquare className="h-4 w-4" />;
  }
}

/**
 * DockNewMenuToolbar — renders pinned new-menu entries as toolbar icons
 * and non-pinned entries in an overflow chevron dropdown.
 *
 * Reads `dockNewMenuPinnedAtom` for the pinned set; defaults come from
 * each entry's `defaultPinned` flag in `NEW_MENU_REGISTRY`.
 */
export function DockNewMenuToolbar() {
  const pinned = useAtomValue(dockNewMenuPinnedAtom);
  const actions = usePanelActions();

  function handleEntry(kind: NewMenuEntryKind) {
    switch (kind) {
      case 'chat':
        actions.newSubChat();
        break;
      case 'chat-claude-cli':
        actions.newSubChatWithHarness('claude-cli');
        break;
      case 'chat-codex-cli':
        actions.newSubChatWithHarness('codex-cli');
        break;
      case 'terminal':
        actions.openTerminal();
        break;
      case 'openspec-change':
        // Opening an OpenSpec change requires the full change-creation wizard;
        // that flow is driven from the OpenSpec sidebar. For now this entry is
        // registered in the registry so it can be pinned/unpinned but its
        // onClick is a no-op here — the sidebar's "New change" CTA is the entry
        // point until a dedicated toolbar action is wired in a follow-up.
        break;
    }
  }

  const pinnedEntries = NEW_MENU_REGISTRY.filter((e) => pinned.includes(e.kind));
  const overflowEntries = NEW_MENU_REGISTRY.filter((e) => !pinned.includes(e.kind));

  return (
    <div className="flex items-center gap-0.5" data-testid="dock-new-menu-toolbar">
      {pinnedEntries.map((entry) => (
        <Tooltip key={entry.kind}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={entry.label}
              data-testid={`dock-new-menu-pinned-${entry.kind}`}
              disabled={!actions.available}
              onClick={() => handleEntry(entry.kind)}
              className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none">
              <EntryIcon kind={entry.kind} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{entry.label}</TooltipContent>
        </Tooltip>
      ))}

      {overflowEntries.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More new panel options"
                  data-testid="dock-new-menu-overflow-trigger"
                  className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            {overflowEntries.map((entry) => (
              <DropdownMenuItem
                key={entry.kind}
                data-testid={`dock-new-menu-overflow-${entry.kind}`}
                onClick={() => handleEntry(entry.kind)}>
                <span className="mr-2 flex-shrink-0">
                  <EntryIcon kind={entry.kind} />
                </span>
                {entry.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
