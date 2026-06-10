import { describe, expect, it } from 'vitest';
import {
  buildProjectIndex,
  resolveProject,
  resolveSession,
  projectBasePath,
  type SessionMap
} from './project-resolver';

const projects = [
  { id: 'p-churro', name: 'churro-coder', path: '/Users/me/Projects/ChurroStack/churro-coder' },
  { id: 'p-trust', name: 'Trustalia', path: '/Users/me/Projects/Trustalia' }
];
const worktrees = [
  {
    chatId: 'c1',
    chatName: 'liquid hollow',
    projectId: 'p-churro',
    projectName: 'churro-coder',
    worktreePath: '/Users/me/.churrostack/worktrees/churro-coder/liquid-hollow'
  }
];
const index = buildProjectIndex(projects, worktrees);

describe('resolveProject [time/project-resolver]', () => {
  it('matches a known worktree path and rolls up to its parent project', () => {
    const r = resolveProject('/Users/me/.churrostack/worktrees/churro-coder/liquid-hollow', index);
    expect(r.projectId).toBe('p-churro');
    expect(r.projectName).toBe('churro-coder');
    expect(r.chatId).toBe('c1');
  });

  it('matches a subdirectory of a known worktree (longest prefix)', () => {
    const r = resolveProject('/Users/me/.churrostack/worktrees/churro-coder/liquid-hollow/apps/desktop', index);
    expect(r.projectId).toBe('p-churro');
  });

  it('matches a known project root path', () => {
    const r = resolveProject('/Users/me/Projects/Trustalia/src', index);
    expect(r.projectId).toBe('p-trust');
    expect(r.projectName).toBe('Trustalia');
  });

  it('uses the churro worktree convention for an unknown worktree, mapping the name to a known project', () => {
    // Not in the worktree table, but the path embeds the project name.
    const r = resolveProject('/Users/me/.churrostack/worktrees/churro-coder/some-other-wt', index);
    expect(r.projectId).toBe('p-churro');
    expect(r.projectName).toBe('churro-coder');
  });

  it('derives a project name for the convention even when the project is unknown', () => {
    const r = resolveProject('/Users/me/.churrostack/worktrees/minesgame/wt-x', index);
    expect(r.projectId).toBeNull();
    expect(r.projectName).toBe('minesgame');
  });

  it('strips an in-project .claude worktree dir and resolves the parent project', () => {
    const r = resolveProject('/Users/me/Projects/Trustalia/.claude/worktrees/relaxed-wing-3e40ce', index);
    expect(r.projectId).toBe('p-trust');
    expect(r.projectName).toBe('Trustalia');
  });

  it('derives the last path segment for an arbitrary project dir', () => {
    const r = resolveProject('/Users/me/Projects/Certhia/AuditPro', index);
    expect(r.projectId).toBeNull();
    expect(r.projectName).toBe('AuditPro');
  });

  it('canonicalizes a derived name to a known project case-insensitively (no fragmentation)', () => {
    // Last-segment "trustalia" matches known project "Trustalia" → roll up, not a separate row.
    const r = resolveProject('/Users/me/elsewhere/trustalia', index);
    expect(r.projectId).toBe('p-trust');
    expect(r.projectName).toBe('Trustalia');
  });

  it('falls back to Other for a bare home dir or unresolvable cwd', () => {
    expect(resolveProject('/Users/me', index).projectName).toBe('Other');
    expect(resolveProject(null, index).projectName).toBe('Other');
    expect(resolveProject('', index).projectName).toBe('Other');
  });
});

describe('projectBasePath [time/project-resolver]', () => {
  it('returns the canonical root for a path under a known project', () => {
    expect(projectBasePath('/Users/me/Projects/Trustalia/src', index)).toBe('/Users/me/Projects/Trustalia');
  });

  it('returns the cwd itself for an arbitrary non-churro repo dir', () => {
    expect(projectBasePath('/Users/me/Projects/Certhia/AuditPro', index)).toBe('/Users/me/Projects/Certhia/AuditPro');
  });

  it('strips an in-project .claude/.git tail to the project root', () => {
    expect(projectBasePath('/Users/me/work/foo/.claude/worktrees/wt', index)).toBe('/Users/me/work/foo');
  });

  it('returns null for a global churro worktree store (no on-disk root)', () => {
    expect(projectBasePath('/Users/me/.churrostack/worktrees/minesgame/wt-x', index)).toBeNull();
  });

  it('returns null for a bare home dir or empty cwd', () => {
    expect(projectBasePath('/Users/me', index)).toBeNull();
    expect(projectBasePath(null, index)).toBeNull();
  });
});

describe('resolveSession [time/project-resolver]', () => {
  const sessionMap: SessionMap = new Map([
    [
      'sess-known',
      {
        subChatId: 'sub-1',
        subChatName: 'my chat',
        harness: 'claude-cli',
        chatId: 'c1',
        chatName: 'liquid hollow',
        projectId: 'p-churro',
        projectName: 'churro-coder'
      }
    ]
  ]);

  it('prefers a churro sub-chat match (canonical names) over cwd', () => {
    const r = resolveSession('sess-known', '/somewhere/else', 'claude', sessionMap, index);
    expect(r.subChatId).toBe('sub-1');
    expect(r.subChatName).toBe('my chat');
    expect(r.projectId).toBe('p-churro');
  });

  it('falls back to cwd attribution for an unknown session and keys by session id', () => {
    const r = resolveSession('sess-x', '/Users/me/Projects/Trustalia', 'codex', sessionMap, index);
    expect(r.subChatId).toBe('sess-x');
    expect(r.projectId).toBe('p-trust');
    expect(r.harness).toBe('codex-cli');
  });

  it('keys by cwd when there is no session id at all', () => {
    const r = resolveSession(null, '/Users/me/Projects/Certhia/AuditPro', 'claude', sessionMap, index);
    expect(r.subChatId).toBe('cwd:/Users/me/Projects/Certhia/AuditPro');
    expect(r.projectName).toBe('AuditPro');
  });
});
