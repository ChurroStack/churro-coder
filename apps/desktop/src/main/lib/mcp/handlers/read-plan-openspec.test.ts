import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const mocks = vi.hoisted(() => ({
  row: null as {
    chatId: string;
    changeId: string | null;
    worktreePath: string | null;
    projectPath: string;
  } | null
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => desktopRoot,
    getPath: (_name: string) => tmpdir(),
    isPackaged: false
  }
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq')
}));

vi.mock('../../db', () => ({
  getDatabase: () => {
    const chain = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      get: () => mocks.row
    };
    return chain;
  },
  subChats: { id: 'subChats.id', chatId: 'subChats.chatId', openspecChangeId: 'subChats.openspecChangeId' },
  chats: { id: 'chats.id', projectId: 'chats.projectId', worktreePath: 'chats.worktreePath' },
  projects: { id: 'projects.id', path: 'projects.path' }
}));

import { registerReadPlanTool } from './read-plan';

async function makeClientServer(boundSubChatId?: string) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerReadPlanTool(server, { boundSubChatId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

async function writeChangeFile(root: string, changeId: string, relPath: string, content: string): Promise<void> {
  const absPath = join(root, 'openspec', 'changes', changeId, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
}

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'read-plan-openspec-test-'));
  mocks.row = {
    chatId: 'chat-1',
    changeId: 'add-test',
    worktreePath: null,
    projectPath: tmpRoot
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('read_plan tool OpenSpec changes', () => {
  test('tool description advertises OpenSpec polymorphism', async () => {
    const { client } = await makeClientServer('sub-1');
    const tools = await client.listTools();
    const readPlanTool = tools.tools.find((t) => t.name === 'read_plan');
    expect(readPlanTool).toBeDefined();
    expect(readPlanTool!.description).toContain('OpenSpec');
    expect(readPlanTool!.description).toContain('openspec instructions apply');
  });

  test('not-bound: row exists but changeId null falls through to no-plan message', async () => {
    mocks.row = { chatId: 'chat-1', changeId: null, worktreePath: null, projectPath: tmpRoot };
    const { client } = await makeClientServer('sub-1');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/No plan has been recorded/);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('reason=not-bound'));
  });

  test('no-subchat: row null returns actionable error with sub-chat id', async () => {
    mocks.row = null;
    const { client } = await makeClientServer('ghost-id');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('ghost-id');
    expect(text).toMatch(/no sub-chat found/i);
    expect(text).toMatch(/Sub-chat id/);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('reason=no-subchat sub=ghost-id'));
  });

  test('change-missing: row bound but change directory absent returns named error', async () => {
    // mocks.row already has changeId='add-test' but we do NOT create the change dir
    const { client } = await makeClientServer('sub-1');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('add-test');
    expect(text).toMatch(/not found|missing/i);
    // Must NOT produce the generic "no plan recorded" message
    expect(text).not.toMatch(/No plan has been recorded/);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('reason=change-missing'));
  });

  test('returns OpenSpec apply context files for a sub-chat bound to a change', async () => {
    await writeChangeFile(tmpRoot, 'add-test', '.openspec.yaml', 'name: spec-driven\nversion: 1\n');
    await writeChangeFile(tmpRoot, 'add-test', 'proposal.md', '# Proposal\n\nAdd the thing.\n');
    await writeChangeFile(tmpRoot, 'add-test', 'design.md', '# Design\n\nUse the existing path.\n');
    await writeChangeFile(
      tmpRoot,
      'add-test',
      'specs/widget/spec.md',
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Widget',
        'The system SHALL show a widget.',
        '',
        '#### Scenario: Widget visible',
        '- **WHEN** the user opens the view',
        '- **THEN** the widget is visible',
        ''
      ].join('\n')
    );
    await writeChangeFile(tmpRoot, 'add-test', 'tasks.md', '## 1. Work\n\n- [ ] 1.1 Implement widget\n');

    const { client } = await makeClientServer('sub-1');
    const result = await client.callTool({ name: 'read_plan', arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('# OpenSpec Change: add-test');
    expect(text).toContain('Source: openspec:spec-driven');
    expect(text).toContain('State: ready');
    expect(text).toContain('Progress: 0/1 tasks complete');
    expect(text).toContain('## proposal: openspec/changes/add-test/proposal.md');
    expect(text).toContain('Add the thing.');
    expect(text).toContain('## design: openspec/changes/add-test/design.md');
    expect(text).toContain('## specs: openspec/changes/add-test/specs/widget/spec.md');
    expect(text).toContain('## tasks: openspec/changes/add-test/tasks.md');
    expect(text).toContain('- [ ] 1.1 Implement widget');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('source=openspec found=true'));
  });
});

describe('read_plan OpenSpec — unbound (Codex HTTP-equivalent) flow', () => {
  test('passing the correct subChatId UUID returns the OpenSpec context', async () => {
    await writeChangeFile(tmpRoot, 'add-test', '.openspec.yaml', 'name: spec-driven\nversion: 1\n');
    await writeChangeFile(tmpRoot, 'add-test', 'proposal.md', '# Proposal\n\nThe feature.\n');
    await writeChangeFile(tmpRoot, 'add-test', 'tasks.md', '## 1. Work\n\n- [ ] 1.1 Do the thing\n');

    // Unbound server: agent must pass subChatId explicitly (simulates Codex HTTP transport)
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({ name: 'read_plan', arguments: { subChatId: 'sub-1' } });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('# OpenSpec Change: add-test');
    expect(text).toContain('The feature.');
    expect(text).toContain('- [ ] 1.1 Do the thing');
  });

  test('passing changeId instead of subChatId returns actionable no-subchat error', async () => {
    // Simulate the regression: agent guesses changeId as subChatId
    // mocks.row is null when queried with 'add-test' (not a real subChatId UUID)
    mocks.row = null;
    const { client } = await makeClientServer(undefined);
    const result = await client.callTool({ name: 'read_plan', arguments: { subChatId: 'add-test' } });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('add-test');
    expect(text).toMatch(/no sub-chat found/i);
    // Must NOT produce the "no plan recorded" message
    expect(text).not.toMatch(/No plan has been recorded/);
  });
});
