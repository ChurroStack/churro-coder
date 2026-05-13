// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { FileListItem } from './file-list-item';

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: PropsWithChildren<{ asChild?: boolean }>) => <div>{children}</div>,
  ContextMenuContent: ({ children }: PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  ContextMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void; className?: string }>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr />
}));

function setPlatform(platform: 'darwin' | 'win32') {
  (window as any).desktopApi = { platform };
}

function renderFileListItem(onRevealInFinder = vi.fn()) {
  render(
    <FileListItem
      filePath="src/index.ts"
      fileName="index.ts"
      dirPath="src"
      status="modified"
      isChecked={false}
      isViewed={false}
      isUntracked={false}
      onSelect={() => {}}
      onCheckboxChange={() => {}}
      onRevealInFinder={onRevealInFinder}
    />
  );

  return { onRevealInFinder };
}

describe('FileListItem', () => {
  beforeEach(() => {
    setPlatform('darwin');
  });

  it('shows "Reveal in Finder" on macOS', () => {
    renderFileListItem();

    expect(screen.getByRole('button', { name: 'Reveal in Finder' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Reveal in File Explorer' })).toBeNull();
  });

  it('shows "Reveal in File Explorer" on Windows and calls the handler', () => {
    setPlatform('win32');
    const { onRevealInFinder } = renderFileListItem();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal in File Explorer' }));

    expect(onRevealInFinder).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Reveal in Finder' })).toBeNull();
  });
});
