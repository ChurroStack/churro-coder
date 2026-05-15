/**
 * Task 11.9 — Cross-subChat MCP scope leak.
 *
 * Two simultaneous MCP sessions to /sub/A/ and /sub/B/ must each receive
 * only their own plan body. The server must construct distinct McpServer
 * instances per route — not a shared memoized singleton.
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

import { writeCurrentPlan } from '../../plans/plan-store';
import { __setSubChatIdValidatorForTest, closeMcpHttpServer, initMcpHttpServer } from '../http-transport';

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'scope-leak-test-'));
});

afterEach(async () => {
  __setSubChatIdValidatorForTest(null);
  await closeMcpHttpServer();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('11.9 — cross-subChat MCP scope leak', () => {
  test('concurrent read_plan sessions for A and B return only their own plan body', async () => {
    const idA = 'scope-A';
    const idB = 'scope-B';

    await writeCurrentPlan({ subChatId: idA, content: '# Plan for A', source: 'test', title: 'A' });
    await writeCurrentPlan({ subChatId: idB, content: '# Plan for B', source: 'test', title: 'B' });

    __setSubChatIdValidatorForTest((id) => id === idA || id === idB);

    const { url, bearer } = await initMcpHttpServer();

    const callReadPlan = async (subChatId: string) => {
      const subUrl = new URL(`sub/${subChatId}/`, url);
      const transport = new StreamableHTTPClientTransport(subUrl, {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
      });
      const client = new Client({ name: `test-client-${subChatId}`, version: '0.0.0' });
      await client.connect(transport);
      try {
        // read_plan on path-scoped route has no subChatId arg — uses closed-over id
        const result = await client.callTool({ name: 'read_plan', arguments: {} });
        const content = result.content as Array<{ type: string; text: string }>;
        return content[0].text;
      } finally {
        await client.close();
      }
    };

    // Run both concurrently
    const [textA, textB] = await Promise.all([callReadPlan(idA), callReadPlan(idB)]);

    expect(textA).toContain('# Plan for A');
    expect(textA).not.toContain('# Plan for B');

    expect(textB).toContain('# Plan for B');
    expect(textB).not.toContain('# Plan for A');
  });
});
