import { beforeEach, describe, expect, test, vi } from 'vitest';

const captureError = vi.fn();
const redactUnknown = vi.fn((value: unknown) => value);

vi.mock('../analytics', () => ({
  captureError,
  redactUnknown
}));

const { reportTrpcError, shouldCaptureTrpcErrorCode } = await import('./index');

describe('reportTrpcError', () => {
  beforeEach(() => {
    captureError.mockReset();
    redactUnknown.mockClear();
    redactUnknown.mockImplementation((value: unknown) => value);
  });

  test('skips client-caused TRPC codes', () => {
    const error = new Error('missing');

    reportTrpcError({
      code: 'NOT_FOUND',
      error,
      path: 'files.readFile',
      type: 'query',
      input: { filePath: '/tmp/missing.md' }
    });

    expect(shouldCaptureTrpcErrorCode('NOT_FOUND')).toBe(false);
    expect(captureError).not.toHaveBeenCalled();
    expect(redactUnknown).not.toHaveBeenCalled();
  });

  test('captures server-side errors with sanitized context', () => {
    const error = new Error('boom');
    const sanitizedInput = { token: '[KEY]' };
    redactUnknown.mockReturnValueOnce(sanitizedInput);

    reportTrpcError({
      code: 'INTERNAL_SERVER_ERROR',
      error,
      path: 'files.readFile',
      type: 'query',
      input: { token: 'sk-secret-value' }
    });

    expect(shouldCaptureTrpcErrorCode('INTERNAL_SERVER_ERROR')).toBe(true);
    expect(redactUnknown).toHaveBeenCalledWith({ token: 'sk-secret-value' });
    expect(captureError).toHaveBeenCalledWith(error, {
      trpcPath: 'files.readFile',
      trpcType: 'query',
      code: 'INTERNAL_SERVER_ERROR',
      input: sanitizedInput
    });
  });

  test('prefers the underlying cause when present', () => {
    const cause = new Error('root cause');
    const error = Object.assign(new Error('wrapper'), { cause });

    reportTrpcError({
      code: undefined,
      error,
      path: 'files.readFile',
      type: 'query',
      input: null
    });

    expect(captureError).toHaveBeenCalledWith(cause, {
      trpcPath: 'files.readFile',
      trpcType: 'query',
      code: undefined,
      input: null
    });
  });
});
