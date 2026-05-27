import { describe, expect, it } from 'vitest';
import { stripClaudeCliEnvelopes } from './cli-text-envelopes';

describe('stripClaudeCliEnvelopes', () => {
  it('removes <local-command-caveat> block', () => {
    const out = stripClaudeCliEnvelopes(
      '<local-command-caveat>Caveat: ignore these messages.</local-command-caveat>'
    );
    expect(out).toBe('');
  });

  it('removes the slash-command envelopes', () => {
    const out = stripClaudeCliEnvelopes(
      '<command-name>/plan</command-name>\n            <command-message>plan</command-message>\n            <command-args></command-args>'
    );
    expect(out).toBe('');
  });

  it('removes <local-command-stdout> block', () => {
    const out = stripClaudeCliEnvelopes('<local-command-stdout>Enabled plan mode</local-command-stdout>');
    expect(out).toBe('');
  });

  it('strips the IMPORTANT MCP reminder, leaving the user prompt', () => {
    const text =
      'IMPORTANT: Pass subChatId: "mpo7kfrwctmyvs53" to every churro-coder MCP tool call. Call write_plan before ExitPlanMode.\ncambiar fondo a dorado';
    expect(stripClaudeCliEnvelopes(text)).toBe('cambiar fondo a dorado');
  });

  it('strips the IMPORTANT line when it comes after some prior text (not at index 0)', () => {
    const text = 'preamble\nIMPORTANT: Pass subChatId: "abc". Reminder details here.\nMy actual prompt.';
    expect(stripClaudeCliEnvelopes(text)).toBe('preamble\nMy actual prompt.');
  });

  it('returns clean text unchanged (idempotent)', () => {
    expect(stripClaudeCliEnvelopes('cambiar fondo a dorado')).toBe('cambiar fondo a dorado');
    expect(stripClaudeCliEnvelopes('')).toBe('');
  });

  it('collapses extra blank lines left behind by strips', () => {
    const out = stripClaudeCliEnvelopes(
      '<local-command-stdout>hi</local-command-stdout>\n\n\n\nreal text\n\n\n<command-args></command-args>'
    );
    expect(out).toBe('real text');
  });
});
