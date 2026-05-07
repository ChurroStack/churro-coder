import { useAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { preferredEditorAtom } from '../lib/atoms';
import { trpc } from '../lib/trpc';
import { getAppOption, OpenInMenuItems } from './open-in-menu-items';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu';

export interface OpenInButtonProps {
  path: string | undefined;
  label?: string;
}

export function OpenInButton({ path, label }: OpenInButtonProps) {
  const [lastUsedApp] = useAtom(preferredEditorAtom);
  const openInAppMutation = trpc.external.openInApp.useMutation();
  const copyPathMutation = trpc.external.copyPath.useMutation();

  const currentApp = getAppOption(lastUsedApp);

  const handleCopyPath = useCallback(() => {
    if (!path) return;
    copyPathMutation.mutate(path);
  }, [path, copyPathMutation]);

  const handleOpenLastUsed = useCallback(() => {
    if (!path) return;
    openInAppMutation.mutate({ path, app: lastUsedApp });
  }, [path, lastUsedApp, openInAppMutation]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!path) return;
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        copyPathMutation.mutate(path);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [path, copyPathMutation]);

  return (
    <div className="inline-flex -space-x-px rounded-md">
      {label && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-r-none gap-1.5 focus:z-10"
          onClick={handleOpenLastUsed}
          disabled={!path}>
          <img src={currentApp.icon} alt="" className="size-4 object-contain" />
          <span className="font-medium truncate max-w-[120px]">{label}</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={label ? 'rounded-l-none focus:z-10 gap-1' : 'gap-1 focus:z-10'}
            disabled={!path}>
            <span>Open</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <OpenInMenuItems path={path} />
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyPath} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Copy className="size-4" />
              <span>Copy path</span>
            </div>
            <span className="text-xs text-muted-foreground">⇧⌘C</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { getAppOption } from './open-in-menu-items';
