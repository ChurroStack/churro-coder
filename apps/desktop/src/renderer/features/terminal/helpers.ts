import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ITheme } from '@xterm/xterm';
import { TERMINAL_OPTIONS, TERMINAL_THEME_DARK, TERMINAL_THEME_LIGHT, getTerminalTheme } from './config';
import { FilePathLinkProvider } from './link-providers';
import { isMac, isModifierPressed, showLinkPopup, removeLinkPopup } from './link-providers/link-popup';
import { readCellDimensions } from './utils';

/**
 * Gated debug logger for the terminal feature. Off by default — flip on at
 * runtime with `localStorage.setItem('churro:terminal-debug','1')` (or set
 * `globalThis.__CHURRO_TERMINAL_DEBUG__ = true`) to surface the mount / renderer
 * / focus / resize traces without spamming the console for every user.
 */
export function terminalDebug(...args: unknown[]): void {
  try {
    const on =
      (globalThis as { __CHURRO_TERMINAL_DEBUG__?: boolean }).__CHURRO_TERMINAL_DEBUG__ === true ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('churro:terminal-debug') === '1');
    if (on) console.log(...(args as []));
  } catch {
    // never let logging throw
  }
}

/**
 * Get the default terminal background color based on theme.
 */
export function getDefaultTerminalBg(isDark = true): string {
  const theme = isDark ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT;
  return theme?.background ?? (isDark ? '#121212' : '#fafafa');
}

export type TerminalRendererKind = 'webgl' | 'canvas' | 'dom';

export interface TerminalRenderer {
  /** Dispose the active renderer addon (no-op for the built-in DOM renderer). */
  dispose: () => void;
  /**
   * Force a clean full repaint. For WebGL this also clears the glyph texture
   * atlas — the cache that, on partial in-place TUI redraws/resizes, leaves
   * stale glyphs at wrong positions (the "phantom characters" bug). Cheap for
   * Canvas/DOM (just a viewport refresh). Wired into the sizer's post-resize
   * commit and the renderer-swap path so drift self-heals.
   */
  refresh: () => void;
}

/**
 * Load the cell renderer for an xterm instance.
 *
 * Default (webglEnabled=false): Canvas renderer, falling back to xterm's
 * built-in DOM renderer if Canvas construction fails. Canvas repaints per cell
 * every frame and is immune to the WebGL texture-atlas phantom-glyph class, so
 * it is the safe default for redraw-heavy TUIs.
 *
 * Opt-in (webglEnabled=true): WebGL renderer with two safety nets — an
 * `onContextLoss` handler that swaps to Canvas (a GPU process restart / context
 * eviction would otherwise leave the pane blank), and a construct-time
 * try/catch that falls back to Canvas, then DOM. Even when WebGL is active the
 * returned `refresh()` clears the texture atlas to defend against atlas
 * corruption on resize/DPR change.
 */
function loadRenderer(xterm: XTerm, webglEnabled: boolean): TerminalRenderer {
  let renderer: WebglAddon | CanvasAddon | null = null;
  let kind: TerminalRendererKind = 'dom';

  const loadCanvas = (): boolean => {
    try {
      const canvas = new CanvasAddon();
      xterm.loadAddon(canvas);
      renderer = canvas;
      kind = 'canvas';
      return true;
    } catch (err) {
      terminalDebug('[Terminal:renderer] canvas failed, using DOM:', err);
      renderer = null;
      kind = 'dom';
      return false;
    }
  };

  if (webglEnabled) {
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        terminalDebug('[Terminal:renderer] webgl context lost → canvas');
        try {
          webglAddon.dispose();
        } catch {
          // ignore
        }
        loadCanvas();
      });
      xterm.loadAddon(webglAddon);
      renderer = webglAddon;
      kind = 'webgl';
    } catch (err) {
      terminalDebug('[Terminal:renderer] webgl failed → canvas:', err);
      loadCanvas();
    }
  } else {
    loadCanvas();
  }

  terminalDebug('[Terminal:renderer] active renderer =', kind);

  return {
    dispose: () => {
      try {
        renderer?.dispose();
      } catch {
        // ignore
      }
    },
    refresh: () => {
      try {
        // Clear the WebGL glyph atlas before repainting so stale cached glyphs
        // cannot survive a resize/DPR change. clearTextureAtlas exists on the
        // WebGL addon (0.19.0); guard for the Canvas/DOM case.
        if (kind === 'webgl') {
          (renderer as WebglAddon | null)?.clearTextureAtlas?.();
        }
        xterm.refresh(0, Math.max(0, xterm.rows - 1));
      } catch {
        // refresh can throw mid-dispose; ignore
      }
    }
  };
}

export interface CreateTerminalOptions {
  cwd?: string;
  initialTheme?: ITheme | null;
  isDark?: boolean;
  /** Use the WebGL renderer instead of Canvas (user setting; default false). */
  webglEnabled?: boolean;
  onFileLinkClick?: (path: string, line?: number, column?: number) => void;
  onUrlClick?: (url: string) => void;
}

export interface TerminalInstance {
  xterm: XTerm;
  serializeAddon: SerializeAddon;
  /** Force a clean full repaint (clears the WebGL atlas when active). */
  refresh: () => void;
  cleanup: () => void;
}

/**
 * Creates and initializes an xterm instance with all addons.
 * Does: create → open → addons. Sizing (fit/resize) is owned by the
 * TerminalSizer (see terminal-sizing.ts), not done here — committing a fit at
 * mount time was unreliable (hidden container / renderer not yet measured).
 */
export function createTerminalInstance(
  container: HTMLDivElement,
  options: CreateTerminalOptions = {}
): TerminalInstance {
  const { initialTheme, isDark = true, webglEnabled = false, onFileLinkClick, onUrlClick } = options;

  // Use provided theme, or get theme based on isDark
  const theme = initialTheme ?? getTerminalTheme(isDark);
  const terminalOptions = { ...TERMINAL_OPTIONS, theme };

  // 1. Create + open xterm in the DOM.
  const xterm = new XTerm(terminalOptions);
  xterm.open(container);

  // 2. Load serialize addon for state persistence (scrollback survives detach).
  const serializeAddon = new SerializeAddon();
  xterm.loadAddon(serializeAddon);

  // 3. Load the cell renderer (Canvas by default; WebGL only when opted in).
  const renderer = loadRenderer(xterm, webglEnabled);

  // 4. Set up URL link provider using official WebLinksAddon
  if (onUrlClick) {
    const webLinksAddon = new WebLinksAddon(
      (event: MouseEvent, uri: string) => {
        // Require Cmd+Click (Mac) or Ctrl+Click (Windows/Linux)
        if (isModifierPressed(event)) {
          onUrlClick(uri);
        }
      },
      {
        hover: (event: MouseEvent, uri: string) => {
          showLinkPopup(event, uri, onUrlClick);
        },
        leave: () => {
          removeLinkPopup();
        }
      }
    );
    xterm.loadAddon(webLinksAddon);
  }

  // 5. Set up file path link provider
  if (onFileLinkClick) {
    const filePathLinkProvider = new FilePathLinkProvider(xterm, (_event, path, line, column) => {
      onFileLinkClick(path, line, column);
    });
    xterm.registerLinkProvider(filePathLinkProvider);
  }

  return {
    xterm,
    serializeAddon,
    refresh: renderer.refresh,
    cleanup: () => {
      renderer.dispose();
    }
  };
}

export interface KeyboardHandlerOptions {
  /** Callback for Shift+Enter (sends ESC+CR for line continuation) */
  onShiftEnter?: () => void;
  /** Callback for the clear terminal shortcut (Cmd+K) */
  onClear?: () => void;
}

/**
 * Setup keyboard handling for xterm including:
 * - Shift+Enter: Sends ESC+CR sequence
 * - Cmd+K: Clear terminal
 * - Ctrl+V / Cmd+V: Intercept to allow browser paste event
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupKeyboardHandler(xterm: XTerm, options: KeyboardHandlerOptions = {}): () => void {
  const handler = (event: KeyboardEvent): boolean => {
    // Shift+Enter - line continuation
    const isShiftEnter = event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;

    if (isShiftEnter) {
      if (event.type === 'keydown' && options.onShiftEnter) {
        options.onShiftEnter();
      }
      return false; // Prevent xterm from processing
    }

    // Cmd+K - clear terminal (macOS)
    const isClearShortcut = event.key === 'k' && event.metaKey && !event.shiftKey && !event.altKey;

    if (isClearShortcut) {
      if (event.type === 'keydown' && options.onClear) {
        options.onClear();
      }
      return false; // Prevent xterm from processing
    }

    // Ctrl+V (Windows/Linux) or Cmd+V (macOS) - let Electron menu handle paste
    // Return false to prevent xterm from showing ^v character
    // The Electron menu's "paste" role will trigger a paste event on the textarea
    const isPasteShortcut =
      event.key === 'v' &&
      !event.shiftKey &&
      !event.altKey &&
      (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

    if (isPasteShortcut) {
      return false; // Prevent xterm from showing ^v, let Electron menu handle it
    }

    return true; // Let xterm process the key
  };

  xterm.attachCustomKeyEventHandler(handler);

  return () => {
    xterm.attachCustomKeyEventHandler(() => true);
  };
}

export interface PasteHandlerOptions {
  /** Callback when text is pasted */
  onPaste?: (text: string) => void;
}

/**
 * Setup paste handler for xterm to ensure bracketed paste mode works correctly.
 *
 * This is required for TUI applications like vim that expect bracketed paste mode
 * to distinguish between typed and pasted content.
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupPasteHandler(xterm: XTerm, options: PasteHandlerOptions = {}): () => void {
  const textarea = xterm.textarea;
  if (!textarea) return () => {};

  const handlePaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    options.onPaste?.(text);
    xterm.paste(text);
  };

  textarea.addEventListener('paste', handlePaste, { capture: true });

  return () => {
    textarea.removeEventListener('paste', handlePaste, { capture: true });
  };
}

/**
 * Keep the terminal focusable and keyboard-ready across dockview visibility
 * toggles. Dockview hides inactive panels with CSS (the Terminal component stays
 * mounted), so xterm silently loses focus and typing goes nowhere until the user
 * clicks — the "keyboard doesn't work" symptom. This wires two recoveries:
 *
 *  - **Pointer:** any mousedown inside the pane focuses xterm (single click is
 *    always enough; text selection still works because xterm handles its own
 *    selection on the same gesture).
 *  - **Visibility:** when the pane becomes visible again, focus xterm — but only
 *    if nothing else currently owns focus (activeElement is body/null) or focus
 *    is already inside this pane. This restores the common "switched tab and
 *    came back" case without stealing focus from the chat composer or another
 *    input elsewhere in the window.
 *
 * Returns a cleanup function.
 */
export function setupAutoFocus(xterm: XTerm, scope: HTMLElement, onFocused?: () => void): () => void {
  const focusNow = (reason: string): void => {
    try {
      xterm.focus();
      terminalDebug('[Terminal:focus] focused on', reason);
      onFocused?.();
    } catch {
      // ignore (mid-dispose)
    }
  };

  const onMouseDown = () => focusNow('pointer');
  scope.addEventListener('mousedown', onMouseDown, { capture: true });

  const intersectionObserver = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    const active = document.activeElement;
    const ownsFocus = active === null || active === document.body || scope.contains(active);
    // Only grab focus when it is unowned or already ours — never yank it from
    // an input the user is typing in elsewhere.
    if (ownsFocus) focusNow('visible');
  });
  intersectionObserver.observe(scope);

  return () => {
    scope.removeEventListener('mousedown', onMouseDown, { capture: true });
    intersectionObserver.disconnect();
  };
}

export interface ClickToMoveOptions {
  /** Callback to write data to the terminal PTY */
  onWrite: (data: string) => void;
}

/**
 * Convert mouse event coordinates to terminal cell coordinates.
 */
function getTerminalCoordsFromEvent(xterm: XTerm, event: MouseEvent): { col: number; row: number } | null {
  const element = xterm.element;
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const { cellWidth, cellHeight } = readCellDimensions(xterm);

  if (cellWidth <= 0 || cellHeight <= 0) return null;

  const col = Math.max(0, Math.min(xterm.cols - 1, Math.floor(x / cellWidth)));
  const row = Math.max(0, Math.min(xterm.rows - 1, Math.floor(y / cellHeight)));

  return { col, row };
}

/**
 * Setup click-to-move cursor functionality.
 * Allows clicking on the current prompt line to move the cursor.
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupClickToMoveCursor(xterm: XTerm, options: ClickToMoveOptions): () => void {
  const handleClick = (event: MouseEvent) => {
    // Don't interfere with full-screen apps (vim, less, etc.)
    if (xterm.buffer.active !== xterm.buffer.normal) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (xterm.hasSelection()) return;

    const coords = getTerminalCoordsFromEvent(xterm, event);
    if (!coords) return;

    const buffer = xterm.buffer.active;
    const clickBufferRow = coords.row + buffer.viewportY;

    // Only move cursor on the same line (editable prompt area)
    if (clickBufferRow !== buffer.cursorY + buffer.viewportY) return;

    const delta = coords.col - buffer.cursorX;
    if (delta === 0) return;

    // Right arrow: \x1b[C, Left arrow: \x1b[D
    const arrowKey = delta > 0 ? '\x1b[C' : '\x1b[D';
    options.onWrite(arrowKey.repeat(Math.abs(delta)));
  };

  xterm.element?.addEventListener('click', handleClick);

  return () => {
    xterm.element?.removeEventListener('click', handleClick);
  };
}

export interface ContextMenuHandlerOptions {
  /** Callback when text is copied via context menu */
  onCopy?: (text: string) => void;
  /** Callback when text is pasted via context menu */
  onPaste?: (text: string) => void;
  /** Callback when copy fails */
  onCopyError?: (error: unknown) => void;
  /** Callback when paste fails */
  onPasteError?: (error: unknown) => void;
}

/**
 * Setup right-click context menu for terminal with copy/paste support.
 * - If text is selected: copies to clipboard
 * - If no selection: pastes from clipboard
 *
 * Returns a cleanup function to remove the handler.
 */
export function setupContextMenuHandler(xterm: XTerm, options: ContextMenuHandlerOptions = {}): () => void {
  const element = xterm.element;
  if (!element) {
    return () => {}; // noop cleanup if element not available
  }

  const handleContextMenu = async (event: MouseEvent) => {
    event.preventDefault();

    const selection = xterm.getSelection();

    if (selection) {
      // Has selection - copy to clipboard
      try {
        await navigator.clipboard.writeText(selection);
        options.onCopy?.(selection);
        // Clear selection after copy (optional, mimics typical terminal behavior)
        xterm.clearSelection();
      } catch (err) {
        console.warn('[Terminal] Failed to copy to clipboard:', err);
        options.onCopyError?.(err);
      }
    } else {
      // No selection - paste from clipboard
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          options.onPaste?.(text);
          xterm.paste(text);
        }
      } catch (err) {
        console.warn('[Terminal] Failed to paste from clipboard:', err);
        options.onPasteError?.(err);
      }
    }
  };

  element.addEventListener('contextmenu', handleContextMenu);

  return () => {
    element.removeEventListener('contextmenu', handleContextMenu);
  };
}
