import { safeStorage } from 'electron';

/**
 * Encrypt/decrypt helpers for protected project environment-variable values.
 *
 * Stored form carries a scheme marker so decryption never has to *guess* how a
 * value was encoded:
 *   - `enc:<base64>` — encrypted with Electron `safeStorage` (OS keychain /
 *     DPAPI / Secret Service).
 *   - `b64:<base64>` — plain base64 fallback used when no keychain is available
 *     (NOT real encryption; still masked in the UI).
 *
 * Decoding by marker — rather than by the *current* `isEncryptionAvailable()` —
 * is what makes a keychain availability flip safe: an `enc:` value on a machine
 * that can no longer decrypt THROWS (caller skips/surfaces it) instead of
 * returning raw ciphertext bytes as if they were the secret, and a `b64:` value
 * is never fed to `safeStorage.decryptString` just because a keychain later
 * appeared. (This is the one deliberate divergence from the otherwise-identical
 * `anthropic-accounts.ts` token helpers, which are marker-less and predate this
 * module — they are intentionally NOT shared to avoid changing their on-disk
 * token format.)
 *
 * Only protected values pass through here; unprotected values are stored
 * verbatim as plaintext and never touch this module.
 */

const ENC_PREFIX = 'enc:';
const B64_PREFIX = 'b64:';

/** Returns true when real OS-backed encryption is available on this machine. */
export function isSecretEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** Encrypt a protected value for storage. Returns marker-prefixed base64 text. */
export function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[env-secret] OS keychain unavailable — storing protected value as base64 (not encrypted)');
    return B64_PREFIX + Buffer.from(value, 'utf-8').toString('base64');
  }
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
}

/**
 * Decrypt a stored protected value produced by `encryptSecret`. Throws if an
 * `enc:` value cannot be decrypted (keychain unavailable / wrong machine) —
 * callers treat that as a skip/error, never as a usable value.
 */
export function decryptSecret(stored: string): string {
  if (stored.startsWith(ENC_PREFIX)) {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  }
  if (stored.startsWith(B64_PREFIX)) {
    return Buffer.from(stored.slice(B64_PREFIX.length), 'base64').toString('utf-8');
  }
  // Legacy/unmarked value written before the marker scheme: best-effort decode
  // matching the prior behavior. New writes always carry a marker.
  const buffer = Buffer.from(stored, 'base64');
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf-8');
}
