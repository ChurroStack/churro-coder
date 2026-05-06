import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Log } from '@sentry/core';

const isDebugSession = vi.fn(() => false);

vi.mock('./debug-session', () => ({
  isDebugSession
}));

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  close: vi.fn(),
  getClient: vi.fn(),
  electronContextIntegration: vi.fn(() => ({})),
  additionalContextIntegration: vi.fn(() => ({})),
  electronBreadcrumbsIntegration: vi.fn(() => ({})),
  normalizePathsIntegration: vi.fn(() => ({})),
  consoleLoggingIntegration: vi.fn(() => ({}))
}));

vi.mock('electron', () => ({
  default: {},
  app: {
    isPackaged: true,
    getPath: vi.fn(),
    getVersion: vi.fn(() => '1.0.0-test')
  }
}));

const { sanitizeLogForSend } = await import('./analytics');

describe('sanitizeLogForSend', () => {
  beforeEach(() => {
    isDebugSession.mockReset();
    isDebugSession.mockReturnValue(false);
  });

  test('drops warn logs in packaged builds when debug session is off', () => {
    const log = {
      level: 'warn',
      message: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
      attributes: { email: 'user@example.com' }
    } satisfies Log;

    expect(sanitizeLogForSend(log)).toBeNull();
  });

  test('keeps and redacts warn logs when debug session is on', () => {
    isDebugSession.mockReturnValue(true);
    const log = {
      level: 'warn',
      message: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
      attributes: { email: 'user@example.com' }
    } satisfies Log;

    const sanitized = sanitizeLogForSend(log);

    expect(sanitized).not.toBeNull();
    expect(JSON.stringify(sanitized)).not.toContain('user@example.com');
    expect(JSON.stringify(sanitized)).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz123456');
  });

  test('keeps and redacts error logs even when debug session is off', () => {
    const log = {
      level: 'error',
      message: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
      attributes: { email: 'user@example.com' }
    } satisfies Log;

    const sanitized = sanitizeLogForSend(log);

    expect(sanitized).not.toBeNull();
    expect(JSON.stringify(sanitized)).not.toContain('user@example.com');
    expect(JSON.stringify(sanitized)).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz123456');
  });
});
