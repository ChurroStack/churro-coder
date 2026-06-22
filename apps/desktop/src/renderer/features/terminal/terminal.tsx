// Per-subChat isolation invariant (see apps/desktop/AGENTS.md):
// one Terminal instance per paneId — xterm/sizer/serializeAddon refs MUST
// live in useRef inside this component and never be reused across panels.
// Two ChatCliSurface panels with distinct paneIds mount two independent
// xterm instances; reintroducing instance reuse would let subChat A's PTY
// bytes write into subChat B's canvas.
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { useTheme } from 'next-themes';
import { useSetAtom, useAtomValue } from 'jotai';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { terminalCwdAtom } from './atoms';
import { fullThemeDataAtom, terminalWebglEnabledAtom } from '@/lib/atoms';
import {
  createTerminalInstance,
  getDefaultTerminalBg,
  setupAutoFocus,
  setupClickToMoveCursor,
  setupContextMenuHandler,
  setupKeyboardHandler,
  setupPasteHandler,
  terminalDebug
} from './helpers';
import { createTerminalSizer, type TerminalSizer } from './terminal-sizing';
import { getTerminalTheme, getTerminalThemeFromVSCode } from './config';
import { parseCwd } from './parseCwd';
import { sanitizeForTitle } from './commandBuffer';
import { shellEscapePaths } from './utils';
import { TerminalSearch } from './TerminalSearch';
import { useFindScope } from '../find/use-find-scope';
import type { TerminalProps, TerminalStreamEvent } from './types';
import '@xterm/xterm/css/xterm.css';

export function Terminal({
  paneId,
  cwd,
  workspaceId,
  scopeKey,
  tabId,
  initialCommands,
  initialCwd,
  bootstrap,
  onExitedKeyPress,
  clearScrollbackOnColChange = false
}: TerminalProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const sizerRef = useRef<TerminalSizer | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const isExitedRef = useRef(false);
  const commandBufferRef = useRef('');

  const [searchQuery, setSearchQuery] = useState('');
  const [terminalCwd, setTerminalCwd] = useState<string | null>(initialCwd || cwd);
  const setGlobalCwds = useSetAtom(terminalCwdAtom);
  const findScope = useFindScope(scopeRef, true);

  // Theme detection
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // VS Code theme data (if a full theme is selected)
  const fullThemeData = useAtomValue(fullThemeDataAtom);

  // Renderer choice (user setting). Default false → Canvas. Included in the
  // mount effect deps so flipping it cleanly re-inits the terminal; scrollback
  // survives via the serialize/detach path.
  const webglEnabled = useAtomValue(terminalWebglEnabledAtom);

  // Ref for terminalCwd to avoid effect re-runs when cwd changes
  const terminalCwdRef = useRef(terminalCwd);
  terminalCwdRef.current = terminalCwd;

  // Ref for paneId to use in callbacks
  const paneIdRef = useRef(paneId);
  paneIdRef.current = paneId;

  // Ref for the external restart owner (CLI surfaces) so the mount effect's
  // input handler reads the latest callback without re-running.
  const onExitedKeyPressRef = useRef(onExitedKeyPress);
  onExitedKeyPressRef.current = onExitedKeyPress;

  // Mutations
  const createOrAttachMutation = trpc.terminal.createOrAttach.useMutation();
  const writeMutation = trpc.terminal.write.useMutation();
  const resizeMutation = trpc.terminal.resize.useMutation();
  const detachMutation = trpc.terminal.detach.useMutation();
  const clearScrollbackMutation = trpc.terminal.clearScrollback.useMutation();

  // Refs for mutations to avoid effect re-runs
  const createOrAttachRef = useRef(createOrAttachMutation.mutate);
  const writeRef = useRef(writeMutation.mutate);
  const resizeRef = useRef(resizeMutation.mutate);
  const detachRef = useRef(detachMutation.mutate);
  const clearScrollbackRef = useRef(clearScrollbackMutation.mutate);
  createOrAttachRef.current = createOrAttachMutation.mutate;
  writeRef.current = writeMutation.mutate;
  resizeRef.current = resizeMutation.mutate;
  detachRef.current = detachMutation.mutate;
  clearScrollbackRef.current = clearScrollbackMutation.mutate;

  // Parse terminal data for cwd (OSC 7 sequences)
  const updateCwdFromData = useCallback(
    (data: string) => {
      const parsedCwd = parseCwd(data);
      if (parsedCwd !== null) {
        terminalDebug('[Terminal] Parsed cwd from OSC-7:', parsedCwd);
        setTerminalCwd(parsedCwd);
        // Also update global atom for the tabs to show
        setGlobalCwds((prev) => ({
          ...prev,
          [paneIdRef.current]: parsedCwd
        }));
      }
    },
    [setGlobalCwds]
  );

  const updateCwdRef = useRef(updateCwdFromData);
  updateCwdRef.current = updateCwdFromData;

  // Handle stream data
  const handleStreamData = useCallback((event: TerminalStreamEvent) => {
    if (!xtermRef.current) return;

    if (event.type === 'data' && event.data) {
      xtermRef.current.write(event.data);
      updateCwdRef.current(event.data);
    } else if (event.type === 'exit') {
      isExitedRef.current = true;
      xtermRef.current.writeln(`\r\n\r\n[Process exited with code ${event.exitCode}]`);
      xtermRef.current.writeln('[Press any key to restart]');
    }
  }, []);

  // Subscribe to terminal output
  trpc.terminal.stream.useSubscription(paneId, {
    onData: handleStreamData,
    onError: (err) => {
      console.error('[Terminal] Stream error:', err);
      xtermRef.current?.write(`\r\n\x1b[31m[Connection error: ${err.message}]\x1b[0m\r\n`);
    },
    enabled: true
  });

  // Initialize terminal
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Defer terminal creation until a valid cwd is available. Without this, a
    // transient mount with empty cwd creates a session that silently falls back
    // to $HOME on the main side, and the session is then cached forever.
    const startupCwd = initialCwd || cwd;
    if (!startupCwd) {
      console.warn('[Terminal:useEffect] Skipping mount — no cwd yet');
      return;
    }

    terminalDebug('[Terminal:mount] paneId:', paneId, 'webgl:', webglEnabled);

    let isUnmounted = false;

    // Create xterm instance
    const { xterm, serializeAddon, refresh, cleanup } = createTerminalInstance(container, {
      cwd: terminalCwdRef.current || cwd,
      isDark,
      webglEnabled,
      onFileLinkClick: (_path, _line, _column) => {
        // TODO: Open file in editor
      },
      onUrlClick: (url) => {
        window.desktopApi.openExternal(url);
      }
    });

    xtermRef.current = xterm;
    serializeAddonRef.current = serializeAddon;
    refreshRef.current = refresh;
    isExitedRef.current = false;

    // Own the measure -> fit -> resize lifecycle. The sizer attempts a
    // synchronous fit at creation time so the PTY spawns at the correct size
    // when the container is already laid out (visible tab). Falls back to the
    // rAF retry loop when dimensions are not valid yet (hidden tab, renderer
    // not ready). Keeps xterm/PTY columns in lockstep afterward.
    const sizer = createTerminalSizer(
      xterm,
      container,
      ({ cols, rows }) => {
        resizeRef.current({ paneId, cols, rows });
      },
      {
        clearScrollbackOnColChange,
        // Full repaint (clears the WebGL atlas) after every committed resize so
        // partial-redraw drift / phantom glyphs self-heal.
        onAfterResize: () => refreshRef.current?.()
      }
    );
    sizerRef.current = sizer;

    // Lazy load search addon
    import('@xterm/addon-search').then(({ SearchAddon }) => {
      if (isUnmounted || !xtermRef.current) return;
      const searchAddon = new SearchAddon();
      xtermRef.current.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;
    });

    // Apply serialized state from server
    const applySerializedState = (serializedState: string) => {
      if (serializedState) {
        xterm.write(serializedState);
      }
    };

    // Restart terminal after exit
    const restartTerminal = () => {
      isExitedRef.current = false;
      xterm.clear();
      createOrAttachRef.current(
        {
          paneId,
          tabId,
          workspaceId,
          scopeKey,
          cols: xterm.cols,
          rows: xterm.rows,
          cwd: terminalCwdRef.current || cwd
        },
        {
          onSuccess: (result) => {
            applySerializedState(result.serializedState);
          }
        }
      );
    };

    // Input handler
    const handleTerminalInput = (data: string) => {
      if (isExitedRef.current) {
        // CLI surfaces register an external restart owner so the keypress runs
        // the same kill + rebootstrap path as the Restart button (relaunching
        // the correct binary with its args). Without an owner (plain terminals)
        // fall back to the in-place shell respawn.
        if (onExitedKeyPressRef.current) {
          onExitedKeyPressRef.current();
          return;
        }
        terminalDebug('[Terminal:input] swallowed — session exited, restarting paneId=', paneId);
        restartTerminal();
        return;
      }
      writeRef.current({ paneId, data });
    };

    // Key handler for command buffer (tab title)
    const handleKeyPress = (event: { key: string; domEvent: KeyboardEvent }) => {
      const { domEvent } = event;
      if (domEvent.key === 'Enter') {
        const title = sanitizeForTitle(commandBufferRef.current);
        if (title) {
          // TODO: Set tab title
        }
        commandBufferRef.current = '';
      } else if (domEvent.key === 'Backspace') {
        commandBufferRef.current = commandBufferRef.current.slice(0, -1);
      } else if (domEvent.key === 'c' && domEvent.ctrlKey) {
        commandBufferRef.current = '';
      } else if (domEvent.key.length === 1 && !domEvent.ctrlKey && !domEvent.metaKey) {
        commandBufferRef.current += domEvent.key;
      }
    };

    // Create or attach to session
    createOrAttachRef.current(
      {
        paneId,
        tabId,
        workspaceId,
        scopeKey,
        cols: xterm.cols,
        rows: xterm.rows,
        cwd: startupCwd,
        initialCommands,
        ...(bootstrap ? { bootstrap } : {})
      },
      {
        onSuccess: (result) => {
          applySerializedState(result.serializedState);
          xterm.focus();
        },
        onError: (err) => {
          xterm.write(`\x1b[31m[Failed to start terminal: ${err.message}]\x1b[0m\r\n`);
        }
      }
    );

    // Set up handlers
    const inputDisposable = xterm.onData(handleTerminalInput);
    const keyDisposable = xterm.onKey(handleKeyPress);

    const handleClear = () => {
      xterm.clear();
      clearScrollbackRef.current({ paneId });
    };

    const handleWrite = (data: string) => {
      if (!isExitedRef.current) {
        writeRef.current({ paneId, data });
      }
    };

    const cleanupKeyboard = setupKeyboardHandler(xterm, {
      onShiftEnter: () => handleWrite('\x1b\r'), // ESC + CR for line continuation
      onClear: handleClear
    });

    const cleanupClickToMove = setupClickToMoveCursor(xterm, {
      onWrite: handleWrite
    });

    // Keep the terminal keyboard-ready: focus on click, and re-focus when the
    // pane becomes visible again after a dockview tab switch (the component
    // stays mounted, so xterm otherwise silently keeps lost focus → "keyboard
    // doesn't work"). Observes the outer scope wrapper.
    const cleanupFocus = scopeRef.current ? setupAutoFocus(xterm, scopeRef.current) : undefined;

    const cleanupPaste = setupPasteHandler(xterm, {
      onPaste: (text) => {
        commandBufferRef.current += text;
      }
    });

    const cleanupContextMenu = setupContextMenuHandler(xterm, {
      onCopy: () => {
        toast.success('Copied to clipboard');
      },
      onPaste: (text) => {
        commandBufferRef.current += text;
      },
      onCopyError: () => {
        toast.error('Failed to copy to clipboard');
      },
      onPasteError: () => {
        toast.error('Failed to paste from clipboard');
      }
    });

    // Cleanup on unmount
    return () => {
      terminalDebug('[Terminal:unmount] paneId:', paneId);
      isUnmounted = true;
      inputDisposable.dispose();
      keyDisposable.dispose();
      cleanupKeyboard();
      cleanupClickToMove();
      cleanupFocus?.();
      sizer.dispose();
      cleanupPaste();
      cleanupContextMenu();
      cleanup();

      // Serialize terminal state before detaching (keeps scrollback for reattach)
      const serializedState = serializeAddon.serialize();

      // Detach instead of kill - keeps session alive for reattach
      detachRef.current({ paneId, serializedState });

      xterm.dispose();
      xtermRef.current = null;
      sizerRef.current = null;
      searchAddonRef.current = null;
      serializeAddonRef.current = null;
      refreshRef.current = null;
    };
    // Note: terminalCwd is accessed via ref to avoid remounting on cwd changes.
    // webglEnabled is included so toggling the renderer setting re-inits the
    // terminal (scrollback is preserved via the serialize/detach path above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, cwd, workspaceId, tabId, initialCwd, initialCommands, isDark, webglEnabled]);

  // Update theme when isDark changes or VS Code theme changes (without recreating terminal)
  useEffect(() => {
    if (xtermRef.current) {
      const newTheme = getTerminalThemeFromVSCode(fullThemeData?.colors, isDark);
      xtermRef.current.options.theme = newTheme;
    }
  }, [isDark, fullThemeData]);

  useEffect(() => {
    if (!searchAddonRef.current) return;
    if (!searchQuery.trim()) {
      searchAddonRef.current.clearDecorations();
      return;
    }

    searchAddonRef.current.findNext(searchQuery, { caseSensitive: false, regex: false });
  }, [searchQuery]);

  // Drag and drop files. Bail out for non-file drags (e.g. dockview tab
  // drag, where `types` contains "application/vnd.dockview-panel" or just
  // "Files" is missing) — otherwise calling preventDefault() here makes
  // the terminal claim the drop and dockview never sees it, blocking
  // tab-to-split / tab-reorder when the cursor crosses a terminal pane.
  const isFileDrag = (event: React.DragEvent): boolean => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    // DataTransferItemList exposes `.contains`; the types attribute is
    // technically a DOMStringList, but in practice all browsers expose an
    // array-like with includes(). Use a defensive check.
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  };

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;

      // Get file paths (Electron exposes webUtils)
      const paths = files.map((file) => {
        return (
          (window as unknown as { webUtils?: { getPathForFile?: (f: File) => string } }).webUtils?.getPathForFile?.(
            file
          ) || file.name
        );
      });
      const text = shellEscapePaths(paths);

      if (!isExitedRef.current) {
        writeRef.current({ paneId, data: text });
      }
    },
    [paneId]
  );

  const terminalBg = useMemo(() => {
    // Use VS Code theme terminal background if available
    if (fullThemeData?.colors?.['terminal.background']) {
      return fullThemeData.colors['terminal.background'];
    }
    if (fullThemeData?.colors?.['editor.background']) {
      return fullThemeData.colors['editor.background'];
    }
    return getDefaultTerminalBg(isDark);
  }, [isDark, fullThemeData]);

  return (
    <div
      ref={scopeRef}
      role="application"
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: terminalBg }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>
      <TerminalSearch
        isOpen={findScope.isOpen}
        query={searchQuery}
        selectionVersion={findScope.selectionVersion}
        onQueryChange={setSearchQuery}
        onClose={() => {
          findScope.setIsOpen(false);
          setSearchQuery('');
          searchAddonRef.current?.clearDecorations();
        }}
        onNext={() => {
          if (!searchQuery.trim()) return;
          searchAddonRef.current?.findNext(searchQuery, { caseSensitive: false, regex: false });
        }}
        onPrev={() => {
          if (!searchQuery.trim()) return;
          searchAddonRef.current?.findPrevious(searchQuery, { caseSensitive: false, regex: false });
        }}
      />
      <div ref={containerRef} className="h-full w-full" style={{ padding: '8px' }} />
    </div>
  );
}
