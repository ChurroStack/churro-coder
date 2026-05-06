import { describe, it, expect } from 'vitest';
import { progressColorClass, resolveContextWindow } from './agent-context-indicator';

describe('progressColorClass', () => {
  it.each([
    { percent: 0, expected: 'text-muted-foreground/60' },
    { percent: 0.0001, expected: 'text-green-500' },
    { percent: 40, expected: 'text-green-500' },
    { percent: 40.0001, expected: 'text-yellow-500' },
    { percent: 60, expected: 'text-yellow-500' },
    { percent: 60.0001, expected: 'text-orange-500' },
    { percent: 80, expected: 'text-orange-500' },
    { percent: 80.0001, expected: 'text-red-500' },
    { percent: 100, expected: 'text-red-500' },
    { percent: -5, expected: 'text-muted-foreground/60' }
  ])('returns $expected at $percent%', ({ percent, expected }) => {
    expect(progressColorClass(percent)).toBe(expected);
  });
});

describe('resolveContextWindow', () => {
  it.each([
    { modelId: 'opus', expected: 200_000 },
    { modelId: 'opus[1m]', expected: 1_000_000 },
    { modelId: 'sonnet[1m]', expected: 1_000_000 }
  ])('uses Claude context window for $modelId', ({ modelId, expected }) => {
    expect(resolveContextWindow({ modelId, metadataWindow: 400_000 })).toBe(expected);
  });

  it('uses metadata for unknown model ids', () => {
    expect(resolveContextWindow({ modelId: 'gpt-5.5', metadataWindow: 400_000 })).toBe(400_000);
  });

  it('falls back to 200K for unknown model ids without metadata', () => {
    expect(resolveContextWindow({ modelId: 'gpt-5.5', metadataWindow: undefined })).toBe(200_000);
  });

  it('uses metadata when model id is undefined', () => {
    expect(resolveContextWindow({ modelId: undefined, metadataWindow: 300_000 })).toBe(300_000);
  });

  it('falls back to 200K when neither model id nor metadata exists', () => {
    expect(resolveContextWindow({ modelId: undefined, metadataWindow: undefined })).toBe(200_000);
  });

  it('treats zero metadata as missing', () => {
    expect(resolveContextWindow({ modelId: 'gpt-5.5', metadataWindow: 0 })).toBe(200_000);
  });

  it('treats negative metadata as missing', () => {
    expect(resolveContextWindow({ modelId: undefined, metadataWindow: -1 })).toBe(200_000);
  });
});
