import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectAzureCli, invalidateAzureDetection, detectionToToastMessage } from './detect';

vi.mock('../../shell-env', () => ({
  execWithShellEnv: vi.fn()
}));

// Import after mock so we get the mocked version
import { execWithShellEnv } from '../../shell-env';

const mockExec = vi.mocked(execWithShellEnv);

// Helpers for the three sequential detection calls
const mockWhichAzOk = () => mockExec.mockResolvedValueOnce({ stdout: '/usr/bin/az', stderr: '' });
const mockExtensionFound = () => mockExec.mockResolvedValueOnce({ stdout: 'azure-devops\n', stderr: '' });
const mockExtensionMissing = () => mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
const mockDevopsConfigureOk = () => mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });

describe('detectAzureCli', () => {
  beforeEach(() => {
    mockExec.mockReset();
    invalidateAzureDetection();
  });

  it('returns missing_cli when az is not on PATH', async () => {
    mockExec.mockRejectedValueOnce(new Error('ENOENT: not found'));
    const result = await detectAzureCli();
    expect(result.status).toBe('missing_cli');
  });

  it('returns missing_extension when azure-devops extension is not installed', async () => {
    mockWhichAzOk();
    mockExtensionMissing();
    const result = await detectAzureCli();
    expect(result.status).toBe('missing_extension');
  });

  it('returns ok when az devops extension is configured (covers PAT + Azure AD auth)', async () => {
    mockWhichAzOk();
    mockExtensionFound();
    mockDevopsConfigureOk();
    const result = await detectAzureCli();
    expect(result.status).toBe('ok');
  });

  it('regression: PAT-only user (no az login) is reported as ok — not not_logged_in', async () => {
    // A user authenticated via `az devops login --organization ... ` or
    // AZURE_DEVOPS_EXT_PAT. `az account show` would fail for them, but the new
    // detection gate (az devops configure --list) succeeds.
    mockWhichAzOk();
    mockExtensionFound();
    // az devops configure --list succeeds even without az login
    mockExec.mockResolvedValueOnce({
      stdout: 'organization = https://dev.azure.com/myorg\n',
      stderr: ''
    });
    const result = await detectAzureCli();
    expect(result.status).toBe('ok');

    // Critically: az account show must NOT have been called
    const accountShowCalled = mockExec.mock.calls.some(
      ([cmd, args]) => cmd === 'az' && Array.isArray(args) && args.includes('account')
    );
    expect(accountShowCalled).toBe(false);
  });

  it('returns error when az devops configure fails unexpectedly', async () => {
    mockWhichAzOk();
    mockExtensionFound();
    mockExec.mockRejectedValueOnce(new Error('unexpected failure'));
    const result = await detectAzureCli();
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('unexpected failure');
    }
  });

  it('caches the result for 60 s without re-spawning az', async () => {
    mockWhichAzOk();
    mockExtensionFound();
    mockDevopsConfigureOk();

    const r1 = await detectAzureCli();
    const r2 = await detectAzureCli(); // Should hit cache, not spawn again

    expect(r1).toEqual(r2);
    expect(mockExec).toHaveBeenCalledTimes(3); // 3 calls, not 6
  });

  it('invalidateAzureDetection clears the cache so next call re-runs detection', async () => {
    // First pass → ok
    mockWhichAzOk();
    mockExtensionFound();
    mockDevopsConfigureOk();
    const r1 = await detectAzureCli();
    expect(r1.status).toBe('ok');

    invalidateAzureDetection();

    // Second pass → missing_cli (az gone from PATH)
    mockExec.mockRejectedValueOnce(new Error('ENOENT'));
    const r2 = await detectAzureCli();
    expect(r2.status).toBe('missing_cli');
  });

  it('returns error when extension list call throws', async () => {
    mockWhichAzOk();
    mockExec.mockRejectedValueOnce(new Error('az: permission denied'));
    const result = await detectAzureCli();
    expect(result.status).toBe('error');
  });
});

describe('detectionToToastMessage', () => {
  it('returns empty string for ok', () => {
    expect(detectionToToastMessage({ status: 'ok' })).toBe('');
  });

  it('mentions install URL for missing_cli', () => {
    const msg = detectionToToastMessage({ status: 'missing_cli' });
    expect(msg.toLowerCase()).toContain('install');
  });

  it('mentions az extension add for missing_extension', () => {
    const msg = detectionToToastMessage({ status: 'missing_extension' });
    expect(msg).toContain('az extension add');
  });

  it('returns the raw message for error', () => {
    expect(detectionToToastMessage({ status: 'error', message: 'boom' })).toBe('boom');
  });
});
