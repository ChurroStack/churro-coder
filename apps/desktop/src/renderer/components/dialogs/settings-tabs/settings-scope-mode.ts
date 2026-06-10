/**
 * Scope a settings management tab (Skills / Agents / MCP) renders for.
 *
 * - `global` — the tab lives in the global Settings dialog and edits only
 *   user/global-scoped items (`~/.claude/...`). No project section.
 * - `project` — the tab is embedded in a workspace's Project Settings panel and
 *   edits only that path's project-scoped items (`<path>/.claude/...`). The
 *   `path` is the scope root: the worktree's own working tree for Skills/Agents
 *   (committable with the branch), or the base-repo path for MCP (which the CLI
 *   keys per-project in `~/.claude.json` and shares across the repo's worktrees).
 *
 * One union drives both surfaces so the list/detail/create UI is written once.
 */
export type SettingsScopeMode = { kind: 'global' } | { kind: 'project'; path: string; projectName?: string };

/** Default mode for the global Settings dialog usages. */
export const GLOBAL_SCOPE_MODE: SettingsScopeMode = { kind: 'global' };
