import { describe, expect, test, vi } from 'vitest';
import { CodexAppServerClient, buildCodexAppServerInitializeParams } from './app-server-client';
import { CODEX_APP_SERVER_OPT_OUT_NOTIFICATION_METHODS } from './notification-opt-out';

describe('CodexAppServerClient activity hook', () => {
  test('fires for notifications, server requests, and responses', async () => {
    const onActivity = vi.fn();
    const onNotification = vi.fn();
    const onServerRequest = vi.fn().mockResolvedValue({});
    const client = new CodexAppServerClient({
      command: 'codex',
      clientInfoVersion: '9.9.9-test',
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

  test('builds initialize params with the app version and curated opt-outs', () => {
    expect(buildCodexAppServerInitializeParams('9.9.9-test')).toEqual({
      clientInfo: {
        name: 'churro-coder',
        title: 'Churro Coder',
        version: '9.9.9-test'
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: CODEX_APP_SERVER_OPT_OUT_NOTIFICATION_METHODS
      }
    });
  });
});
