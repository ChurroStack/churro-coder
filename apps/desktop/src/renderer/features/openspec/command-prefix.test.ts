import { describe, expect, test } from 'vitest';
import { isOpenSpecCommandLine, openSpecCommandPrefix } from './command-prefix';

describe('openSpecCommandPrefix', () => {
  test('claude-cli and builtin use /opsx:<verb>', () => {
    for (const harness of ['claude-cli', 'builtin'] as const) {
      expect(openSpecCommandPrefix('propose', harness)).toBe('/opsx:propose');
      expect(openSpecCommandPrefix('apply', harness)).toBe('/opsx:apply');
      expect(openSpecCommandPrefix('archive', harness)).toBe('/opsx:archive');
      expect(openSpecCommandPrefix('verify', harness)).toBe('/opsx:verify');
      expect(openSpecCommandPrefix('explore', harness)).toBe('/opsx:explore');
    }
  });

  test('codex-cli maps to $openspec-* skill invocations with -change suffix on apply/archive/verify', () => {
    expect(openSpecCommandPrefix('propose', 'codex-cli')).toBe('$openspec-propose');
    expect(openSpecCommandPrefix('apply', 'codex-cli')).toBe('$openspec-apply-change');
    expect(openSpecCommandPrefix('archive', 'codex-cli')).toBe('$openspec-archive-change');
    expect(openSpecCommandPrefix('verify', 'codex-cli')).toBe('$openspec-verify-change');
    expect(openSpecCommandPrefix('explore', 'codex-cli')).toBe('$openspec-explore');
  });
});

describe('isOpenSpecCommandLine', () => {
  test('recognises /opsx: and $openspec- prefixes', () => {
    expect(isOpenSpecCommandLine('/opsx:apply')).toBe(true);
    expect(isOpenSpecCommandLine('/opsx:propose foo')).toBe(true);
    expect(isOpenSpecCommandLine('$openspec-apply-change')).toBe(true);
    expect(isOpenSpecCommandLine('$openspec-propose foo')).toBe(true);
  });

  test('returns false for other content', () => {
    expect(isOpenSpecCommandLine('hello')).toBe(false);
    expect(isOpenSpecCommandLine('/plan')).toBe(false);
    expect(isOpenSpecCommandLine('$other')).toBe(false);
  });
});
