import { describe, expect, it, vi } from 'vitest';

// safeStorage fake. `available` toggles per-test. decryptString throws when the
// keychain is unavailable AND when handed bytes that aren't a CIPHER(...) blob —
// mirroring the real API, so we can prove the marker scheme prevents both the
// "ciphertext returned as value" and "false decrypt attempt" failure modes.
let available = true;
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`CIPHER(${s})`, 'utf-8'),
    decryptString: (buf: Buffer) => {
      if (!available) throw new Error('keychain unavailable');
      const m = /^CIPHER\((.*)\)$/s.exec(buf.toString('utf-8'));
      if (!m) throw new Error('not a safeStorage blob');
      return m[1];
    }
  }
}));

import { decryptSecret, encryptSecret, isSecretEncryptionAvailable } from './env-secret';

describe('env-secret', () => {
  it('round-trips an enc: value when the keychain is available', () => {
    available = true;
    const stored = encryptSecret('s3cr3t');
    expect(stored.startsWith('enc:')).toBe(true);
    expect(stored).not.toContain('s3cr3t');
    expect(decryptSecret(stored)).toBe('s3cr3t');
    expect(isSecretEncryptionAvailable()).toBe(true);
  });

  it('round-trips a b64: fallback value when no keychain is available', () => {
    available = false;
    const stored = encryptSecret('plain-value');
    expect(stored).toBe('b64:' + Buffer.from('plain-value', 'utf-8').toString('base64'));
    expect(decryptSecret(stored)).toBe('plain-value');
    expect(isSecretEncryptionAvailable()).toBe(false);
  });

  it('THROWS (never returns ciphertext) when an enc: value can no longer be decrypted', () => {
    available = true;
    const stored = encryptSecret('s3cr3t'); // enc:...
    available = false; // keychain went away
    expect(() => decryptSecret(stored)).toThrow();
  });

  it('decodes a b64: value as plaintext even after a keychain becomes available', () => {
    available = false;
    const stored = encryptSecret('plain-value'); // b64:...
    available = true; // keychain now present — must NOT be fed to decryptString
    expect(decryptSecret(stored)).toBe('plain-value');
  });
});
