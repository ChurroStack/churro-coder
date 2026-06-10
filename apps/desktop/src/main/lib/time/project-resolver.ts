/**
 * cwd → project attribution for the Time/billing page.
 *
 * Usage JSONLs (Claude `~/.claude/projects/...`, Codex `~/.codex/sessions/...`)
 * record the working directory the session ran in. Invoicing is per *project*,
 * and a project's work happens both inside churro sub-chats AND in the user's
 * own terminal on the same worktree. So we attribute by cwd, not by sub-chat
 * session id — at the project grain cwd is unambiguous (two sub-chats sharing a
 * worktree still belong to the same project).
 *
 * Resolution order (most specific → least), so every session gets a NAME and
 * nothing falls to a bare "unattributed" bucket:
 *   1. Exact/prefix match of a known worktree path  → that worktree's project.
 *   2. Exact/prefix match of a known project path    → that project.
 *   3. churro worktree convention `.churrostack/worktrees/<project>/<wt>`
 *      → `<project>`, mapped to a known project by name when possible.
 *   4. Generic: the last meaningful path segment (repo/folder name).
 *   5. Home dir / unresolvable → "Other".
 *
 * Worktrees ALWAYS roll up to their parent project (the user's choice) because
 * steps 1 & 3 resolve to the project, never the individual worktree.
 */
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '../db';
import { projects as projectsTbl, chats as chatsTbl, subChats as subChatsTbl } from '../db/schema';

export interface ResolvedProject {
  projectId: string | null;
  projectName: string;
  /** Only set when the cwd matched a known churro worktree path. */
  chatId: string | null;
  chatName: string | null;
}

interface PathEntry {
  path: string; // normalized, no trailing slash
  projectId: string | null;
  projectName: string;
  chatId: string | null;
  chatName: string | null;
}

export interface ProjectIndex {
  /** Path-prefix entries, sorted longest-path-first for greedy matching. */
  byPath: PathEntry[];
  /** lowercased project name → canonical identity (for the worktree convention). */
  byName: Map<string, { projectId: string; projectName: string }>;
}

const OTHER = 'Other';

/** Normalize a path for prefix comparison: `\`→`/`, collapse, strip trailing `/`. */
function norm(p: string): string {
  let s = p.replace(/\\/g, '/').trim();
  s = s.replace(/\/+$/, '');
  return s;
}

/** True when `cwd` is the same dir as `base` or nested under it (path-boundary aware). */
function isUnderOrEqual(cwd: string, base: string): boolean {
  if (base.length === 0) return false;
  return cwd === base || cwd.startsWith(base + '/');
}

/** The churro worktree convention embeds the project name in the path. */
function worktreeConventionName(cwd: string): string | null {
  const m = cwd.match(/\/\.churrostack\/worktrees\/([^/]+)\//);
  return m ? m[1] : null;
}

/** Best-effort project name from an arbitrary cwd (last meaningful segment). */
function deriveNameFromPath(cwd: string): string {
  const segs = cwd.split('/').filter(Boolean);
  if (segs.length === 0) return OTHER;
  const last = segs[segs.length - 1];
  // A bare home dir (`/Users/<me>`) or a volume root is not a project.
  if (segs.length <= 2) return OTHER;
  // Skip a trailing build/worktree noise segment if it looks like a dotdir.
  if (last.startsWith('.')) {
    return segs.length >= 2 ? segs[segs.length - 2] : OTHER;
  }
  return last;
}

/** Build the lookup index from raw project + worktree rows. Pure (unit-tested). */
export function buildProjectIndex(
  projectRows: Array<{ id: string; name: string | null; path: string | null }>,
  worktreeRows: Array<{
    chatId: string;
    chatName: string | null;
    projectId: string;
    projectName: string | null;
    worktreePath: string | null;
  }>
): ProjectIndex {
  const byPath: PathEntry[] = [];
  const byName = new Map<string, { projectId: string; projectName: string }>();

  for (const p of projectRows) {
    if (p.path) {
      const name = p.name ?? deriveNameFromPath(norm(p.path));
      byPath.push({ path: norm(p.path), projectId: p.id, projectName: name, chatId: null, chatName: null });
      if (p.name) byName.set(p.name.toLowerCase(), { projectId: p.id, projectName: p.name });
    }
  }
  for (const w of worktreeRows) {
    if (w.worktreePath) {
      byPath.push({
        path: norm(w.worktreePath),
        projectId: w.projectId,
        projectName: w.projectName ?? OTHER,
        chatId: w.chatId,
        chatName: w.chatName
      });
    }
  }
  // Longest path first so the most specific (worktree before project root) wins.
  byPath.sort((a, b) => b.path.length - a.path.length);
  return { byPath, byName };
}

/**
 * Derive a name from a path, then canonicalize it to a KNOWN churro project
 * (case-insensitive) when the name matches one — so a session that only hit the
 * last-segment heuristic still rolls up into the registered project's row
 * (`projectId` set) instead of fragmenting into a separate case-variant line.
 */
function deriveResolved(path: string, index: ProjectIndex): ResolvedProject {
  const name = deriveNameFromPath(path);
  const known = index.byName.get(name.toLowerCase());
  if (known) return { projectId: known.projectId, projectName: known.projectName, chatId: null, chatName: null };
  return { projectId: null, projectName: name, chatId: null, chatName: null };
}

/** Resolve a session's cwd to a project identity. Pure (unit-tested). */
export function resolveProject(cwdRaw: string | null | undefined, index: ProjectIndex): ResolvedProject {
  if (!cwdRaw) return { projectId: null, projectName: OTHER, chatId: null, chatName: null };
  const cwd = norm(cwdRaw);

  // 1 & 2: known worktree / project path (longest prefix wins).
  for (const e of index.byPath) {
    if (isUnderOrEqual(cwd, e.path)) {
      return { projectId: e.projectId, projectName: e.projectName, chatId: e.chatId, chatName: e.chatName };
    }
  }

  // 3: churro GLOBAL worktree store `<...>/.churrostack/worktrees/<project>/<wt>`
  // — the project name is the segment AFTER `worktrees/`.
  const conv = worktreeConventionName(cwd);
  if (conv) {
    const known = index.byName.get(conv.toLowerCase());
    if (known) return { projectId: known.projectId, projectName: known.projectName, chatId: null, chatName: null };
    return { projectId: null, projectName: conv, chatId: null, chatName: null };
  }

  // 3b: IN-PROJECT tooling dirs `<projectRoot>/.claude/...` or `<projectRoot>/.git/...`
  // (e.g. `.claude/worktrees/<wt>`) — the project root is the part BEFORE the
  // dot-dir, so strip it and re-match / derive from the root.
  const cut = cwd.search(/\/\.(claude|git)\//);
  if (cut > 0) {
    const base = cwd.slice(0, cut);
    for (const e of index.byPath) {
      if (isUnderOrEqual(base, e.path)) {
        return { projectId: e.projectId, projectName: e.projectName, chatId: e.chatId, chatName: e.chatName };
      }
    }
    return deriveResolved(base, index);
  }

  // 4 & 5: derive a name (canonicalized to a known project when it matches), else "Other".
  return deriveResolved(cwd, index);
}

/**
 * Best-effort on-disk base path for a cwd, used to offer an "open folder" link
 * for projects that aren't registered in churro (registered ones use the
 * canonical `projects.path`). Returns null when there's no trustworthy root —
 * a global `.churrostack/worktrees/<proj>` store (no real root on disk) or a
 * bare home dir.
 */
export function projectBasePath(cwdRaw: string | null | undefined, index: ProjectIndex): string | null {
  if (!cwdRaw) return null;
  const cwd = norm(cwdRaw);
  for (const e of index.byPath) if (isUnderOrEqual(cwd, e.path)) return e.path;
  if (worktreeConventionName(cwd)) return null; // global worktree store — no on-disk root we can trust
  const cut = cwd.search(/\/\.(claude|git)\//);
  if (cut > 0) {
    const base = cwd.slice(0, cut);
    return base.split('/').filter(Boolean).length > 2 ? base : null;
  }
  const segs = cwd.split('/').filter(Boolean);
  if (segs.length <= 2) return null; // home dir / volume root
  if (segs[segs.length - 1].startsWith('.')) return null; // dot-dir tail isn't a project root
  return cwd;
}

// projectName → representative base path for DERIVED (non-churro) projects,
// recorded during the rollup so the query can offer an "open folder" link for
// them too. Module-level (same process as the query); shortest path wins (most
// root-like). Persists across rollups; populated on the first scan at startup.
const derivedBasePaths = new Map<string, string>();

export function recordDerivedBasePath(projectName: string, basePath: string | null): void {
  if (!basePath) return;
  const existing = derivedBasePaths.get(projectName);
  if (!existing || basePath.length < existing.length) derivedBasePaths.set(projectName, basePath);
}

export function derivedBasePathFor(projectName: string): string | null {
  return derivedBasePaths.get(projectName) ?? null;
}

/**
 * Cheap content fingerprint of the attribution inputs (project/worktree paths +
 * names + ids, and the session→sub-chat map). The rollup freshness gate folds
 * this in so a project/worktree RENAME or a backfilled session id — which leave
 * row counts unchanged — still trigger a re-attribution, not just file changes.
 */
export function attributionFingerprint(index: ProjectIndex, sessionMap: SessionMap): string {
  let h = 0x811c9dc5; // FNV-1a
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2c; // ';' separator between fields
    h = Math.imul(h, 0x01000193);
  };
  for (const e of index.byPath) {
    mix(e.path);
    mix(e.projectId ?? '');
    mix(e.projectName);
  }
  for (const [k, v] of sessionMap) {
    mix(k);
    mix(v.subChatId);
    mix(v.projectId ?? '');
    mix(v.projectName);
    mix(v.harness ?? '');
  }
  return `${(h >>> 0).toString(36)}:${index.byPath.length}:${sessionMap.size}`;
}

/** Load the project index from the DB (projects + worktree paths). */
export function loadProjectIndex(): ProjectIndex {
  const db = getDatabase();
  const projectRows = db
    .select({ id: projectsTbl.id, name: projectsTbl.name, path: projectsTbl.path })
    .from(projectsTbl)
    .all();
  const worktreeRows = db
    .select({
      chatId: chatsTbl.id,
      chatName: chatsTbl.name,
      projectId: chatsTbl.projectId,
      projectName: projectsTbl.name,
      worktreePath: chatsTbl.worktreePath
    })
    .from(chatsTbl)
    .leftJoin(projectsTbl, eq(chatsTbl.projectId, projectsTbl.id))
    .all();
  return buildProjectIndex(projectRows, worktreeRows);
}

/** Full identity a usage session attributes to, for the project→chat→session tree. */
export interface SessionIdentity {
  /** A churro sub-chat id when the session matched one, else the raw session id. */
  subChatId: string;
  subChatName: string | null;
  harness: string | null;
  chatId: string | null;
  chatName: string | null;
  projectId: string | null;
  projectName: string;
}

/** sessionId → churro sub-chat identity (keyed by both cliSessionId and sessionId). */
export type SessionMap = Map<string, SessionIdentity>;

/** Build the session→sub-chat map from the DB (canonical names for churro sessions). */
export function loadSessionMap(): SessionMap {
  const db = getDatabase();
  const rows = db
    .select({
      id: subChatsTbl.id,
      cliSessionId: subChatsTbl.cliSessionId,
      sessionId: subChatsTbl.sessionId,
      harness: subChatsTbl.harness,
      subChatName: subChatsTbl.name,
      chatId: chatsTbl.id,
      chatName: chatsTbl.name,
      projectId: projectsTbl.id,
      projectName: projectsTbl.name
    })
    .from(subChatsTbl)
    .leftJoin(chatsTbl, eq(subChatsTbl.chatId, chatsTbl.id))
    .leftJoin(projectsTbl, eq(chatsTbl.projectId, projectsTbl.id))
    .all();
  const map: SessionMap = new Map();
  for (const r of rows) {
    const idn: SessionIdentity = {
      subChatId: r.id,
      subChatName: r.subChatName,
      harness: r.harness,
      chatId: r.chatId,
      chatName: r.chatName,
      projectId: r.projectId,
      projectName: r.projectName ?? OTHER
    };
    if (r.cliSessionId) map.set(r.cliSessionId, idn);
    if (r.sessionId) map.set(r.sessionId, idn);
  }
  return map;
}

/**
 * Session ids belonging to BUILTIN sub-chats. Their runtime is captured live
 * (interval-tracker.ts); the JSONL-derived path must skip them to avoid
 * double-counting if the builtin SDK also writes a transcript on disk.
 */
export function loadBuiltinSessionIds(): Set<string> {
  const db = getDatabase();
  const rows = db
    .select({ cliSessionId: subChatsTbl.cliSessionId, sessionId: subChatsTbl.sessionId })
    .from(subChatsTbl)
    .where(inArray(subChatsTbl.harness, ['builtin']))
    .all();
  const set = new Set<string>();
  for (const r of rows) {
    if (r.cliSessionId) set.add(r.cliSessionId);
    if (r.sessionId) set.add(r.sessionId);
  }
  return set;
}

/**
 * Resolve a usage session to its full identity: prefer an exact churro sub-chat
 * match (canonical names), else attribute by cwd → project so terminal usage
 * still lands on the right project.
 */
export function resolveSession(
  sessionId: string | null,
  cwd: string | null,
  source: 'claude' | 'codex',
  sessionMap: SessionMap,
  index: ProjectIndex
): SessionIdentity {
  if (sessionId) {
    const known = sessionMap.get(sessionId);
    if (known) return known;
  }
  const p = resolveProject(cwd, index);
  return {
    subChatId: sessionId ?? `cwd:${cwd ?? 'unknown'}`,
    subChatName: null,
    harness: source === 'codex' ? 'codex-cli' : 'claude-cli',
    chatId: p.chatId,
    chatName: p.chatName,
    projectId: p.projectId,
    projectName: p.projectName
  };
}
