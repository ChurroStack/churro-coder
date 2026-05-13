import { describe, it, expect, vi } from 'vitest';
import { expandOpsxCommand } from './prompt-expansion';

// Minimal stub: returns a recognisable marker so tests can assert expansion happened.
function makeRenderer(suffix = '') {
  return (key: string) => `[TEMPLATE:${key}]${suffix} $ARGUMENTS`;
}

const CHANGE_PATH = '/path/to/change';

describe('expandOpsxCommand', () => {
  describe('non-opsx inputs — must be returned unchanged', () => {
    it('returns plain text unchanged', () => {
      const msg = 'Please help me fix the bug';
      expect(expandOpsxCommand(msg, null, makeRenderer())).toBe(msg);
    });

    it('returns an unrelated slash command unchanged', () => {
      const msg = '/review the PR';
      expect(expandOpsxCommand(msg, null, makeRenderer())).toBe(msg);
    });

    it('returns /help unchanged', () => {
      const msg = '/help';
      expect(expandOpsxCommand(msg, null, makeRenderer())).toBe(msg);
    });

    it('returns empty string unchanged', () => {
      expect(expandOpsxCommand('', null, makeRenderer())).toBe('');
    });

    it('returns a message that contains /opsx: mid-sentence unchanged', () => {
      const msg = 'Run /opsx:propose later';
      expect(expandOpsxCommand(msg, null, makeRenderer())).toBe(msg);
    });

    it('does not expand an unknown opsx command like /opsx:unknown', () => {
      const msg = '/opsx:unknown foo';
      expect(expandOpsxCommand(msg, null, makeRenderer())).toBe(msg);
    });
  });

  describe('leading whitespace — must still match', () => {
    it('matches when the command has leading spaces', () => {
      const result = expandOpsxCommand('  /opsx:apply', null, makeRenderer());
      expect(result).toContain('[TEMPLATE:openspec/apply]');
    });

    it('matches when the command has a leading newline', () => {
      const result = expandOpsxCommand('\n/opsx:verify', null, makeRenderer());
      expect(result).toContain('[TEMPLATE:openspec/verify]');
    });
  });

  describe('[step:…] prefix — must NOT match (caller must strip it first)', () => {
    it('does not expand when prefixed with [step:proposal]', () => {
      const msg = '[step:proposal]\n/opsx:apply';
      // trimStart() only strips whitespace; the step prefix stays, so no match.
      expect(expandOpsxCommand(msg, null, makeRenderer())).toBe(msg);
    });
  });

  describe('propose command', () => {
    it('calls the renderer with openspec/propose', () => {
      const render = vi.fn().mockReturnValue('PROPOSE_TEMPLATE $ARGUMENTS');
      expandOpsxCommand('/opsx:propose add-auth', null, render);
      expect(render).toHaveBeenCalledWith('openspec/propose');
    });

    it('substitutes $ARGUMENTS with the changeId arg', () => {
      const render = (key: string) => `[${key}] for $ARGUMENTS`;
      const result = expandOpsxCommand('/opsx:propose add-auth', null, render);
      expect(result).toContain('for add-auth');
      expect(result).not.toContain('$ARGUMENTS');
    });

    it('injects changePath context when openSpecChangePath is set', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:propose add-auth', CHANGE_PATH, render);
      expect(result).toContain('The OpenSpec change directory already exists');
      expect(result).toContain(CHANGE_PATH);
    });

    it('does NOT inject changePath context when openSpecChangePath is null', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:propose add-auth', null, render);
      expect(result).not.toContain('The OpenSpec change directory');
    });

    it('appends user text after the template', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:propose add-auth\n\nPlease keep it simple', null, render);
      const parts = result.split('\n\n');
      expect(parts[0]).toContain('[TEMPLATE:openspec/propose]');
      expect(parts[parts.length - 1]).toBe('Please keep it simple');
    });

    it('does not add an empty trailing part when there is no user text', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:propose add-auth', null, render);
      expect(result).not.toMatch(/\n\n$/);
      // Splitting on \n\n should yield exactly one part (just the template).
      expect(result.split('\n\n').length).toBe(1);
    });
  });

  describe('apply command', () => {
    it('expands using openspec/apply template', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:apply', null, render);
      expect(result).toContain('[TEMPLATE:openspec/apply]');
    });

    it('does NOT inject changePath context even when openSpecChangePath is set', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:apply', CHANGE_PATH, render);
      expect(result).not.toContain('The OpenSpec change directory');
    });
  });

  describe('verify command', () => {
    it('expands using openspec/verify template', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:verify', null, render);
      expect(result).toContain('[TEMPLATE:openspec/verify]');
    });

    it('does NOT inject changePath context even when openSpecChangePath is set', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:verify some-id', CHANGE_PATH, render);
      expect(result).not.toContain('The OpenSpec change directory');
    });
  });

  describe('archive command', () => {
    it('expands using openspec/archive template', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:archive', null, render);
      expect(result).toContain('[TEMPLATE:openspec/archive]');
    });

    it('does NOT inject changePath context even when openSpecChangePath is set', () => {
      const render = makeRenderer();
      const result = expandOpsxCommand('/opsx:archive', CHANGE_PATH, render);
      expect(result).not.toContain('The OpenSpec change directory');
    });
  });

  describe('$ARGUMENTS substitution edge cases', () => {
    it('replaces all occurrences of $ARGUMENTS in the template', () => {
      const render = () => '$ARGUMENTS and again $ARGUMENTS';
      const result = expandOpsxCommand('/opsx:propose my-id', null, render);
      expect(result).toBe('my-id and again my-id');
    });

    it('substitutes empty string when no arg is provided', () => {
      const render = () => 'ARG=[$ARGUMENTS]';
      const result = expandOpsxCommand('/opsx:apply', null, render);
      expect(result).toBe('ARG=[]');
    });
  });

  describe('parts ordering', () => {
    it('propose: template → changePath → userText', () => {
      const render = () => 'TMPL $ARGUMENTS';
      const result = expandOpsxCommand('/opsx:propose id\n\ndo the thing', CHANGE_PATH, render);
      const parts = result.split('\n\n');
      expect(parts[0]).toBe('TMPL id');
      expect(parts[1]).toContain('The OpenSpec change directory');
      expect(parts[2]).toBe('do the thing');
    });

    it('propose without changePath: template → userText (no gap)', () => {
      const render = () => 'TMPL $ARGUMENTS';
      const result = expandOpsxCommand('/opsx:propose id\n\ndo the thing', null, render);
      const parts = result.split('\n\n');
      expect(parts[0]).toBe('TMPL id');
      expect(parts[1]).toBe('do the thing');
      expect(parts.length).toBe(2);
    });
  });
});
