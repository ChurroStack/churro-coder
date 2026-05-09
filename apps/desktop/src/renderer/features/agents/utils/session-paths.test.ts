import { describe, test, expect } from 'vitest';
import { isAppInternalSessionPath } from './session-paths';

describe('isAppInternalSessionPath', () => {
  test('matches current agent-sessions paths', () => {
    expect(
      isAppInternalSessionPath('/Users/u/Library/Application Support/Churro Coder/agent-sessions/sub-1/plans/plan.md')
    ).toBe(true);
  });

  test('matches legacy claude-sessions paths', () => {
    expect(
      isAppInternalSessionPath('/home/user/.local/share/Churro Coder/claude-sessions/abc/projects/foo.jsonl')
    ).toBe(true);
  });

  test('does not match unrelated session-like paths', () => {
    expect(isAppInternalSessionPath('/repo/apps/foo/sessions/index.ts')).toBe(false);
    expect(isAppInternalSessionPath('/node_modules/express-session/index.js')).toBe(false);
    expect(isAppInternalSessionPath('/home/user/.codex/sessions/abc.json')).toBe(false);
  });

  test('does not match real project files', () => {
    expect(isAppInternalSessionPath('/project/src/auth/session.ts')).toBe(false);
    expect(isAppInternalSessionPath('/project/docs/release-plan.md')).toBe(false);
  });
});
