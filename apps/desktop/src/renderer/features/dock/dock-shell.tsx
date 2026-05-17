import { DockviewReact, type DockviewReadyEvent, type DockviewApi, type DockviewTheme } from 'dockview-react';
import { useCallback, useMemo, useState } from 'react';
import { useSetAtom } from 'jotai';
import { useTheme } from 'next-themes';
import { dockviewComponents } from './panel-registry';
import { dockReadyAtom, widgetPanelMapAtom } from './atoms';
import { DockHeaderActions } from './dock-header-actions';
import { DockHeaderLeftActions } from './dock-header-left-actions';
import { RenamableTab } from './renamable-tab';
import { terminalsAtom, activeTerminalIdAtom } from '../terminal/atoms';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';
import { forgetMcpInjected } from '../agents/hooks/use-harness-send-dispatcher';
import { trpc } from '../../lib/trpc';

export interface DockShellProps {
  onApiReady?: (api: DockviewApi) => void;
  className?: string;
}

/**
 * Mounts DockviewReact and exposes its api via onApiReady.
 * The outer AppShell wires this api into DockProvider context.
 */
export function DockShell({ onApiReady, className }: DockShellProps) {
  const [, setApi] = useState<DockviewApi | null>(null);
  const setReady = useSetAtom(dockReadyAtom);
  const setMap = useSetAtom(widgetPanelMapAtom);
  const setTerminals = useSetAtom(terminalsAtom);
  const setActiveTerminalIds = useSetAtom(activeTerminalIdAtom);
  const killTerminal = trpc.terminal.kill.useMutation();

  // Custom DockviewTheme objects so the dockview root carries OUR class name,
  // not vendor's `dockview-theme-light/-dark`. This is per dockview's documented
  // theming API (https://dockview.dev/docs/core/theming/) and is the only way
  // to make our --dv-* token overrides stick: dockview-react/-core/dockview
  // each ship their own CSS bundle and inject it at runtime via style-inject,
  // and dockview-core re-applies the theme className to its own .dv-dockview
  // root. With vendor's class names that meant vendor's `.dockview-theme-light
  // { --dv-border-radius: 0px; ... }` rule re-set every token to its default
  // on the inner .dv-dockview, shadowing any value we cascaded from <html>.
  // By owning the class name (`cs-theme-light/-dark`) we sidestep the
  // specificity war entirely — vendor has no rule for our class.
  const { resolvedTheme } = useTheme();
  const dockviewTheme = useMemo<DockviewTheme>(
    () =>
      resolvedTheme === 'dark'
        ? { name: 'cs-dark', className: 'cs-theme-dark' }
        : { name: 'cs-light', className: 'cs-theme-light' },
    [resolvedTheme]
  );

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      setApi(event.api);
      setReady(true);
      onApiReady?.(event.api);

      // When a panel is removed for any reason, clear it from the widget mutex map
      // so the matching summary widget reappears in the Details rail.
      const sub = event.api.onDidRemovePanel((panel) => {
        setMap((m) => {
          let changed = false;
          const next = { ...m };
          for (const key of Object.keys(next)) {
            if (next[key] === panel.id) {
              next[key] = null;
              changed = true;
            }
          }
          return changed ? next : m;
        });

        // Dockview fires onDidRemovePanel for BOTH drag-and-drop (reposition) and
        // actual tab close. For drag, it immediately fires onDidAddPanel for the
        // same panel id in the same synchronous tick, so the panel is back in
        // dockApi.panels by the time queueMicrotask fires. Checking getPanel
        // after yielding lets us skip cleanup for drag and only apply it for
        // a true close.
        const removedPanelId = panel.id;
        const dockApi = event.api;

        // Terminal cleanup — when a `terminal:` panel goes away, drop it
        // from the per-chat list and SIGKILL the PTY so a closed panel
        // doesn't leave orphaned shells running. The TerminalPanel reads
        // `paneId` + `chatId` from its params, which we round-trip through
        // dockview's params on the panel object.
        if (removedPanelId.startsWith('terminal:')) {
          const params = (panel.params ?? {}) as {
            paneId?: string;
            chatId?: string;
          };
          const { paneId, chatId } = params;
          if (paneId && chatId) {
            const capturedSetTerminals = setTerminals;
            const capturedSetActiveTerminalIds = setActiveTerminalIds;
            queueMicrotask(() => {
              if (dockApi.getPanel(removedPanelId)) return; // dragged, not closed
              killTerminal.mutate({ paneId });
              capturedSetTerminals((prev) => {
                const list = prev[chatId] ?? [];
                const next = list.filter((t) => t.paneId !== paneId);
                if (next.length === list.length) return prev;
                return { ...prev, [chatId]: next };
              });
              capturedSetActiveTerminalIds((prev) => {
                const list = prev[chatId];
                if (!list) return prev;
                // If the closed terminal was active, leave selection to the
                // panel which becomes active next (TerminalPanel.onDidActiveChange
                // handles it). Otherwise leave as-is.
                return prev;
              });
            });
          }
        }

        // Chat cleanup — when a `chat:` panel is closed via dockview's tab
        // X, mirror that into the sub-chat store so the rail / `openSubChatIds`
        // forget about it. The store's `removeFromOpenSubChats` handles the
        // active-fallback logic.
        if (removedPanelId.startsWith('chat:')) {
          const subChatId = removedPanelId.slice('chat:'.length);
          if (subChatId) {
            queueMicrotask(() => {
              if (dockApi.getPanel(removedPanelId)) return; // dragged, not closed
              useAgentSubChatStore.getState().removeFromOpenSubChats(subChatId);
            });
          }
        }

        if (removedPanelId.startsWith('openspec-change:')) {
          const params = (panel.params ?? {}) as {
            subChatId?: string;
          };
          if (params.subChatId) {
            const scId = params.subChatId;
            queueMicrotask(() => {
              if (dockApi.getPanel(removedPanelId)) return; // dragged, not closed
              useAgentSubChatStore.getState().removeFromOpenSubChats(scId);
            });
          }
        }

        // CLI harness cleanup — when a `cli:` panel is closed, kill the PTY.
        // The churro-coder MCP entry in ~/.claude.json is shared across all
        // CLI subchats (single registration), so we don't touch it here —
        // the next launch will rewrite it with the current url+bearer.
        if (removedPanelId.startsWith('cli:')) {
          const subChatId = removedPanelId.slice('cli:'.length);
          if (subChatId) {
            const capturedKillTerminal = killTerminal;
            queueMicrotask(() => {
              if (dockApi.getPanel(removedPanelId)) return; // dragged, not closed
              capturedKillTerminal.mutate({ paneId: removedPanelId });
              forgetMcpInjected(subChatId);
              useAgentSubChatStore.getState().removeFromOpenSubChats(subChatId);
            });
          }
        }
      });

      // We don't expose a teardown here because dockview itself owns the lifecycle.
      // The subscription lives as long as the api does.
      void sub;
    },
    [onApiReady, setReady, setMap, setTerminals, setActiveTerminalIds, killTerminal]
  );

  return (
    <DockviewReact
      className={className}
      components={dockviewComponents}
      defaultTabComponent={RenamableTab}
      onReady={handleReady}
      prefixHeaderActionsComponent={DockHeaderLeftActions}
      rightHeaderActionsComponent={DockHeaderActions}
      theme={dockviewTheme}
    />
  );
}
