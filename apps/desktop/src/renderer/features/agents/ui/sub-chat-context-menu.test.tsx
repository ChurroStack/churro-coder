// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SubChatContextMenu } from './sub-chat-context-menu';

const newWindow = vi.fn();

vi.mock('../../../components/ui/context-menu', () => ({
  ContextMenuContent: ({ children }: PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled
  }: PropsWithChildren<{ onClick?: () => void; disabled?: boolean; className?: string }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuSub: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('../../../lib/utils/platform', () => ({
  isDesktopApp: () => true
}));

vi.mock('../../../lib/hotkeys', () => ({
  useResolvedHotkeyDisplay: () => null
}));

vi.mock('../../../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/utils')>();
  return {
    ...actual,
    isMac: false
  };
});

vi.mock('../lib/export-chat', () => ({
  exportChat: vi.fn(),
  copyChat: vi.fn()
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    chats: {
      openspecInit: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false }))
      }
    }
  }
}));

describe('SubChatContextMenu', () => {
  beforeEach(() => {
    newWindow.mockReset();
    (window as typeof window & { desktopApi: any }).desktopApi = {
      newWindow
    };
  });

  it('passes projectId when opening a sub-chat in a new window', async () => {
    newWindow.mockResolvedValue({ blocked: false });

    render(
      <SubChatContextMenu
        subChat={{ id: 'sub-1', name: 'Sub chat' }}
        isPinned={false}
        onTogglePin={() => {}}
        onRename={() => {}}
        onArchive={() => {}}
        onArchiveOthers={() => {}}
        isOnlyChat={false}
        chatId="chat-1"
        projectId="project-1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open in new window' }));

    expect(newWindow).toHaveBeenCalledWith({
      chatId: 'chat-1',
      subChatId: 'sub-1',
      projectId: 'project-1'
    });
  });
});
