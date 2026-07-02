import { describe, test, expect } from 'vitest';
import { buildCliInitialInputChunks } from './bootstrap-chunks';

describe('buildCliInitialInputChunks [cli-bootstrap/sequence]', () => {
  test('claude-cli plan mode with opusplan + advisor → full ordered sequence', () => {
    expect(
      buildCliInitialInputChunks({
        harness: 'claude-cli',
        isPlanMode: true,
        bodyChunk: 'hello',
        claudeModelCommand: 'opusplan',
        advisorModel: 'opus'
      })
    ).toEqual([' \r', '/model opusplan\r', '/plan\r', '/advisor opus\r', 'hello', '\r']);
  });

  test('claude-cli execute mode, no opusplan, no advisor → space+CR then body', () => {
    expect(
      buildCliInitialInputChunks({
        harness: 'claude-cli',
        isPlanMode: false,
        bodyChunk: 'hello'
      })
    ).toEqual([' \r', 'hello', '\r']);
  });

  test('claude-cli: /model + /advisor emitted even in execute mode (no /plan)', () => {
    expect(
      buildCliInitialInputChunks({
        harness: 'claude-cli',
        isPlanMode: false,
        bodyChunk: 'hello',
        claudeModelCommand: 'opusplan',
        advisorModel: 'sonnet'
      })
    ).toEqual([' \r', '/model opusplan\r', '/advisor sonnet\r', 'hello', '\r']);
  });

  test('codex-cli plan mode is unchanged (no space+CR, no /model, no /advisor)', () => {
    expect(
      buildCliInitialInputChunks({
        harness: 'codex-cli',
        isPlanMode: true,
        bodyChunk: 'hello',
        // These are ignored for codex.
        claudeModelCommand: 'opusplan',
        advisorModel: 'opus'
      })
    ).toEqual(['/plan\r', 'hello', '\r']);
  });

  test('codex-cli execute mode is unchanged (body + submit only)', () => {
    expect(
      buildCliInitialInputChunks({
        harness: 'codex-cli',
        isPlanMode: false,
        bodyChunk: 'hello'
      })
    ).toEqual(['hello', '\r']);
  });
});
