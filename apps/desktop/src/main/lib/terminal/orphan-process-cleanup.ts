/**
 * Startup orphan-process reaper (POSIX only).
 *
 * Companion to `git/worktree-cleanup.ts`. That scanner removes orphan worktree
 * DIRECTORIES; this one kills orphan PROCESSES whose working directory is inside
 * a worktree that no `chats.worktreePath` row references — i.e. a script/dev
 * server (or its detached children) left running by a workspace that was already
 * deleted. It is the safety net for the documented `killProcessTree` residual: a
 * child that called `setsid` to start its own session escapes the live tree kill
 * but is reclaimed here on the next launch.
 *
 * Safety:
 *  - Only considers processes whose cwd is under a known worktree ROOT.
 *  - Never touches a process whose cwd is under a STILL-referenced worktree.
 *  - Never touches our own process.
 *  - Windows is skipped (no negative-pid signalling / cwd enumeration here).
 *  - Time-bounded; swallows errors; never blocks startup.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { isNotNull } from 'drizzle-orm';
import { chats, getDatabase } from '../db';

const execFileAsync = promisify(execFile);
const SCAN_TIMEOUT_MS = 15_000;

/**
 * The app's working directory, captured at module init. The main process never
 * `chdir`s, so this is the directory the app launched from; the dev app launches
 * inside its own worktree, so we use it to spare that worktree's processes.
 * Derived live from `process.cwd()` — never a hardcoded path — so it follows
 * whatever worktree the build runs from. (The dir scanner in
 * `git/worktree-cleanup.ts` reads `process.cwd()` directly for the same purpose;
 * both rely on cwd being stable across startup.)
 */
const STARTUP_CWD = resolve(process.cwd());

function worktreeRoots(): string[] {
  return [join(homedir(), '.churrostack', 'worktrees'), join(homedir(), '.21st', 'worktrees')].map(
    (r) => resolve(r) + sep
  );
}

/** True if `cwd` is inside any worktree root. */
function isUnderWorktreeRoot(cwd: string, roots: string[]): boolean {
  const r = resolve(cwd) + sep;
  return roots.some((root) => r.startsWith(root));
}

/** True if `cwd` is at or under any referenced worktree path (a live workspace). */
function isReferenced(cwd: string, referenced: string[]): boolean {
  const r = resolve(cwd);
  return referenced.some((ref) => r === ref || r.startsWith(ref + sep));
}

/**
 * Given the app's own cwd, return the worktree directory that contains it
 * (`<root>/<slug>/<folder>`), or null if cwd isn't under a worktree root.
 *
 * When churro-coder is developed inside its own worktree system, the dev app
 * launches with cwd in a SUBDIR of the worktree (e.g. `.../emotional-dale/apps/
 * desktop`), while its sibling dev processes (nx/bun/node) sit at the worktree
 * ROOT (`.../emotional-dale`). Protecting only cwd's subtree leaves those parent
 * processes exposed — so we resolve the whole worktree subtree and protect it.
 */
export function ownWorktreeRoot(cwd: string, roots: string[]): string | null {
  const r = resolve(cwd) + sep;
  for (const root of roots) {
    // `roots` entries already end with `sep`.
    if (!r.startsWith(root)) continue;
    const segs = r.slice(root.length).split(sep).filter(Boolean);
    if (segs.length < 2) return null;
    return root + segs[0] + sep + segs[1];
  }
  return null;
}

/**
 * Enumerate (pid, cwd) for all processes via `lsof -d cwd`. Returns [] on any
 * failure or if lsof is unavailable.
 */
async function listProcessCwds(): Promise<Array<{ pid: number; cwd: string }>> {
  try {
    const { stdout } = await execFileAsync('sh', ['-c', 'lsof -d cwd -Fpn 2>/dev/null || true'], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 8000
    });
    const out: Array<{ pid: number; cwd: string }> = [];
    let pid: number | null = null;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        pid = Number.parseInt(line.slice(1), 10);
      } else if (line.startsWith('n') && pid != null) {
        out.push({ pid, cwd: line.slice(1) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function reapOnce(): Promise<{ scanned: number; killed: number }> {
  const roots = worktreeRoots();
  const db = getDatabase();
  const referenced = db
    .select({ worktreePath: chats.worktreePath })
    .from(chats)
    .where(isNotNull(chats.worktreePath))
    .all()
    .map((r) => resolve(r.worktreePath as string));

  // Protect the worktree the app itself is running from. When churro-coder is
  // developed inside its own worktree system (dev launches with cwd under
  // ~/.churrostack/worktrees/...), that worktree has no chats.worktreePath row,
  // so without this guard the reaper would SIGKILL its own sibling dev processes
  // (nx/bun/node at the worktree root) and crash the app. We protect the whole
  // worktree subtree, since cwd is typically a subdir (apps/desktop) while those
  // siblings sit at the root. Inert in production (cwd not under a worktree root).
  const ownRoot = ownWorktreeRoot(STARTUP_CWD, roots);
  if (ownRoot) referenced.push(ownRoot);

  const procs = await listProcessCwds();
  let scanned = 0;
  let killed = 0;
  const self = process.pid;

  for (const { pid, cwd } of procs) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === self) continue;
    if (!isUnderWorktreeRoot(cwd, roots)) continue;
    scanned++;
    if (isReferenced(cwd, referenced)) continue; // live workspace — leave it alone
    try {
      process.kill(pid, 'SIGKILL');
      killed++;
      console.log(`[OrphanProcess] Killed orphan pid ${pid} (cwd in deleted worktree: ${cwd})`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code && code !== 'ESRCH') {
        console.warn(`[OrphanProcess] Failed to kill pid ${pid}:`, err);
      }
    }
  }

  return { scanned, killed };
}

/**
 * Run the orphan-process reap. POSIX only; capped at SCAN_TIMEOUT_MS; never throws.
 */
export async function reapOrphanProcesses(): Promise<void> {
  if (process.platform === 'win32') return;
  const start = Date.now();
  try {
    const result = await Promise.race([
      reapOnce(),
      new Promise<{ scanned: number; killed: number }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SCAN_TIMEOUT_MS)
      )
    ]);
    console.log(
      `[OrphanProcess] Scanned ${result.scanned} worktree-cwd process(es), killed ${result.killed} orphan(s) (${
        Date.now() - start
      }ms)`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[OrphanProcess] Reap failed: ${msg}`);
  }
}
