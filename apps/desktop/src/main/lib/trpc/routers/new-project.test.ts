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

vi.mock('../../openspec/openspec-bin-path', () => ({
  assertOpenspecBinAvailable: vi.fn(() => {
    throw new Error('not available');
  })
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
      mutation: (fn: unknown) => ({ _def: { type: 'mutation', resolver: fn } })
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

async function callCreateProject(input: Record<string, unknown>) {
  const resolver = (newProjectRouter as any).createProject._def.resolver;
  return resolver({ input });
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
const MOCK_CHAT = { id: 'chat-1', name: 'test-repo', projectId: 'proj-1', worktreePath: null };
const MOCK_SUBCHAT = { id: 'sub-1', chatId: 'chat-1', mode: 'execute' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRenderTemplate.mockResolvedValue('# content');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createProject — happy path (GitHub)', () => {
  it('creates project, chat, subchat and returns ids', async () => {
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
    mockCreateWorktreeForChat.mockResolvedValue(undefined);
    mockGetDatabase.mockReturnValue(makeChainableDb([MOCK_PROJECT, MOCK_CHAT, MOCK_SUBCHAT]) as any);

    const result = await callCreateProject(BASE_INPUT);

    expect(result).toMatchObject({ projectId: 'proj-1', chatId: 'chat-1', subChatId: 'sub-1' });
    expect(mockCloneIntoRepos).toHaveBeenCalledOnce();
    expect(mockCreateWorktreeForChat).toHaveBeenCalledOnce();
    // git add + commit + push = 3 exec calls
    expect(mockExec).toHaveBeenCalledTimes(3);
    const pushCall = mockExec.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('git push')
    );
    expect(pushCall).toBeTruthy();
  });
});

describe('createProject — push failure triggers rollback', () => {
  it('removes clone dir and re-throws when git push fails', async () => {
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
    mockCreateWorktreeForChat.mockResolvedValue(undefined);
    mockGetDatabase.mockReturnValue(makeChainableDb([MOCK_PROJECT, MOCK_CHAT, MOCK_SUBCHAT]) as any);

    await expect(callCreateProject(BASE_INPUT)).rejects.toThrow('Permission denied');

    // The remove-clone-dir compensator should have run via fs.rm
    const mockRm = vi.mocked(rm);
    expect(mockRm).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
  });
});

describe('createProject — name validation', () => {
  it('rejects empty name before any network call', async () => {
    await expect(callCreateProject({ ...BASE_INPUT, name: '' })).rejects.toThrow('Invalid project name');
    expect(mockGetProviderAdapter).not.toHaveBeenCalled();
  });

  it('rejects names over 100 chars', async () => {
    await expect(callCreateProject({ ...BASE_INPUT, name: 'a'.repeat(101) })).rejects.toThrow('Invalid project name');
  });

  it('rejects reserved name .git', async () => {
    await expect(callCreateProject({ ...BASE_INPUT, name: '.git' })).rejects.toThrow('Invalid project name');
  });
});
