export type OpenExternalFailureReason = 'empty' | 'invalid' | 'unsupported-protocol' | 'open-failed';

export interface OpenExternalFailurePayload {
  reason: OpenExternalFailureReason;
  url: string;
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function previewExternalUrl(rawUrl: string, maxLength = 200): string {
  const normalized = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!normalized) return '[empty]';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function validateExternalUrl(
  rawUrl: string
): { ok: true; url: string } | { ok: false; reason: Exclude<OpenExternalFailureReason, 'open-failed'> } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  return { ok: true, url: parsed.toString() };
}
