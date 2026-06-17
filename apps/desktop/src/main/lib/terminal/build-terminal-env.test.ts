import { describe, expect, it } from 'vitest';
import { buildTerminalEnv } from './env';

const base = { shell: '/bin/zsh', paneId: 'pane-1', workspaceId: 'ws-1' };

describe('buildTerminalEnv — project env precedence', () => {
  it('injects project env vars', () => {
    const env = buildTerminalEnv({ ...base, projectEnv: { MY_VAR: 'hello' } });
    expect(env.MY_VAR).toBe('hello');
  });

  it('omits project vars when none are provided', () => {
    const env = buildTerminalEnv(base);
    expect(env.MY_VAR).toBeUndefined();
  });

  it('lets a project var override an inherited value (e.g. PATH)', () => {
    const env = buildTerminalEnv({ ...base, projectEnv: { PATH: '/custom/bin' } });
    expect(env.PATH).toBe('/custom/bin');
  });

  it('never lets a project var clobber the fixed system vars', () => {
    const env = buildTerminalEnv({
      ...base,
      projectEnv: { SHELL: '/evil', TERM: 'evil', AGENTS_PANE_ID: 'evil', AGENTS_WORKSPACE_ID: 'evil' }
    });
    expect(env.SHELL).toBe('/bin/zsh');
    expect(env.TERM).toBe('xterm-256color');
    expect(env.AGENTS_PANE_ID).toBe('pane-1');
    expect(env.AGENTS_WORKSPACE_ID).toBe('ws-1');
  });
});
