import { resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import { chats, getDatabase, projectEnvironmentVariables, projects } from '../db';
import { decryptSecret } from '../db/env-secret';

/**
 * POSIX-ish env var name (same rule the `projectEnv.set` tRPC mutation enforces).
 * Re-checked here as defense-in-depth: a key that reached the DB out-of-band
 * (manual edit / future import) must never be injected unsanitized into a PTY.
 */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True if `child` is at or under `parent`. */
function isWithin(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

/**
 * Resolve the project id for a spawning terminal. `workspaceId` is normally the
 * chatId; when it isn't (local/shared `path:*` terminals, restored sessions, or
 * any caller that passes a non-chat id), fall back to matching the spawn `cwd`
 * against a chat's worktree path, then against a project's base path — so the
 * env vars still apply instead of silently vanishing.
 */
function resolveProjectId(db: ReturnType<typeof getDatabase>, workspaceId?: string, cwd?: string): string | null {
  if (workspaceId) {
    const chat = db.select({ projectId: chats.projectId }).from(chats).where(eq(chats.id, workspaceId)).get();
    if (chat?.projectId) return chat.projectId;
  }
  if (!cwd) return null;

  for (const ch of db.select({ projectId: chats.projectId, worktreePath: chats.worktreePath }).from(chats).all()) {
    if (ch.projectId && ch.worktreePath && isWithin(cwd, ch.worktreePath)) return ch.projectId;
  }
  for (const p of db.select({ id: projects.id, path: projects.path }).from(projects).all()) {
    if (isWithin(cwd, p.path)) return p.id;
  }
  return null;
}

/**
 * Resolve a project's environment variables for injection into a newly spawned
 * process (terminal, Scripts run, Claude/Codex CLI).
 *
 * Protected values are decrypted here, in the main process, and never leave it
 * except as the spawned process's env. Any failure (no match, decrypt error)
 * resolves to `{}` so a misconfigured var can never block a terminal from
 * opening.
 *
 * Called per spawn, so every new session picks up the latest values — existing
 * running processes are intentionally unaffected (a process's env is fixed at
 * spawn).
 */
export async function resolveProjectEnv(workspaceId?: string, cwd?: string): Promise<Record<string, string>> {
  if (!workspaceId && !cwd) return {};
  try {
    const db = getDatabase();
    const projectId = resolveProjectId(db, workspaceId, cwd);
    if (!projectId) return {};

    const rows = db
      .select()
      .from(projectEnvironmentVariables)
      .where(eq(projectEnvironmentVariables.projectId, projectId))
      .all();

    const env: Record<string, string> = {};
    for (const row of rows) {
      // Belt-and-suspenders: never inject a key a shell couldn't export.
      if (!ENV_KEY_RE.test(row.key)) {
        console.warn(`[project-env] skipping invalid env var name "${row.key}"`);
        continue;
      }
      try {
        env[row.key] = row.isProtected ? decryptSecret(row.value) : row.value;
      } catch (err) {
        // Skip an individual undecryptable secret rather than failing the spawn.
        console.warn(`[project-env] skipping "${row.key}" — decrypt failed`, err);
      }
    }
    return env;
  } catch (err) {
    console.warn('[project-env] resolveProjectEnv failed; spawning without project env', err);
    return {};
  }
}
