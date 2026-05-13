import finderIcon from '../../assets/app-icons/finder.png';
import fileExplorerIcon from '../../assets/app-icons/file-explorer.svg';
import { getPlatform } from './platform';

export interface FileManagerUiMeta {
  label: string;
  openLabel: string;
  revealLabel: string;
  icon: string;
}

const FINDER_META: FileManagerUiMeta = {
  label: 'Finder',
  openLabel: 'Open in Finder',
  revealLabel: 'Reveal in Finder',
  icon: finderIcon
};

const FILE_EXPLORER_META: FileManagerUiMeta = {
  label: 'File Explorer',
  openLabel: 'Open in File Explorer',
  revealLabel: 'Reveal in File Explorer',
  icon: fileExplorerIcon
};

export function getFileManagerUiMeta(): FileManagerUiMeta {
  return getPlatform() === 'win32' ? FILE_EXPLORER_META : FINDER_META;
}
