import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { closeMcpHttpServer, initMcpHttpServer } from '../http-transport';
import { writeCurrentPlan } from '../../plans/plan-store';

let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpRoot
  }
}));

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'flow-cross-provider-plan-mcp-'));
});

afterEach(async () => {
  await closeMcpHttpServer();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('cross-provider read_plan flow', () => {
  test('Codex-style HTTP client reads the exact plan persisted by Claude flow', async () => {
    const content = '# Cross Provider Plan\n\n1. Investigate\n2. Implement';
    await writeCurrentPlan({
      subChatId: 'cross-1',
      content,
      source: 'claude:ExitPlanMode',
      title: 'Cross Provider Plan'
    });

    const { url, bearer } = await initMcpHttpServer();
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const client = new Client({ name: 'codex-client', version: '0.0.0' });
    await client.connect(transport);

    try {
      const result = await client.callTool({ name: 'read_plan', arguments: { subChatId: 'cross-1' } });
      expect(result.isError).toBeFalsy();
      const body = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(body).toContain(content);
      expect(body).toContain('Source: claude:ExitPlanMode');
    } finally {
      await client.close();
    }
  });
});
