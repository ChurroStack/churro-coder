import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// All vi.mock calls are hoisted by vitest — factories must NOT reference outer variables.

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? '/tmp/test-home' : '/tmp/test-userdata'),
    getAppPath: () => '/tmp/test-app',
    on: vi.fn(),
    getName: () => 'test',
    getVersion: () => '0.0.0'
  },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}));

vi.mock('../../db', () => ({
  getDatabase: vi.fn(),
  projects: {},
  chats: {},
  subChats: {}
}));

vi.mock('../../providers/index', () => ({
  getProviderAdapter: vi.fn()
}));

vi.mock('../../providers/detect-cache', () => ({
  evict: vi.fn()
}));

vi.mock('../../git/clone-into-repos', () => ({
  cloneIntoRepos: vi.fn()
}));

vi.mock('../../git', () => ({
  getGitRemoteInfo: vi.fn()
}));

vi.mock('../../git/worktree', () => ({
  createWorktreeForChat: vi.fn()
}));

vi.mock('../../providers/templates', () => ({
  renderTemplate: vi.fn().mockResolvedValue('# content')
}));

vi.mock('../../analytics', () => ({
  trackProjectCreated: vi.fn()
}));

vi.mock('../../platform/index', () => ({
  isWindows: vi.fn(() => false),
  isMacOS: vi.fn(() => true)
}));

vi.mock('../../openspec/openspec-bin-path', () => {
  class OpenspecBundleMissingError extends Error {
    constructor(binDir: string) {
      super(`OpenSpec CLI bundle not found at ${binDir}.`);
      this.name = 'OpenspecBundleMissingError';
    }
  }
  return {
    assertOpenspecBinAvailable: vi.fn(),
    OpenspecBundleMissingError
  };
});

vi.mock('../../openspec/run-openspec-cli', () => ({
  runOpenspecCli: vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false)
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  symlink: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('content'),
  rm: vi.fn().mockResolvedValue(undefined)
}));

// exec mock — the implementation is swapped per-test via mockExec.mockImplementation()
vi.mock('node:child_process', () => ({
  exec: vi.fn()
}));

vi.mock('../index', () => ({
  publicProcedure: {
    input: (_schema: unknown) => ({
      query: (fn: unknown) => ({ _def: { type: 'query', resolver: fn } }),
      mutation: (fn: unknown) => ({ _def: { type: 'mutation', resolver: fn } }),
      subscription: (fn: unknown) => ({ _def: { type: 'subscription', resolver: fn } })
    })
  },
  router: (routes: unknown) => routes
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}));

// ── Retrieve mocked functions after hoisted mocks are resolved ────────────────
import { getDatabase } from '../../db';
import { getProviderAdapter } from '../../providers/index';
import { cloneIntoRepos } from '../../git/clone-into-repos';
import { getGitRemoteInfo } from '../../git';
import { createWorktreeForChat } from '../../git/worktree';
import { exec } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { renderTemplate } from '../../providers/templates';
import { newProjectRouter } from './new-project';
import type { NewProjectEvent } from './new-project';
import { runOpenspecCli } from '../../openspec/run-openspec-cli';
import { assertOpenspecBinAvailable, OpenspecBundleMissingError } from '../../openspec/openspec-bin-path';

const mockGetDatabase = vi.mocked(getDatabase);
const mockGetProviderAdapter = vi.mocked(getProviderAdapter);
const mockCloneIntoRepos = vi.mocked(cloneIntoRepos);
const mockGetGitRemoteInfo = vi.mocked(getGitRemoteInfo);
const mockCreateWorktreeForChat = vi.mocked(createWorktreeForChat);
const mockExec = vi.mocked(
  exec as unknown as (
    cmd: string,
    opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void
  ) => void
);
const mockRenderTemplate = vi.mocked(renderTemplate);
const mockRunOpenspecCli = vi.mocked(runOpenspecCli);
const mockAssertOpenspecBinAvailable = vi.mocked(assertOpenspecBinAvailable);

// ── DB helper ─────────────────────────────────────────────────────────────────

function makeChainableDb(getQueue: unknown[]) {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    get: vi.fn().mockImplementation(() => getQueue.shift()),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    run: vi.fn()
  };
  return db;
}

// ── Adapter stub ──────────────────────────────────────────────────────────────

function makeAdapter(createRepoResult: object) {
  return {
    detectCli: vi.fn(),
    checkAuth: vi.fn(),
    listAccounts: vi.fn(),
    listProjects: vi.fn(),
    createRepo: vi.fn().mockResolvedValue(createRepoResult),
    getCloneUrl: vi.fn(() => null)
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

async function callCreateProject(input: Record<string, unknown>): Promise<NewProjectEvent[]> {
  const resolver = (newProjectRouter as any).createProject._def.resolver;
  const obs = resolver({ input });
  const events: NewProjectEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    obs.subscribe({
      next: (event: NewProjectEvent) => events.push(event),
      error: reject,
      complete: resolve
    });
  });
  return events;
}

function getCompleteEvent(events: NewProjectEvent[]) {
  return events.find((e) => e.type === 'complete') as Extract<NewProjectEvent, { type: 'complete' }> | undefined;
}

function getFatalEvent(events: NewProjectEvent[]) {
  return events.find((e) => e.type === 'fatal') as Extract<NewProjectEvent, { type: 'fatal' }> | undefined;
}

function setupExecSuccess() {
  mockExec.mockImplementation((_cmd, _opts, cb) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    (callback as (err: null, stdout: string, stderr: string) => void)(null, '', '');
  });
}

const BASE_INPUT = {
  provider: 'github' as const,
  accountId: 'user',
  name: 'test-repo',
  description: 'A test repo',
  visibility: 'private' as const,
  openspecInit: false,
  prompt: 'Build something great',
  correlationId: 'test-cid-123'
};

const MOCK_PROJECT = { id: 'proj-1', name: 'test-repo', path: '/tmp/repos/user/test-repo' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRenderTemplate.mockResolvedValue('# content');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createProject — happy path (GitHub)', () => {
  it('creates project row and emits complete with projectId only (no chat / worktree)', async () => {
    setupExecSuccess();
    mockGetProviderAdapter.mockReturnValue(
      makeAdapter({ ok: true, cloneUrl: 'https://github.com/user/test-repo.git' }) as any
    );
    mockCloneIntoRepos.mockResolvedValue({ clonePath: '/tmp/repos/user/test-repo', alreadyExisted: false });
    mockGetGitRemoteInfo.mockResolvedValue({
      remoteUrl: 'https://github.com/user/test-repo.git',
      provider: 'github',
      owner: 'user',
      repo: 'test-repo',
      project: null
    });
    const db = makeChainableDb([MOCK_PROJECT]);
    mockGetDatabase.mockReturnValue(db as any);

    const events = await callCreateProject(BASE_INPUT);
    const complete = getCompleteEvent(events);

    expect(complete).toMatchObject({ projectId: 'proj-1', path: '/tmp/repos/user/test-repo' });
    // complete event must NOT carry chat/subChat ids — the wizard lands on New workspace
    expect(complete as object).not.toHaveProperty('chatId');
    expect(complete as object).not.toHaveProperty('subChatId');
    expect(mockCloneIntoRepos).toHaveBeenCalledOnce();
    expect(mockCreateWorktreeForChat).not.toHaveBeenCalled();
    // Only the project row is inserted — no chats, no subChats
    expect(db.insert).toHaveBeenCalledTimes(1);
    // git add + commit + symbolic-ref (resolve branch) + push = 4 exec calls
    expect(mockExec).toHaveBeenCalledTimes(4);
    const branchCall = mockExec.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('git symbolic-ref')
    );
    expect(branchCall).toBeTruthy();
    const pushCall = mockExec.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('git push')
    );
    expect(pushCall).toBeTruthy();
  });
});

describe('createProject — push failure triggers rollback', () => {
  it('removes clone dir and emits fatal event when git push fails', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, cb?: unknown) => {
      const callback = (typeof _opts === 'function' ? _opts : cb) as (
        err: Error | null,
        stdout: string,
        stderr: string
      ) => void;
      if (typeof _cmd === 'string' && (_cmd as string).includes('git push')) {
        callback(new Error('Permission denied (publickey)'), '', 'error');
      } else {
        callback(null, '', '');
      }
    });

    mockGetProviderAdapter.mockReturnValue(
      makeAdapter({ ok: true, cloneUrl: 'https://github.com/user/test-repo.git' }) as any
    );
    mockCloneIntoRepos.mockResolvedValue({ clonePath: '/tmp/repos/user/test-repo', alreadyExisted: false });
    mockGetGitRemoteInfo.mockResolvedValue({
      remoteUrl: 'https://github.com/user/test-repo.git',
      provider: 'github',
      owner: 'user',
      repo: 'test-repo',
      project: null
    });
    mockGetDatabase.mockReturnValue(makeChainableDb([MOCK_PROJECT]) as any);

    const events = await callCreateProject(BASE_INPUT);
    const fatal = getFatalEvent(events);

    expect(fatal).toBeDefined();
    expect(fatal!.message).toContain('Permission denied');

    // The remove-clone-dir compensator should have run via fs.rm
    const mockRm = vi.mocked(rm);
    expect(mockRm).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
  });
});

describe('createProject — local provider', () => {
  const LOCAL_INPUT = {
    provider: 'local' as const,
    accountId: 'local',
    name: 'my-local-app',
    openspecInit: false,
    prompt: 'Build something great locally',
    correlationId: 'test-cid-local'
  };

  it('uses git init instead of clone and skips push; no chat / worktree created', async () => {
    setupExecSuccess();
    const db = makeChainableDb([
      { id: 'proj-local', name: 'my-local-app', path: '/tmp/test-home/.churrostack/repos/local/my-local-app' }
    ]);
    mockGetDatabase.mockReturnValue(db as any);
    mockGetGitRemoteInfo.mockResolvedValue({ remoteUrl: null, provider: null, owner: null, repo: null, project: null });

    const events = await callCreateProject(LOCAL_INPUT);
    const complete = getCompleteEvent(events);

    expect(complete).toMatchObject({
      projectId: 'proj-local',
      path: '/tmp/test-home/.churrostack/repos/local/my-local-app'
    });
    expect(mockCloneIntoRepos).not.toHaveBeenCalled();
    expect(mockCreateWorktreeForChat).not.toHaveBeenCalled();
    const initCall = mockExec.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('git init')
    );
    expect(initCall).toBeTruthy();
    const pushCall = mockExec.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('git push')
    );
    expect(pushCall).toBeFalsy();
  });
});

describe('createProject — openspecInit true', () => {
  it('runs openspec init in clonePath BEFORE git commit', async () => {
    // Record relative order of openspec CLI vs. exec (git) calls
    const callOrder: string[] = [];
    mockAssertOpenspecBinAvailable.mockImplementation(() => {});
    mockRunOpenspecCli.mockImplementation(async () => {
      callOrder.push('openspec');
      return { stdout: '', stderr: '' };
    });
    mockExec.mockImplementation((cmd: unknown, _opts: unknown, cb?: unknown) => {
      const callback = (typeof _opts === 'function' ? _opts : cb) as (
        err: Error | null,
        stdout: string,
        stderr: string
      ) => void;
      if (typeof cmd === 'string') callOrder.push(`exec:${cmd}`);
      callback(null, '', '');
    });

    mockGetProviderAdapter.mockReturnValue(
      makeAdapter({ ok: true, cloneUrl: 'https://github.com/user/test-repo.git' }) as any
    );
    mockCloneIntoRepos.mockResolvedValue({ clonePath: '/tmp/repos/user/test-repo', alreadyExisted: false });
    mockGetGitRemoteInfo.mockResolvedValue({
      remoteUrl: 'https://github.com/user/test-repo.git',
      provider: 'github',
      owner: 'user',
      repo: 'test-repo',
      project: null
    });
    const db = makeChainableDb([MOCK_PROJECT]);
    mockGetDatabase.mockReturnValue(db as any);

    const events = await callCreateProject({ ...BASE_INPUT, openspecInit: true });

    expect(getCompleteEvent(events)).toBeDefined();
    expect(mockRunOpenspecCli).toHaveBeenCalledOnce();
    // runs in clonePath, not a worktree path
    expect(mockRunOpenspecCli).toHaveBeenCalledWith(
      ['init', '--tools', 'claude,codex', '--profile', 'core'],
      '/tmp/repos/user/test-repo'
    );
    // openspec must run before `git add` and `git commit`
    const openspecIdx = callOrder.indexOf('openspec');
    const gitAddIdx = callOrder.findIndex((c) => c.includes('git add'));
    const gitCommitIdx = callOrder.findIndex((c) => c.includes('git commit'));
    expect(openspecIdx).toBeGreaterThanOrEqual(0);
    expect(openspecIdx).toBeLessThan(gitAddIdx);
    expect(openspecIdx).toBeLessThan(gitCommitIdx);
    // Only the project row is inserted — no chat, no worktree
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(mockCreateWorktreeForChat).not.toHaveBeenCalled();
  });

  it('continues with templates-only commit when openspec init fails (non-fatal)', async () => {
    mockAssertOpenspecBinAvailable.mockImplementation(() => {
      throw new Error('openspec not installed');
    });
    setupExecSuccess();
    mockGetProviderAdapter.mockReturnValue(
      makeAdapter({ ok: true, cloneUrl: 'https://github.com/user/test-repo.git' }) as any
    );
    mockCloneIntoRepos.mockResolvedValue({ clonePath: '/tmp/repos/user/test-repo', alreadyExisted: false });
    mockGetGitRemoteInfo.mockResolvedValue({
      remoteUrl: 'https://github.com/user/test-repo.git',
      provider: 'github',
      owner: 'user',
      repo: 'test-repo',
      project: null
    });
    const db = makeChainableDb([MOCK_PROJECT]);
    mockGetDatabase.mockReturnValue(db as any);

    const events = await callCreateProject({ ...BASE_INPUT, openspecInit: true });

    // Completes successfully; openspec-init step is reported as 'error' but not fatal
    expect(getCompleteEvent(events)).toBeDefined();
    expect(getFatalEvent(events)).toBeUndefined();
    const openspecErrorEvent = events.find(
      (e) => e.type === 'step' && e.step === 'openspec-init' && e.status === 'error'
    );
    expect(openspecErrorEvent).toBeDefined();
    // Only the project row is inserted — no chat insert occurs
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(mockCreateWorktreeForChat).not.toHaveBeenCalled();
  });

  it('flags bundle-missing with a more actionable error message than a transient CLI error', async () => {
    mockAssertOpenspecBinAvailable.mockImplementation(() => {
      throw new OpenspecBundleMissingError('/fake/bin/dir');
    });
    setupExecSuccess();
    mockGetProviderAdapter.mockReturnValue(
      makeAdapter({ ok: true, cloneUrl: 'https://github.com/user/test-repo.git' }) as any
    );
    mockCloneIntoRepos.mockResolvedValue({ clonePath: '/tmp/repos/user/test-repo', alreadyExisted: false });
    mockGetGitRemoteInfo.mockResolvedValue({
      remoteUrl: 'https://github.com/user/test-repo.git',
      provider: 'github',
      owner: 'user',
      repo: 'test-repo',
      project: null
    });
    mockCreateWorktreeForChat.mockResolvedValue({
      success: true,
      worktreePath: '/tmp/worktrees/test-repo/branch-1',
      branch: 'branch-1',
      baseBranch: 'main'
    });
    mockGetDatabase.mockReturnValue(makeChainableDb([MOCK_PROJECT]) as any);

    const events = await callCreateProject({ ...BASE_INPUT, openspecInit: true });

    // Bundle-missing should still be non-fatal — overall flow completes.
    expect(getCompleteEvent(events)).toBeDefined();
    expect(getFatalEvent(events)).toBeUndefined();
    const openspecErrorEvent = events.find(
      (e): e is Extract<NewProjectEvent, { type: 'step' }> =>
        e.type === 'step' && e.step === 'openspec-init' && e.status === 'error'
    );
    expect(openspecErrorEvent).toBeDefined();
    // Message must clearly call out the missing bundle so the UI can render an actionable hint.
    expect(openspecErrorEvent!.message).toMatch(/bundle missing/i);
  });
});

describe('createProject — name validation', () => {
  it('rejects empty name before any network call', async () => {
    const events = await callCreateProject({ ...BASE_INPUT, name: '' });
    const fatal = getFatalEvent(events);
    expect(fatal).toBeDefined();
    expect(fatal!.message).toContain('Invalid project name');
    expect(mockGetProviderAdapter).not.toHaveBeenCalled();
  });

  it('rejects names over 100 chars', async () => {
    const events = await callCreateProject({ ...BASE_INPUT, name: 'a'.repeat(101) });
    const fatal = getFatalEvent(events);
    expect(fatal).toBeDefined();
    expect(fatal!.message).toContain('Invalid project name');
  });

  it('rejects reserved name .git', async () => {
    const events = await callCreateProject({ ...BASE_INPUT, name: '.git' });
    const fatal = getFatalEvent(events);
    expect(fatal).toBeDefined();
    expect(fatal!.message).toContain('Invalid project name');
  });
});
