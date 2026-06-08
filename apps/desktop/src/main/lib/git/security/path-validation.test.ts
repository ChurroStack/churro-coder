import { describe, it, expect, vi } from 'vitest';

// path-validation.ts imports from ../../db at module load, which pulls in better-sqlite3 + electron
// (unavailable in the Node test env). isUnregisteredWorktreeError is pure and never touches the DB,
// so a minimal stub is enough to let the module import. Matches the vi.mock('../../db', …) pattern
// used by the trpc router tests.
vi.mock('../../db', () => ({
  getDatabase: vi.fn(),
  projects: {},
  chats: {}
}));

import { isUnregisteredWorktreeError, PathValidationError } from './path-validation';

describe('isUnregisteredWorktreeError', () => {
  it('is true for an UNREGISTERED_WORKTREE PathValidationError', () => {
    const err = new PathValidationError('Workspace path not registered in database', 'UNREGISTERED_WORKTREE');
    expect(isUnregisteredWorktreeError(err)).toBe(true);
  });

  it('is false for other PathValidationError codes', () => {
    expect(isUnregisteredWorktreeError(new PathValidationError('x', 'PATH_TRAVERSAL'))).toBe(false);
    expect(isUnregisteredWorktreeError(new PathValidationError('x', 'ABSOLUTE_PATH'))).toBe(false);
    expect(isUnregisteredWorktreeError(new PathValidationError('x', 'SYMLINK_ESCAPE'))).toBe(false);
    expect(isUnregisteredWorktreeError(new PathValidationError('x', 'INVALID_TARGET'))).toBe(false);
  });

  it('is false for a generic Error (even one whose message contains the code)', () => {
    expect(isUnregisteredWorktreeError(new Error('UNREGISTERED_WORKTREE'))).toBe(false);
  });

  it('is false for non-error values', () => {
    expect(isUnregisteredWorktreeError('UNREGISTERED_WORKTREE')).toBe(false);
    expect(isUnregisteredWorktreeError(null)).toBe(false);
    expect(isUnregisteredWorktreeError(undefined)).toBe(false);
    expect(isUnregisteredWorktreeError({ code: 'UNREGISTERED_WORKTREE' })).toBe(false);
  });
});
