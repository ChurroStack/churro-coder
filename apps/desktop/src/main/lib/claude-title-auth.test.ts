import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveClaudeRestAuth } from './claude-title-auth';

describe('resolveClaudeRestAuth [main/lib/claude-title-auth]', () => {
  const original = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('uses x-api-key for an sk-ant- key, honoring the configured model + base URL', () => {
    const auth = resolveClaudeRestAuth({
      model: 'claude-sonnet-4-6',
      token: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com'
    });
    expect(auth).toEqual({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': 'sk-ant-test' },
      model: 'claude-sonnet-4-6'
    });
  });

  it('uses x-api-key for an sk-ant- key even on a custom base URL (header follows token, not URL)', () => {
    const auth = resolveClaudeRestAuth({
      model: 'claude-sonnet-4-6',
      token: 'sk-ant-test',
      baseUrl: 'https://gateway.example.com'
    });
    expect(auth?.headers).toEqual({ 'x-api-key': 'sk-ant-test' });
    expect(auth?.url).toBe('https://gateway.example.com/v1/messages');
  });

  it('uses Bearer for a non-sk-ant token on the OFFICIAL base URL (the bug fix — was x-api-key)', () => {
    const auth = resolveClaudeRestAuth({
      model: 'claude-3-5-haiku',
      token: 'proxy-bearer-token',
      baseUrl: 'https://api.anthropic.com'
    });
    expect(auth).toEqual({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { Authorization: 'Bearer proxy-bearer-token' },
      model: 'claude-3-5-haiku'
    });
  });

  it('uses Bearer + the configured model for a non-sk-ant token on a custom (proxy) base URL', () => {
    const auth = resolveClaudeRestAuth({
      model: 'my-proxy-model',
      token: 'proxy-token',
      baseUrl: 'https://proxy.example.com'
    });
    expect(auth).toEqual({
      url: 'https://proxy.example.com/v1/messages',
      headers: { Authorization: 'Bearer proxy-token' },
      model: 'my-proxy-model'
    });
  });

  it('tolerates a trailing slash on the base URL', () => {
    const auth = resolveClaudeRestAuth({
      model: 'm',
      token: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com/'
    });
    expect(auth?.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('falls back to the shell-env ANTHROPIC_API_KEY (x-api-key + haiku, official)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    const auth = resolveClaudeRestAuth();
    expect(auth).toEqual({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': 'sk-ant-env' },
      model: 'claude-haiku-4-5-20251001'
    });
  });

  it('prefers the in-app key over the shell-env key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    const auth = resolveClaudeRestAuth({
      model: 'm',
      token: 'sk-ant-in-app',
      baseUrl: 'https://api.anthropic.com'
    });
    expect(auth?.headers).toEqual({ 'x-api-key': 'sk-ant-in-app' });
    expect(auth?.model).toBe('m');
  });

  it('returns null when no API key is set — never the subscription OAuth token', () => {
    expect(resolveClaudeRestAuth()).toBeNull();
    // A partial custom config (missing token or model) must not silently auth.
    expect(resolveClaudeRestAuth({ model: 'm', token: '', baseUrl: 'https://api.anthropic.com' })).toBeNull();
    expect(resolveClaudeRestAuth({ model: '', token: 'sk-ant-x', baseUrl: 'https://api.anthropic.com' })).toBeNull();
  });
});
