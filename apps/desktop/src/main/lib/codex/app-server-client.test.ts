import { describe, expect, test, vi } from 'vitest';
import { CodexAppServerClient } from './app-server-client';

describe('CodexAppServerClient activity hook', () => {
  test('fires for notifications, server requests, and responses', async () => {
    const onActivity = vi.fn();
    const onNotification = vi.fn();
    const onServerRequest = vi.fn().mockResolvedValue({});
    const client = new CodexAppServerClient({
      command: 'codex',
      onActivity,
      onNotification,
      onServerRequest
    });
    vi.spyOn(client as any, 'write').mockImplementation(() => {});

    (client as any).handleLine(JSON.stringify({ method: 'turn/started', params: { threadId: 't-1' } }));
    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledTimes(1);

    (client as any).handleLine(JSON.stringify({ id: 1, method: 'item/permissions/requestApproval', params: {} }));
    await Promise.resolve();
    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(onServerRequest).toHaveBeenCalledTimes(1);

    const resolve = vi.fn();
    const reject = vi.fn();
    const timeout = setTimeout(() => {}, 1_000);
    ((client as any).pending as Map<number, unknown>).set(2, { resolve, reject, timeout });
    (client as any).handleLine(JSON.stringify({ id: 2, result: { ok: true } }));

    expect(onActivity).toHaveBeenCalledTimes(3);
    expect(resolve).toHaveBeenCalledWith({ ok: true });
    clearTimeout(timeout);
  });
});
