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

  test('resize() is a full no-op when geometry is unchanged (avoids spurious SIGWINCH on first mount / tab activation)', () => {
    const headlessResize = vi.fn();
    const session = makeSession({
      paneId: 'pane-noop',
      cols: 80,
      rows: 24,
      idleDetection: {},
      headlessTerminal: { resize: headlessResize, dispose: vi.fn() } as any
    });
    (manager as any).sessions.set('pane-noop', session);

    manager.resize({ paneId: 'pane-noop', cols: 80, rows: 24 });

    expect(session.pty.resize).not.toHaveBeenCalled();
    expect(headlessResize).not.toHaveBeenCalled();
    expect(session.suppressActivityUntil).toBeUndefined();
  });

  test('resize() with real geometry change stamps suppressActivityUntil ≈ now + resizeSuppressMs', () => {
    const session = makeSession({ paneId: 'pane-stamp', idleDetection: {} });
    (manager as any).sessions.set('pane-stamp', session);

    const before = Date.now();
    manager.resize({ paneId: 'pane-stamp', cols: 120, rows: 40 });
    const after = Date.now();

    expect(session.pty.resize).toHaveBeenCalledWith(120, 40);
    expect(session.suppressActivityUntil).toBeDefined();
    // 1500 ms suppression window (IDLE_TUNING.resizeSuppressMs).
    expect(session.suppressActivityUntil!).toBeGreaterThanOrEqual(before + 1500);
    expect(session.suppressActivityUntil!).toBeLessThanOrEqual(after + 1500);
  });

  test('resize() does not stamp suppression when the session opted out of idle detection', () => {
    const session = makeSession({ paneId: 'pane-no-idle', cols: 80, rows: 24 }); // no idleDetection
    (manager as any).sessions.set('pane-no-idle', session);

    manager.resize({ paneId: 'pane-no-idle', cols: 120, rows: 40 });

    expect(session.pty.resize).toHaveBeenCalledWith(120, 40);
    expect(session.suppressActivityUntil).toBeUndefined();
  });
});

// ── Activity-sampler state-machine tests ─────────────────────────────────────
// Drives evaluateWindow directly. Each tick simulates one sampling window by
// injecting either cursor moves, PTY bytes, or both into the pending counters
// before calling evaluateWindow. A window is "active" if either signal is
// non-zero, "inactive" otherwise.

const RUNNING_WINDOWS = 2;
const IDLE_WINDOWS = 4;

function makeTrackedSession(paneId: string, extra: Partial<TerminalSession> = {}): TerminalSession {
  return makeSession({
    paneId,
    idleDetection: {},
    outputState: 'idle',
    pendingMoves: 0,
    pendingBytes: 0,
    recentMoves: [],
    // These tests exercise the steady-state OUTPUT heuristic, which only opens
    // idle→running after the first explicit turn-start (banner-suppression
    // gate). Default to post-first-turn so they keep asserting heuristic
    // behavior; the gate itself is covered by the dedicated turn-start block.
    hasStartedTurn: true,
    ...extra
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

  test('flips idle→running after 2 consecutive active windows (cursor moves)', () => {
    const session = makeTrackedSession('p2');
    (manager as any).sessions.set('p2', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p2', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p2', ACTIVE, 1);
    expect(events).toEqual([]); // one window not enough
    tick(manager, 'p2', ACTIVE, 1);
    expect(events).toEqual(['running']);
    expect(session.outputState).toBe('running');
  });

  test('flips idle→running after 2 consecutive active windows (bytes only — TUI rewrote in place)', () => {
    const session = makeTrackedSession('p2b');
    (manager as any).sessions.set('p2b', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p2b', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p2b', ACTIVE_BYTES_ONLY, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);
  });

  test('single active window then quiet does NOT flip idle→running (defangs single-burst false positives)', () => {
    const session = makeTrackedSession('p2c');
    (manager as any).sessions.set('p2c', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p2c', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p2c', ACTIVE, 1);
    tick(manager, 'p2c', QUIET, 1);
    tick(manager, 'p2c', QUIET, 10);

    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
  });

  test('does not re-emit running→running for sustained activity', () => {
    const session = makeTrackedSession('p3');
    (manager as any).sessions.set('p3', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p3', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p3', ACTIVE, RUNNING_WINDOWS + 10);

    expect(events).toEqual(['running']);
  });

  test('flips running→idle only after 4 consecutive inactive windows (4s of silence)', () => {
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

  // ── Post-resize suppression ────────────────────────────────────────────────
  // The TUI repaint burst that follows a SIGWINCH is the historical false-
  // positive source. Stamping `suppressActivityUntil` on the session causes
  // the sampler to drain its counters without touching the ring or evaluating
  // a transition — so the burst can't flip an idle session into running and
  // can't bias a running session toward premature idle.

  test('active window during suppression is fully ignored (no transition, ring untouched)', () => {
    const session = makeTrackedSession('p-supp-1');
    session.suppressActivityUntil = Date.now() + 5000;
    (manager as any).sessions.set('p-supp-1', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p-supp-1', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p-supp-1', ACTIVE_BYTES_ONLY, 1);
    tick(manager, 'p-supp-1', ACTIVE, 1);

    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
    // Ring must stay empty — pushing 0 would also be wrong because it biases
    // the next running→idle countdown.
    expect(session.recentMoves).toEqual([]);
    // Counters drained so the post-suppression window starts clean.
    expect(session.pendingMoves).toBe(0);
    expect(session.pendingBytes).toBe(0);
  });

  test('suppression expires: activity after the gate flips idle→running normally', () => {
    const session = makeTrackedSession('p-supp-2');
    session.suppressActivityUntil = Date.now() - 1; // already expired
    (manager as any).sessions.set('p-supp-2', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p-supp-2', (s: TerminalOutputState) => events.push(s));

    tick(manager, 'p-supp-2', ACTIVE, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);
  });

  test('suppression while running preserves running and does not advance the idle countdown', () => {
    const session = makeTrackedSession('p-supp-3');
    (manager as any).sessions.set('p-supp-3', session);

    const events: TerminalOutputState[] = [];
    manager.on('state:p-supp-3', (s: TerminalOutputState) => events.push(s));

    // Get into running first.
    tick(manager, 'p-supp-3', ACTIVE, RUNNING_WINDOWS);
    expect(events).toEqual(['running']);
    const ringAfterRunning = [...(session.recentMoves ?? [])];

    // Now suppress and drive quiet windows during suppression.
    session.suppressActivityUntil = Date.now() + 5000;
    tick(manager, 'p-supp-3', QUIET, IDLE_WINDOWS + 2);

    expect(events).toEqual(['running']);
    expect(session.outputState).toBe('running');
    // Ring preserved — suppression doesn't bias the idle countdown.
    expect(session.recentMoves).toEqual(ringAfterRunning);

    // Lift suppression, run the full idle countdown — relaxes correctly.
    session.suppressActivityUntil = Date.now() - 1;
    tick(manager, 'p-supp-3', QUIET, IDLE_WINDOWS);
    expect(events).toEqual(['running', 'idle']);
  });
});

// ── Deterministic turn-start ─────────────────────────────────────────────────
// The spinner must open the instant a turn is submitted — not after the output
// heuristic (maybe) trips 1-2s later. markCliTurnStart() is the deterministic
// opener; it is invoked from manager.write() (user/dispatcher Enter) and from
// the bootstrap's onTurnStart (first injected prompt). Before the first
// turn-start the output heuristic is gated so the startup banner can't open a
// spurious spinner.

type CliStateEventPayload = { subChatId: string; parentChatId: string | null; state: string };

describe('TerminalManager deterministic turn-start', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    manager = new TerminalManager();
  });

  afterEach(async () => {
    await manager.cleanup();
  });

  test('markCliTurnStart opens running immediately, seeds the ring, and marks hasStartedTurn', () => {
    const session = makeTrackedSession('cli:sc-1', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-1', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    (manager as any).markCliTurnStart(session);

    expect(events).toEqual([{ subChatId: 'sc-1', parentChatId: 'ws-1', state: 'running' }]);
    expect(session.outputState).toBe('running');
    expect(session.hasStartedTurn).toBe(true);
    // Ring seeded fully-active → built-in running floor (IDLE_WINDOWS entries).
    expect(session.recentMoves).toEqual(new Array(IDLE_WINDOWS).fill(1));
    expect(session.pendingMoves).toBe(0);
    expect(session.pendingBytes).toBe(0);
  });

  test('write() ending in CR to a CLI pane opens running deterministically (dispatcher / direct typing)', () => {
    const session = makeTrackedSession('cli:sc-2', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-2', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    manager.write({ paneId: 'cli:sc-2', data: '\r' });

    expect(session.pty.write).toHaveBeenCalledWith('\r');
    expect(events).toEqual([{ subChatId: 'sc-2', parentChatId: 'ws-1', state: 'running' }]);
    expect(session.outputState).toBe('running');
  });

  test('write() of a non-submit keystroke (no trailing newline) does NOT open running', () => {
    const session = makeTrackedSession('cli:sc-3', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-3', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    manager.write({ paneId: 'cli:sc-3', data: 'h' });

    expect(session.pty.write).toHaveBeenCalledWith('h');
    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
  });

  test('write() ending in CR to a NON-cli pane does not trigger turn-start', () => {
    const session = makeTrackedSession('shell-pane', { hasStartedTurn: false });
    (manager as any).sessions.set('shell-pane', session);

    const events: string[] = [];
    manager.on('state:shell-pane', (s: string) => events.push(s));

    manager.write({ paneId: 'shell-pane', data: 'ls\r' });

    expect(session.pty.write).toHaveBeenCalledWith('ls\r');
    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
  });

  test('banner suppression: sustained output before the first turn-start does NOT open running', () => {
    const session = makeTrackedSession('cli:sc-4', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-4', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    // Banner streams plenty of bytes for many windows — heuristic stays gated.
    tick(manager, 'cli:sc-4', ACTIVE, RUNNING_WINDOWS + 5);
    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');

    // First turn-start opens it deterministically.
    (manager as any).markCliTurnStart(session);
    expect(events).toEqual([{ subChatId: 'sc-4', parentChatId: 'ws-1', state: 'running' }]);
  });

  test('after the first turn-start, the output heuristic opener works again (continuations / direct typing)', () => {
    const session = makeTrackedSession('cli:sc-5', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-5', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    // First turn opens then idles out.
    (manager as any).markCliTurnStart(session);
    tick(manager, 'cli:sc-5', QUIET, IDLE_WINDOWS);
    expect(events).toEqual([
      { subChatId: 'sc-5', parentChatId: 'ws-1', state: 'running' },
      { subChatId: 'sc-5', parentChatId: 'ws-1', state: 'idle' }
    ]);

    // hasStartedTurn now true → heuristic reopens on sustained output with no
    // new explicit turn-start (model-initiated continuation).
    tick(manager, 'cli:sc-5', ACTIVE, RUNNING_WINDOWS);
    expect(events[events.length - 1]).toEqual({ subChatId: 'sc-5', parentChatId: 'ws-1', state: 'running' });
  });

  test('running floor: seeded ring requires IDLE_WINDOWS quiet windows before closing', () => {
    const session = makeTrackedSession('cli:sc-6', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-6', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    (manager as any).markCliTurnStart(session);
    // One short of the floor — still running even with zero output (silent think).
    tick(manager, 'cli:sc-6', QUIET, IDLE_WINDOWS - 1);
    expect(session.outputState).toBe('running');
    // The floor drains → idle.
    tick(manager, 'cli:sc-6', QUIET, 1);
    expect(session.outputState).toBe('idle');
  });

  test('duplicate turn-start while already running does not re-emit', () => {
    const session = makeTrackedSession('cli:sc-7', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-7', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    (manager as any).markCliTurnStart(session);
    (manager as any).markCliTurnStart(session);
    manager.write({ paneId: 'cli:sc-7', data: '\r' });

    expect(events).toEqual([{ subChatId: 'sc-7', parentChatId: 'ws-1', state: 'running' }]);
  });

  test('markCliTurnStart is a no-op for a session without idle detection', () => {
    const session = makeSession({ paneId: 'cli:sc-8', outputState: 'idle' }); // no idleDetection
    (manager as any).sessions.set('cli:sc-8', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    (manager as any).markCliTurnStart(session);

    expect(events).toEqual([]);
    expect(session.hasStartedTurn).toBeUndefined();
  });

  test('markCliTurnStart is a no-op for a dead session (no resurrecting an exited pane)', () => {
    const session = makeTrackedSession('cli:sc-dead', { hasStartedTurn: false, isAlive: false });
    (manager as any).sessions.set('cli:sc-dead', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    (manager as any).markCliTurnStart(session);

    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
    expect(session.hasStartedTurn).toBe(false);
  });

  test('Shift+Enter line continuation (ESC+CR) does NOT open running', () => {
    const session = makeTrackedSession('cli:sc-shift', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-shift', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    manager.write({ paneId: 'cli:sc-shift', data: '\x1b\r' });

    expect(session.pty.write).toHaveBeenCalledWith('\x1b\r');
    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
  });

  test('multi-line paste merely ending in a newline does NOT open running', () => {
    const session = makeTrackedSession('cli:sc-paste', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:sc-paste', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    manager.write({ paneId: 'cli:sc-paste', data: 'line1\nline2\n' });

    expect(events).toEqual([]);
    expect(session.outputState).toBe('idle');
  });

  test('handleCliTurnStart (bootstrap onTurnStart wiring) marks the registered session running by paneId', () => {
    const session = makeTrackedSession('cli:wire-1', { hasStartedTurn: false });
    (manager as any).sessions.set('cli:wire-1', session);

    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    (manager as any).handleCliTurnStart('cli:wire-1');

    expect(events).toEqual([{ subChatId: 'wire-1', parentChatId: 'ws-1', state: 'running' }]);
    expect(session.hasStartedTurn).toBe(true);
  });

  test('handleCliTurnStart is a no-op for an unknown paneId (orphaned-timer safety)', () => {
    const events: CliStateEventPayload[] = [];
    manager.on('cli-state', (e: CliStateEventPayload) => events.push(e));

    expect(() => (manager as any).handleCliTurnStart('cli:gone')).not.toThrow();
    expect(events).toEqual([]);
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
