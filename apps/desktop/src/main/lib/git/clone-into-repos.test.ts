import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseGitHubRef, parseAzureDevOpsRef } from './clone-into-repos';

// The pure parse functions don't need mocking — test them directly.

describe('parseGitHubRef', () => {
  it('parses HTTPS URL', () => {
    expect(parseGitHubRef('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses HTTPS URL with .git suffix', () => {
    expect(parseGitHubRef('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses SSH URL', () => {
    expect(parseGitHubRef('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses short owner/repo format', () => {
    expect(parseGitHubRef('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubRef('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubRef('not-a-url')).toBeNull();
    expect(parseGitHubRef('owner')).toBeNull();
  });
});

describe('parseAzureDevOpsRef', () => {
  it('parses standard Azure DevOps clone URL', () => {
    expect(parseAzureDevOpsRef('https://dev.azure.com/myorg/myproject/_git/myrepo')).toEqual({
      org: 'myorg',
      project: 'myproject',
      repo: 'myrepo'
    });
  });

  it('strips .git suffix', () => {
    expect(parseAzureDevOpsRef('https://dev.azure.com/org/proj/_git/repo.git')).toMatchObject({ repo: 'repo' });
  });

  it('returns null for non-Azure URLs', () => {
    expect(parseAzureDevOpsRef('https://github.com/owner/repo')).toBeNull();
    expect(parseAzureDevOpsRef('https://dev.azure.com/org/proj')).toBeNull(); // missing _git/
  });
});
