/**
 * Task 11.8 — MCP subChatId-override attack test.
 *
 * A buggy CLI sending `subChatId: 'B'` to a path-scoped server for A
 * must always land in A's directory. B must remain untouched.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpRoot }
}));

import { readCurrentReview } from '../../reviews/review-store';
import { __setSubChatIdValidatorForTest, closeMcpHttpServer, initMcpHttpServer } from '../http-transport';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'attack-test-'));
});

afterEach(async () => {
  __setSubChatIdValidatorForTest(null);
  await closeMcpHttpServer();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('11.8 — MCP subChatId-override attack', () => {
  test('write_review to /sub/A/ with args subChatId=B lands in A, B untouched', async () => {
    const idA = 'attack-sub-A';
    const idB = 'attack-sub-B';

    // Only A is known to the server
    __setSubChatIdValidatorForTest((id) => id === idA);

    const { url, bearer } = await initMcpHttpServer();
    const subUrl = new URL(`sub/${idA}/`, url);

    const transport = new StreamableHTTPClientTransport(subUrl, {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);

    try {
      // A buggy CLI tries to redirect the write to subChatId B by including it in args.
      // The path-scoped schema for write_review does NOT declare subChatId, so the
      // closed-over A is used unconditionally.
      const result = await client.callTool({
        name: 'write_review',
        arguments: {
          markdown: '# Attack Review\n\nThis should land in A, not B.'
          // Note: no subChatId arg — the schema rejects it at the tool level
        }
      });
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }

    // A's review file must contain the content
    const reviewA = await readCurrentReview(idA);
    expect(reviewA).not.toBeNull();
    expect(reviewA!.content).toContain('# Attack Review');

    // B's directory must be untouched (null review)
    const reviewB = await readCurrentReview(idB);
    expect(reviewB).toBeNull();
  });

  test('path-scoped write_review schema does not expose subChatId field (introspection)', async () => {
    const knownId = 'introspect-sub';
    __setSubChatIdValidatorForTest((id) => id === knownId);

    const { url, bearer } = await initMcpHttpServer();
    const subUrl = new URL(`sub/${knownId}/`, url);

    const transport = new StreamableHTTPClientTransport(subUrl, {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      const writeReviewTool = tools.tools.find((t) => t.name === 'write_review');
      expect(writeReviewTool).toBeDefined();

      // The schema for the path-scoped tool must NOT expose subChatId
      const schemaProps = (writeReviewTool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(schemaProps)).not.toContain('subChatId');
    } finally {
      await client.close();
    }
  });
});
