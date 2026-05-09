import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpServerForSubChat } from '../server';
import { hasReview, readCurrentReview, writeCurrentReview } from '../../reviews/review-store';
import { closeMcpHttpServer, initMcpHttpServer } from '../http-transport';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

async function connectBoundClient(subChatId: string) {
  const server = createMcpServerForSubChat(subChatId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'flow-review-mcp-persistence-'));
});

afterEach(async () => {
  await closeMcpHttpServer();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('review MCP persistence flow', () => {
  test('bound write_review persists the review to disk', async () => {
    const client = await connectBoundClient('write-1');
    try {
      const result = await client.callTool({
        name: 'write_review',
        arguments: { markdown: '# Code Review\n\n- Looks solid', title: 'Code Review' }
      });
      expect(result.isError).toBeFalsy();

      expect(await hasReview('write-1')).toBe(true);
      const stored = await readCurrentReview('write-1');
      expect(stored?.content).toBe('# Code Review\n\n- Looks solid');
      expect(stored?.meta.title).toBe('Code Review');
      expect(stored?.meta.source).toBe('claude-sdk');
    } finally {
      await client.close();
    }
  });

  test('bound write_review extracts title from heading when omitted', async () => {
    const client = await connectBoundClient('write-2');
    try {
      const result = await client.callTool({
        name: 'write_review',
        arguments: { markdown: '# Inferred Title\n\nbody' }
      });
      expect(result.isError).toBeFalsy();

      const stored = await readCurrentReview('write-2');
      expect(stored?.meta.title).toBe('Inferred Title');
    } finally {
      await client.close();
    }
  });

  test('bound read_review returns the previously persisted review', async () => {
    await writeCurrentReview({
      subChatId: 'persist-1',
      content: '# Persisted Review\n\n- Step one',
      source: 'claude-sdk',
      title: 'Persisted Review'
    });

    const client = await connectBoundClient('persist-1');
    try {
      const result = await client.callTool({ name: 'read_review', arguments: {} });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('# Persisted Review');
      expect(content[0].text).toContain('Step one');
    } finally {
      await client.close();
    }
  });

  test('bound read_review surfaces an error when no review exists', async () => {
    const client = await connectBoundClient('empty-1');
    try {
      const result = await client.callTool({ name: 'read_review', arguments: {} });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toMatch(/No review/);
    } finally {
      await client.close();
    }
  });

  test('HTTP write_review + read_review round-trip with explicit subChatId', async () => {
    const { url, bearer } = await initMcpHttpServer();
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);

    try {
      const writeResult = await client.callTool({
        name: 'write_review',
        arguments: { subChatId: 'http-1', markdown: '# HTTP Review\n\nbody' }
      });
      expect(writeResult.isError).toBeFalsy();
      const stored = await readCurrentReview('http-1');
      expect(stored?.content).toContain('# HTTP Review');
      expect(stored?.meta.source).toBe('codex-http');

      const readResult = await client.callTool({
        name: 'read_review',
        arguments: { subChatId: 'http-1' }
      });
      expect(readResult.isError).toBeFalsy();
      const content = readResult.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('# HTTP Review');
    } finally {
      await client.close();
    }
  });
});
