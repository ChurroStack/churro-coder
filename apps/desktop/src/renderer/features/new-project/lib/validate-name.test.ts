import { describe, it, expect } from 'vitest';
import { validateRepoName } from './validate-name';

describe('validateRepoName', () => {
  describe('common rules', () => {
    it('rejects empty name', () => {
      expect(validateRepoName('', 'github')).toMatchObject({ valid: false });
    });

    it('rejects name over 100 chars', () => {
      expect(validateRepoName('a'.repeat(101), 'github')).toMatchObject({
        valid: false,
        error: expect.stringContaining('100')
      });
    });

    it('rejects reserved names', () => {
      expect(validateRepoName('.git', 'github')).toMatchObject({ valid: false });
      expect(validateRepoName('CON', 'github')).toMatchObject({ valid: false });
      expect(validateRepoName('nul', 'local')).toMatchObject({ valid: false });
    });
  });

  describe('github provider', () => {
    it('accepts valid names', () => {
      expect(validateRepoName('my-repo', 'github')).toMatchObject({ valid: true });
      expect(validateRepoName('repo_name', 'github')).toMatchObject({ valid: true });
      expect(validateRepoName('repo.v2', 'github')).toMatchObject({ valid: true });
      expect(validateRepoName('MyRepo123', 'github')).toMatchObject({ valid: true });
    });

    it('rejects names with invalid chars', () => {
      expect(validateRepoName('my repo', 'github')).toMatchObject({ valid: false });
      expect(validateRepoName('my/repo', 'github')).toMatchObject({ valid: false });
      expect(validateRepoName('my@repo', 'github')).toMatchObject({ valid: false });
    });

    it('rejects names starting with a dot', () => {
      expect(validateRepoName('.hidden', 'github')).toMatchObject({ valid: false });
    });

    it('rejects solo dot', () => {
      expect(validateRepoName('.', 'github')).toMatchObject({ valid: false });
    });
  });

  describe('azure provider', () => {
    it('accepts normal names', () => {
      expect(validateRepoName('my-repo', 'azure')).toMatchObject({ valid: true });
      expect(validateRepoName('My Repo', 'azure')).toMatchObject({ valid: true });
    });

    it('rejects names with windows-illegal chars', () => {
      expect(validateRepoName('repo/name', 'azure')).toMatchObject({ valid: false });
      expect(validateRepoName('repo\\name', 'azure')).toMatchObject({ valid: false });
      expect(validateRepoName('repo:name', 'azure')).toMatchObject({ valid: false });
      expect(validateRepoName('repo*name', 'azure')).toMatchObject({ valid: false });
    });
  });

  describe('local provider', () => {
    it('accepts any non-reserved name', () => {
      expect(validateRepoName('my-project', 'local')).toMatchObject({ valid: true });
      expect(validateRepoName('my project', 'local')).toMatchObject({ valid: true });
    });
  });
});
