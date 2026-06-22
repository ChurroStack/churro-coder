import type { Terminal as XTerm } from '@xterm/xterm';
import { debounce, readCellDimensions } from './utils';

/**
 * Terminal sizing controller.
 *
 * Owns the measure -> fit -> resize lifecycle for one xterm instance, replacing
 * the single mount-time `fitAddon.fit()` that produced two rendering bugs:
 *
 *   1. **2-char truncation.** FitAddon hard-floors columns at `Math.max(2, ...)`,
 *      so when `fit()` ran while the container width was ~0 (dockview mounts
 *      inactive tabs with `display:none`) it committed `cols = 2`, then the PTY
 *      was spawned at that width. The single recovery `fit()` could *also* no-op
 *      because FitAddon bails when the renderer's `cell.width === 0` (not yet
 *      measured); with the container size then stable, the ResizeObserver never
 *      fired again and the terminal stayed stuck at 2 columns forever.
 *   2. **Overlapping glyphs.** When the cell metric changed (DPR/zoom, or a
 *      first-render measurement correction) while the container size stayed the
 *      same, the ResizeObserver was blind and `cols` was never re-fit, so xterm's
 *      grid and the CLI's assumed column count drifted apart and the TUI's
 *      absolute cursor moves collided.
 *
 * The controller fixes both by:
 *   - **Never committing an untrustworthy measurement** (`proposeGeometry` returns
 *     `null` when the container is zero-width or the renderer cell size is 0).
 *   - **Retrying until valid** on a bounded rAF loop, driven by `xterm.onRender`
 *     (fires once metrics exist), a ResizeObserver, an IntersectionObserver
 *     (visibility), `window` resize, and devicePixelRatio changes.
 *   - **Coalescing** all triggers into one rAF-batched commit that only resizes
 *     the PTY when the geometry actually changed.
 *   - **Debouncing the steady-state re-fit.** The first measurement is committed
 *     promptly (mount should size ASAP), but subsequent re-fits — the stream of
 *     ResizeObserver frames during a window/split drag — are debounced so the PTY
 *     receives one SIGWINCH after the drag settles, not ~60/sec. Without this the
 *     CLI would repaint on every frame mid-drag.
 *   - **Dropping stale scrollback on a width change.** Claude Code (Ink) wraps its
 *     own output to COLUMNS and emits hard newlines, so once the PTY width changes
 *     the prior scrollback is frozen at the old width — xterm can reflow soft
 *     wraps but not hard newlines, so scrolling up would show mangled text. On a
 *     column change we erase the scrollback (CSI 3 J) and keep the live viewport;
 *     full history stays in the read-only conversation pane (hydrated from JSONL).
 *
 * Per the per-subChat isolation invariant (apps/desktop/AGENTS.md) one controller
 * is created per Terminal mount and stored in a `useRef`; it is never shared.
 */

/** xterm viewport scrollbar / overview-ruler width, matching @xterm/addon-fit. */
const SCROLLBAR_WIDTH = 14;

/** Upper bound on rAF retries while the measurement is invalid (~3s at 60fps). */
const MAX_INVALID_ATTEMPTS = 180;

/**
 * Trailing debounce for steady-state re-fits (window/split drags). Matches the
 * cadence of the previous `setupResizeHandlers` implementation so a drag emits
 * one PTY resize after it settles instead of one per animation frame.
 */
const REFIT_DEBOUNCE_MS = 150;

export interface SizingInput {
  /** Available content width in CSS px (container width minus padding & scrollbar). */
  width: number;
  /** Available content height in CSS px (container height minus padding). */
  height: number;
  /** Rendered character cell width in CSS px. */
  cellWidth: number;
  /** Rendered character cell height in CSS px. */
  cellHeight: number;
}

export interface Geometry {
  cols: number;
  rows: number;
}

/**
 * Pure sizing decision. Returns `null` when the measurement is not trustworthy
 * yet (any non-positive input) so the controller defers committing and retries.
 * This is the single guard that prevents the "stuck at 2 cols" bug — a degenerate
 * measurement is never shipped to the PTY.
 */
export function proposeGeometry(input: SizingInput): Geometry | null {
  const { width, height, cellWidth, cellHeight } = input;
  if (cellWidth <= 0 || cellHeight <= 0) return null;
  if (width <= 0 || height <= 0) return null;
  const cols = Math.floor(width / cellWidth);
  const rows = Math.floor(height / cellHeight);
  if (cols < 1 || rows < 1) return null;
  return { cols, rows };
}

/** True when `next` differs from the last committed geometry (or none committed). */
export function geometryChanged(prev: Geometry | null, next: Geometry): boolean {
  return !prev || prev.cols !== next.cols || prev.rows !== next.rows;
}

/**
 * True when the column count changed from a *prior* commit. Used to decide
 * whether to drop stale scrollback: only a width change re-wraps the frame and
 * leaves prior (hard-wrapped) scrollback mismatched. Returns false on the first
 * commit — there is no prior history to invalidate.
 */
export function colsChanged(prev: Geometry | null, next: Geometry): boolean {
  return prev !== null && prev.cols !== next.cols;
}

export interface TerminalSizer {
  /** Tear down all observers, listeners, and pending frames. */
  dispose: () => void;
}

/**
 * Force xterm to re-measure its cell size. Reassigning `fontFamily` (even to the
 * same value) triggers the internal char-size remeasure + reflow — used as the
 * font-load safety net, since xterm does not auto-remeasure when a web font
 * finishes loading after `open()`.
 */
function forceCellRemeasure(xterm: XTerm): void {
  try {
    // eslint-disable-next-line no-self-assign
    xterm.options.fontFamily = xterm.options.fontFamily;
  } catch {
    // best-effort; ignore if options are not yet writable
  }
}

export interface TerminalSizerOptions {
  /**
   * Erase xterm scrollback (CSI 3J) when the column count changes. Enable for
   * Ink-based CLIs (claude-cli) that hard-wrap output to COLUMNS; leave false
   * (default) for CLIs that use terminal-native soft-wrapping (codex-cli, plain
   * terminals) where xterm can reflow the history naturally.
   */
  clearScrollbackOnColChange?: boolean;
  /**
   * Called after every committed geometry change (post xterm.resize). Wired to
   * the renderer's full-repaint hook (clears the WebGL glyph atlas + refreshes
   * the viewport) so any partial-redraw drift from a resize / DPR change /
   * renderer swap self-corrects instead of leaving phantom glyphs on screen.
   */
  onAfterResize?: () => void;
}

export function createTerminalSizer(
  xterm: XTerm,
  container: HTMLElement,
  onCommit: (geometry: Geometry) => void,
  opts: TerminalSizerOptions = {}
): TerminalSizer {
  let disposed = false;
  let committed: Geometry | null = null;

  let rafId: number | null = null;
  let pending = false;
  let invalidAttempts = 0;

  // onRender disposable, torn down after the first valid commit (see runCommit).
  let renderDisposable: { dispose: () => void } | null = null;

  // The container's padding is a static inline style (8px in terminal.tsx); read
  // it once so the per-frame retry loop never forces a layout via getComputedStyle.
  const cs = getComputedStyle(container);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

  const measure = (): SizingInput => {
    const { cellWidth, cellHeight } = readCellDimensions(xterm);
    // clientWidth/Height exclude border & scrollbar and include padding; subtract
    // the container's own padding and xterm's scrollbar to get the content box.
    return {
      width: container.clientWidth - padX - SCROLLBAR_WIDTH,
      height: container.clientHeight - padY,
      cellWidth,
      cellHeight
    };
  };

  const runCommit = (): void => {
    if (disposed) return;
    const next = proposeGeometry(measure());
    if (!next) {
      // Untrustworthy measurement. Before the first commit (mount into a hidden /
      // not-yet-measured container) retry on the next frame up to a bounded budget.
      // After the first commit, an invalid measurement just means the pane was
      // hidden (tab switch) — don't spin; the ResizeObserver/IntersectionObserver
      // re-fire when it becomes visible again.
      if (!committed) {
        invalidAttempts += 1;
        if (invalidAttempts < MAX_INVALID_ATTEMPTS) scheduleFrame();
      }
      return;
    }
    invalidAttempts = 0;
    const prev = committed;
    const changed = geometryChanged(prev, next);
    committed = next;
    if (changed) {
      try {
        xterm.resize(next.cols, next.rows);
        // A width change re-wraps the live frame, but prior scrollback stays
        // hard-wrapped at the old width — Claude Code (Ink) wraps its own output
        // to COLUMNS, so xterm cannot reflow those hard newlines and scrolling up
        // would show mangled text. Drop the now-mismatched scrollback (CSI 3 J =
        // erase saved lines; the visible viewport is kept). The CLI repaints the
        // live frame on SIGWINCH and full history remains in the conversation pane.
        // Only enabled for Ink-based CLIs (claude-cli); Codex uses terminal-native
        // soft-wrapping that xterm can reflow, so wiping is wrong there.
        if (opts.clearScrollbackOnColChange && colsChanged(prev, next)) xterm.write('\x1b[3J');
        // Force a clean full repaint after the geometry change so any stale
        // glyphs (WebGL atlas) or partial-redraw drift cannot persist at the new
        // size — the self-heal for the "phantom characters" class.
        opts.onAfterResize?.();
        // onCommit is inside the try so a mid-dispose xterm.resize throw does not
        // cause the PTY to be told a geometry that xterm never applied.
        onCommit(next);
      } catch {
        // resize / write / onCommit can throw if xterm is mid-dispose; ignore
      }
    }
  };

  /** rAF-coalesced prompt commit — used for the initial fit and the retry loop. */
  function scheduleFrame(): void {
    if (disposed || pending) return;
    pending = true;
    rafId = requestAnimationFrame(() => {
      pending = false;
      rafId = null;
      runCommit();
    });
  }

  const debouncedRefit = debounce(() => scheduleFrame(), REFIT_DEBOUNCE_MS);

  /**
   * Route a trigger to the right cadence: prompt (rAF) before the first valid
   * commit so mount sizes ASAP, debounced afterward so drag streams collapse to
   * one PTY resize. `reset` clears the invalid-retry budget (a real layout/
   * visibility change should restart retries).
   */
  function scheduleCommit(reset: boolean): void {
    if (disposed) return;
    if (reset) invalidAttempts = 0;
    if (committed) debouncedRefit();
    else scheduleFrame();
  }

  // --- Triggers -------------------------------------------------------------

  const resizeObserver = new ResizeObserver(() => scheduleCommit(true));
  resizeObserver.observe(container);

  // Visibility: dockview hides inactive panels with display:none, which the
  // ResizeObserver also catches, but the IntersectionObserver covers scroll/clip
  // cases and is the explicit "became visible" signal.
  const intersectionObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) scheduleCommit(true);
  });
  intersectionObserver.observe(container);

  const onWindowResize = () => scheduleCommit(true);
  window.addEventListener('resize', onWindowResize);

  // devicePixelRatio changes (monitor move / browser zoom) alter the cell pixel
  // size with the container size unchanged — invisible to the ResizeObserver.
  let dprMql: MediaQueryList | null = null;
  const onDprChange = () => {
    forceCellRemeasure(xterm);
    armDprListener();
    scheduleCommit(true);
  };
  function armDprListener(): void {
    if (disposed) return;
    dprMql?.removeEventListener?.('change', onDprChange);
    dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMql.addEventListener?.('change', onDprChange);
  }
  armDprListener();

  // onRender fires when xterm's render service has active cell dimensions.
  // Pre-commit: signals that an earlier invalid measurement can now succeed.
  // Post-commit: catches WebGL → Canvas renderer swaps, which reset cell
  // dimensions to 0 with no ResizeObserver signal. Debounced post-commit so
  // active output doesn't cause per-frame layout reads.
  renderDisposable = xterm.onRender(() => {
    if (committed) debouncedRefit();
    else scheduleFrame();
  });

  // Font-load safety net (mostly inert here since the terminal cascade resolves
  // to system fonts, but harmless if a web font is ever registered): re-measure
  // the cell and re-fit once fonts settle.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready
      .then(() => {
        if (disposed) return;
        forceCellRemeasure(xterm);
        scheduleCommit(true);
      })
      .catch(() => {
        // ignore font loading errors
      });
  }

  // Attempt an immediate synchronous measurement first. If the container is
  // already laid out and the renderer has measured its cell size (visible tab),
  // this sets xterm's cols/rows before the caller spawns the PTY — so the PTY
  // starts at the correct width instead of the xterm default 80×24. Falls back
  // to the rAF retry loop when dimensions are not valid yet (hidden tab, renderer
  // not ready).
  runCommit();
  if (!committed) scheduleCommit(true);

  return {
    dispose: () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      pending = false;
      debouncedRefit.cancel();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
      dprMql?.removeEventListener?.('change', onDprChange);
      renderDisposable?.dispose();
      renderDisposable = null;
    }
  };
}
