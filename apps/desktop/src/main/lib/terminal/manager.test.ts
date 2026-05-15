/**
 * Task 4.4 — regression guard: terminal.resize propagates SIGWINCH to the PTY.
 * Task 4.3 — idle detection timer fires after silenceMs.
 * Task 4.6 — TUI smoke: alternate-screen enter/exit sequences pass through the PTY verbatim.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import * as pty from 'node-pty';
import { TerminalManager } from './manager';
import type { TerminalSession } from './types';

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

describe('TerminalManager idle detection', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new TerminalManager();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await manager.cleanup();
  });

  test('idle event fires after silenceMs of no data', () => {
    const session = makeSession({
      paneId: 'pane-idle',
      idleDetection: { silenceMs: 1000 }
    });
    (manager as any).sessions.set('pane-idle', session);

    const idleFired = vi.fn();
    manager.on('idle:pane-idle', idleFired);

    // Start the timer
    (manager as any).startIdleTimer('pane-idle', session);

    // Not yet
    vi.advanceTimersByTime(500);
    expect(idleFired).not.toHaveBeenCalled();

    // Fire!
    vi.advanceTimersByTime(600);
    expect(idleFired).toHaveBeenCalledTimes(1);
  });

  test('data resets the idle timer', () => {
    const session = makeSession({
      paneId: 'pane-reset',
      idleDetection: { silenceMs: 1000 }
    });
    (manager as any).sessions.set('pane-reset', session);

    const idleFired = vi.fn();
    manager.on('idle:pane-reset', idleFired);

    (manager as any).startIdleTimer('pane-reset', session);

    vi.advanceTimersByTime(800);
    // Simulate data arrival — resets the timer
    (manager as any).resetIdleTimer('pane-reset');

    vi.advanceTimersByTime(800); // another 800ms — total <1000ms since last reset
    expect(idleFired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300); // now 1100ms since last reset
    expect(idleFired).toHaveBeenCalledTimes(1);
  });
});

describe('TerminalManager TUI smoke — alternate-screen pass-through [terminal-embedding/4.6]', () => {
  // Spawn a real PTY that emits alt-screen enter, clears the screen, then exits
  // alt-screen. The PTY layer must pass the escape sequences through verbatim —
  // this guards against any encoding transformation that would break full-screen
  // TUIs like `claude` or `codex`.
  test('alternate-screen enter/exit escape sequences pass through the PTY verbatim', async () => {
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
  }, 5000);
});
