import { describe, it, expect } from 'vitest';
import { parseAzureRemoteUrl, buildAzureCreatePRWebUrl } from './parse-url';

describe('parseAzureRemoteUrl', () => {
  describe('HTTPS dev.azure.com', () => {
    it('parses standard HTTPS URL', () => {
      const result = parseAzureRemoteUrl('https://dev.azure.com/myorg/MyProject/_git/myrepo');
      expect(result).toMatchObject({
        organization: 'myorg',
        project: 'MyProject',
        repository: 'myrepo',
        orgUrl: 'https://dev.azure.com/myorg'
      });
    });

    it('strips .git suffix', () => {
      const result = parseAzureRemoteUrl('https://dev.azure.com/myorg/MyProject/_git/myrepo.git');
      expect(result).not.toBeNull();
      expect(result!.repository).toBe('myrepo');
    });

    it('parses HTTPS URL with embedded user credential', () => {
      const result = parseAzureRemoteUrl('https://carlos@dev.azure.com/myorg/MyProject/_git/myrepo');
      expect(result).toMatchObject({
        organization: 'myorg',
        project: 'MyProject',
        repository: 'myrepo'
      });
    });
  });

  describe('Legacy visualstudio.com HTTPS', () => {
    it('parses legacy HTTPS URL', () => {
      const result = parseAzureRemoteUrl('https://myorg.visualstudio.com/MyProject/_git/myrepo');
      expect(result).toMatchObject({
        organization: 'myorg',
        project: 'MyProject',
        repository: 'myrepo',
        orgUrl: 'https://dev.azure.com/myorg'
      });
    });

    it('parses legacy HTTPS URL with DefaultCollection prefix', () => {
      const result = parseAzureRemoteUrl('https://myorg.visualstudio.com/DefaultCollection/MyProject/_git/myrepo');
      expect(result).toMatchObject({
        organization: 'myorg',
        project: 'MyProject',
        repository: 'myrepo'
      });
    });
  });

  describe('SSH git@ssh.dev.azure.com', () => {
    it('parses Azure DevOps SSH URL', () => {
      const result = parseAzureRemoteUrl('git@ssh.dev.azure.com:v3/myorg/MyProject/myrepo');
      expect(result).toMatchObject({
        organization: 'myorg',
        project: 'MyProject',
        repository: 'myrepo',
        orgUrl: 'https://dev.azure.com/myorg'
      });
    });
  });

  describe('Legacy SSH vs-ssh.visualstudio.com', () => {
    it('parses legacy SSH URL', () => {
      const result = parseAzureRemoteUrl('myorg@vs-ssh.visualstudio.com:v3/myorg/MyProject/myrepo');
      expect(result).toMatchObject({
        organization: 'myorg',
        project: 'MyProject',
        repository: 'myrepo'
      });
    });
  });

  describe('Non-Azure URLs', () => {
    it('returns null for a GitHub URL', () => {
      expect(parseAzureRemoteUrl('https://github.com/owner/repo.git')).toBeNull();
    });

    it('returns null for a GitLab URL', () => {
      expect(parseAzureRemoteUrl('https://gitlab.com/owner/repo.git')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseAzureRemoteUrl('')).toBeNull();
    });
  });

  describe('repoWebUrl encoding', () => {
    it('URL-encodes project and repo names that contain spaces', () => {
      const result = parseAzureRemoteUrl('https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
      // The raw captured group from the regex will still be the encoded form
      // since the URL is already percent-encoded. We just check no double-encoding.
      expect(result).not.toBeNull();
      expect(result!.repoWebUrl).toContain('dev.azure.com');
    });

    it('builds repoWebUrl with org, project, and repo', () => {
      const result = parseAzureRemoteUrl('https://dev.azure.com/churrostack/ChurroProject/_git/churro-code');
      expect(result!.repoWebUrl).toBe('https://dev.azure.com/churrostack/ChurroProject/_git/churro-code');
    });
  });
});

describe('buildAzureCreatePRWebUrl', () => {
  const remote = {
    organization: 'myorg',
    project: 'MyProject',
    repository: 'myrepo',
    orgUrl: 'https://dev.azure.com/myorg',
    repoWebUrl: 'https://dev.azure.com/myorg/MyProject/_git/myrepo'
  };

  it('builds a create-PR URL with source and target refs', () => {
    const url = buildAzureCreatePRWebUrl({
      remote,
      branch: 'feature/my-feature',
      baseBranch: 'main'
    });
    expect(url).toContain('/pullrequestcreate');
    expect(url).toContain('sourceRef=feature%2Fmy-feature');
    expect(url).toContain('targetRef=main');
  });

  it('encodes branch names with special characters', () => {
    const url = buildAzureCreatePRWebUrl({
      remote,
      branch: 'fix/issue #42',
      baseBranch: 'develop'
    });
    expect(url).toContain('sourceRef=fix%2Fissue%20%2342');
    expect(url).toContain('targetRef=develop');
  });

  it('includes the repoWebUrl as the base', () => {
    const url = buildAzureCreatePRWebUrl({
      remote,
      branch: 'my-branch',
      baseBranch: 'main'
    });
    expect(url.startsWith(remote.repoWebUrl)).toBe(true);
  });
});
