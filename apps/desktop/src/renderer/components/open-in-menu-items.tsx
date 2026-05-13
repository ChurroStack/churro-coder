import type { ExternalApp } from '../../shared/external-apps';
import { useAtom } from 'jotai';
import { useCallback } from 'react';
import { preferredEditorAtom } from '../lib/atoms';
import { getFileManagerUiMeta } from '../lib/utils/file-manager';
import { trpc } from '../lib/trpc';
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from './ui/dropdown-menu';

import cursorIcon from '../assets/app-icons/cursor.svg';
import zedIcon from '../assets/app-icons/zed.png';
import sublimeIcon from '../assets/app-icons/sublime.svg';
import xcodeIcon from '../assets/app-icons/xcode.svg';
import itermIcon from '../assets/app-icons/iterm.png';
import warpIcon from '../assets/app-icons/warp.png';
import terminalIcon from '../assets/app-icons/terminal.png';
import ghosttyIcon from '../assets/app-icons/ghostty.svg';
import vscodeIcon from '../assets/app-icons/vscode.svg';
import vscodeInsidersIcon from '../assets/app-icons/vscode-insiders.svg';
import jetbrainsIcon from '../assets/app-icons/jetbrains.svg';
import intellijIcon from '../assets/app-icons/intellij.svg';
import webstormIcon from '../assets/app-icons/webstorm.svg';
import pycharmIcon from '../assets/app-icons/pycharm.svg';
import phpstormIcon from '../assets/app-icons/phpstorm.svg';
import rubymineIcon from '../assets/app-icons/rubymine.svg';
import golandIcon from '../assets/app-icons/goland.svg';
import clionIcon from '../assets/app-icons/clion.svg';
import riderIcon from '../assets/app-icons/rider.svg';
import datagripIcon from '../assets/app-icons/datagrip.svg';
import appcodeIcon from '../assets/app-icons/appcode.svg';
import fleetIcon from '../assets/app-icons/fleet.svg';
import rustroverIcon from '../assets/app-icons/rustrover.svg';

export interface AppOption {
  id: ExternalApp;
  label: string;
  icon: string;
  displayLabel?: string;
}

export const APP_OPTIONS: AppOption[] = [
  { id: 'finder', label: 'File manager', icon: '' },
  { id: 'cursor', label: 'Cursor', icon: cursorIcon },
  { id: 'zed', label: 'Zed', icon: zedIcon },
  { id: 'sublime', label: 'Sublime Text', icon: sublimeIcon },
  { id: 'xcode', label: 'Xcode', icon: xcodeIcon },
  { id: 'iterm', label: 'iTerm', icon: itermIcon },
  { id: 'warp', label: 'Warp', icon: warpIcon },
  { id: 'terminal', label: 'Terminal', icon: terminalIcon },
  { id: 'ghostty', label: 'Ghostty', icon: ghosttyIcon }
];

export const VSCODE_OPTIONS: AppOption[] = [
  { id: 'vscode', label: 'Standard', icon: vscodeIcon, displayLabel: 'VS Code' },
  { id: 'vscode-insiders', label: 'Insiders', icon: vscodeInsidersIcon, displayLabel: 'VS Code Insiders' }
];

export const JETBRAINS_OPTIONS: AppOption[] = [
  { id: 'intellij', label: 'IntelliJ IDEA', icon: intellijIcon },
  { id: 'webstorm', label: 'WebStorm', icon: webstormIcon },
  { id: 'pycharm', label: 'PyCharm', icon: pycharmIcon },
  { id: 'phpstorm', label: 'PhpStorm', icon: phpstormIcon },
  { id: 'rubymine', label: 'RubyMine', icon: rubymineIcon },
  { id: 'goland', label: 'GoLand', icon: golandIcon },
  { id: 'clion', label: 'CLion', icon: clionIcon },
  { id: 'rider', label: 'Rider', icon: riderIcon },
  { id: 'datagrip', label: 'DataGrip', icon: datagripIcon },
  { id: 'appcode', label: 'AppCode', icon: appcodeIcon },
  { id: 'fleet', label: 'Fleet', icon: fleetIcon },
  { id: 'rustrover', label: 'RustRover', icon: rustroverIcon }
];

const ALL_APP_OPTIONS = [...APP_OPTIONS, ...VSCODE_OPTIONS, ...JETBRAINS_OPTIONS];

export function getAppOption(id: ExternalApp): AppOption {
  return ALL_APP_OPTIONS.find((app) => app.id === id) ?? APP_OPTIONS[1]!;
}

export function OpenInMenuItems({ path, onOpened }: { path: string | undefined; onOpened?: () => void }) {
  const [, setLastUsedApp] = useAtom(preferredEditorAtom);
  const openInAppMutation = trpc.external.openInApp.useMutation();
  const fileManager = getFileManagerUiMeta();
  const appOptions = APP_OPTIONS.map((app) =>
    app.id === 'finder' ? { ...app, label: fileManager.label, icon: fileManager.icon } : app
  );

  const handleOpenIn = useCallback(
    (app: ExternalApp) => {
      if (!path) return;
      setLastUsedApp(app);
      openInAppMutation.mutate({ path, app });
      onOpened?.();
    },
    [path, setLastUsedApp, openInAppMutation, onOpened]
  );

  return (
    <>
      {appOptions.map((app) => (
        <DropdownMenuItem key={app.id} onClick={() => handleOpenIn(app.id)} className="flex items-center gap-2">
          <img src={app.icon} alt="" className="size-4 object-contain" />
          <span>{app.label}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="flex items-center gap-2">
          <img src={vscodeIcon} alt="" className="size-4 object-contain" />
          <span>VS Code</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48" sideOffset={6} alignOffset={-4}>
          {VSCODE_OPTIONS.map((app) => (
            <DropdownMenuItem key={app.id} onClick={() => handleOpenIn(app.id)} className="flex items-center gap-2">
              <img src={app.icon} alt="" className="size-4 object-contain" />
              <span>{app.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="flex items-center gap-2">
          <img src={jetbrainsIcon} alt="" className="size-4 object-contain" />
          <span>JetBrains</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48" sideOffset={6} alignOffset={-4}>
          {JETBRAINS_OPTIONS.map((app) => (
            <DropdownMenuItem key={app.id} onClick={() => handleOpenIn(app.id)} className="flex items-center gap-2">
              <img src={app.icon} alt="" className="size-4 object-contain" />
              <span>{app.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
