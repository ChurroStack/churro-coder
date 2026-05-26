/**
 * Task 4.4 — regression guard: terminal.resize propagates SIGWINCH to the PTY.
 * Idle detection — cursor-activity sampler emits state transitions only on real flips.
 * Task 4.6 — TUI smoke: alternate-screen enter/exit sequences pass through the PTY verbatim.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import * as pty from 'node-pty';
import { TerminalManager } from './manager';
import type { TerminalOutputState, TerminalSession } from './types';

// ── Minimal PTY stub ──────────────────────────────────────────────────────────

type PtyStubOverrides = Partial<{
  pid: number;
  cols: number;
  rows: number;
  process: string;
  handleFlowControl: boolean;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}>;

function makePtyStub(overrides: PtyStubOverrides = {}) {
  return {
    pid: 1234,
    cols: 80,
    rows: 24,
    process: 'bash',
    handleFlowControl: false,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    pause: vi.fn(),
    resume: vi.fn(),
    ...overrides
  };
}

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    pty: makePtyStub() as any,
    paneId: 'test-pane',
    workspaceId: 'ws-1',
    scopeKey: 'ws-1',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    lastActive: Date.now(),
    isAlive: true,
    shell: '/bin/bash',
    startTime: Date.now(),
    usedFallback: false,
    ...overrides
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TerminalManager.resize — SIGWINCH propagation', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    manager = new TerminalManager();
  });

  afterEach(async () => {
    await manager.cleanup();
  });

  test('resize() calls pty.resize(cols, rows) on alive session', () => {
    const session = makeSession({ paneId: 'pane-a' });
    // Inject session directly (avoids spawning a real PTY)
    (manager as any).sessions.set('pane-a', session);

    manager.resize({ paneId: 'pane-a', cols: 120, rows: 40 });

    expect(session.pty.resize).toHaveBeenCalledWith(120, 40);
    expect(session.cols).toBe(120);
    expect(session.rows).toBe(40);
  });

  test('resize() is a no-op for non-alive session', () => {
    const session = makeSession({ paneId: 'pane-b', isAlive: false });
    (manager as any).sessions.set('pane-b', session);

    manager.resize({ paneId: 'pane-b', cols: 100, rows: 30 });

    expect(session.pty.resize).not.toHaveBeenCalled();
  });

  test('resize() rejects zero or negative dimensions (guard against bad resize events)', () => {
    const session = makeSession({ paneId: 'pane-c' });
    (manager as any).sessions.set('pane-c', session);

    manager.resize({ paneId: 'pane-c', cols: 0, rows: 24 });
    manager.resize({ paneId: 'pane-c', cols: 80, rows: -1 });

    expect(session.pty.resize).not.toHaveBeenCalled();
  });
});

// ── Activity-sampler state-machine tests ─────────────────────────────────────
// Drives evaluateWindow directly. Each tick simulates one sampling window by
// injecting either cursor moves, PTY bytes, or both into the pending counters
// before calling evaluateWindow. A window is "active" if either signal is
// non-zero, "inactive" otherwise.

const RUNNING_WINDOWS = 1;
const IDLE_WINDOWS = 16;

function makeTrackedSession(paneId: string): TerminalSession {
  return makeSession({
    paneId,
    idleDetection: {},
    outputState: 'idle',
    pendingMoves: 0,
    pendingBytes: 0,
    recentMoves: []
  });
}

type TickInput = { moves?: number; bytes?: number };

function tick(manager: TerminalManager, paneId: string, input: TickInput, times = 1) {
  const session = (manager as any).sessions.get(paneId) as TerminalSession;
  for (let i = 0; i < times; i++) {
    session.pendingMoves = input.moves ?? 0;
    session.pendingBytes = input.bytes ?? 0;
    (manager as any).evaluateWindow(paneId);
  }
}

const ACTIVE: TickInput = { moves: 3 };
const ACTIVE_BYTES_ONLY: TickInput = { bytes: 40 };
const QUIET: TickInput = {};

describe('TerminalManager idle detection — state machine', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    manager = new TerminalManager();
  });

  afterEach(async () => {
    await manager.cleanup();
  });

  test('starts in idle and does not re-emit on initial quiet windows', () => {
    const session = makeTrackedSession('p1');
    (manager as any).sessions.set('p1', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p1', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p1', QUIET, IDLE_WINDOWS + 4);

    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
  });

  test('flips idle→running on first active window (cursor moves)', () => {
    const session = makeTrackedSession('p2');
    (manager as any).sessions.set('p2', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p2', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p2', ACTIVE, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);
    expect(session.outputState).toBe('running');
  });

  test('flips idle→running on first active window (bytes only — TUI rewrote in place)', () => {
    const session = makeTrackedSession('p2b');
    (manager as any).sessions.set('p2b', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p2b', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p2b', ACTIVE_BYTES_ONLY, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);
  });

  test('does not re-emit running→running for sustained activity', () => {
    const session = makeTrackedSession('p3');
    (manager as any).sessions.set('p3', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p3', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p3', ACTIVE, RUNNING_WINDOWS + 10);

    expect(events).toEqual(['running']);
  });

  test('flips running→idle only after IDLE_WINDOWS_REQUIRED consecutive inactive windows', () => {
    const session = makeTrackedSession('p4');
    (manager as any).sessions.set('p4', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p4', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p4', ACTIVE, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);

    tick(manager, 'p4', QUIET, IDLE_WINDOWS - 1);
    expect(events).toEqual(['running']);

    tick(manager, 'p4', QUIET, 1);
    expect(events).toEqual(['running', 'idle']);
    expect(session.outputState).toBe('idle');
  });

  test('idle→running→idle full cycle fires exactly one of each', () => {
    const session = makeTrackedSession('p6');
    (manager as any).sessions.set('p6', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p6', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p6', ACTIVE, RUNNING_WINDOWS + 3);
    tick(manager, 'p6', QUIET, IDLE_WINDOWS + 1);

    expect(events).toEqual(['running', 'idle']);
  });

  test('intermittent activity during running keeps state running (resets the idle streak)', () => {
    const session = makeTrackedSession('p7');
    (manager as any).sessions.set('p7', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p7', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p7', ACTIVE, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);

    // Almost-enough quiet to flip back...
    tick(manager, 'p7', QUIET, IDLE_WINDOWS - 1);
    // ...but a single active window resets the streak
    tick(manager, 'p7', ACTIVE, 1);
    tick(manager, 'p7', QUIET, IDLE_WINDOWS - 1);

    expect(events).toEqual(['running']);
  });

  test('byte flow alone keeps running stable even when cursor never moves', () => {
    const session = makeTrackedSession('p7b');
    (manager as any).sessions.set('p7b', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p7b', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p7b', ACTIVE, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);

    // Sparse byte updates (e.g. claude rewriting spinner glyph in place
    // without ever calling a cursor-positioning CSI). Each interval is
    // shorter than the idle window so the state stays running.
    for (let i = 0; i < 5; i++) {
      tick(manager, 'p7b', QUIET, IDLE_WINDOWS - 2);
      tick(manager, 'p7b', ACTIVE_BYTES_ONLY, 1);
    }

    expect(events).toEqual(['running']);
  });

  test('getOutputState reflects the latest transition for late subscribers', () => {
    const session = makeTrackedSession('p8');
    (manager as any).sessions.set('p8', session);

    expect(manager.getOutputState('p8')).toBe('idle');

    tick(manager, 'p8', ACTIVE, RUNNING_WINDOWS);
    expect(manager.getOutputState('p8')).toBe('running');

    tick(manager, 'p8', QUIET, IDLE_WINDOWS);
    expect(manager.getOutputState('p8')).toBe('idle');
  });

  test('getOutputState returns null for sessions without idle detection', () => {
    const session = makeSession({ paneId: 'p9' }); // no idleDetection
    (manager as any).sessions.set('p9', session);
    expect(manager.getOutputState('p9')).toBeNull();
  });
});

describe('TerminalManager TUI smoke — alternate-screen pass-through [terminal-embedding/4.6]', () => {
  // Spawn a real PTY that emits alt-screen enter, clears the screen, then exits
  // alt-screen. The PTY layer must pass the escape sequences through verbatim —
  // this guards against any encoding transformation that would break full-screen
  // TUIs like `claude` or `codex`.
  // Skipped in CI (SKIP_ELECTRON_REBUILD=1) because node-pty's native binding
  // isn't rebuilt against the runner's Node ABI there; spawning crashes the
  // vitest worker and exits the whole run without a summary.
  const skipRealPty = process.env.SKIP_ELECTRON_REBUILD === '1';
  test.skipIf(skipRealPty)(
    'alternate-screen enter/exit escape sequences pass through the PTY verbatim',
    async () => {
      const chunks: string[] = [];

      const proc = pty.spawn('bash', ['-c', "printf '\\033[?1049h\\033[2J\\033[H\\033[?1049l'"], {
        cols: 80,
        rows: 24,
        cwd: os.tmpdir()
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PTY process did not exit within 3s')), 3000);
        proc.onData((data) => chunks.push(data));
        proc.onExit(() => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const output = chunks.join('');
      // CSI ? 1049 h — enter alternate screen buffer
      expect(output).toContain('\x1b[?1049h');
      // CSI ? 1049 l — exit alternate screen buffer (restore prior buffer + scrollback)
      expect(output).toContain('\x1b[?1049l');
    },
    5000
  );
});
