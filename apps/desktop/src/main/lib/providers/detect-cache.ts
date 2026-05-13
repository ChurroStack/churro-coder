import type { DetectResult, AuthResult, ProviderId } from './types';

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  at: number;
}

const detectCache = new Map<string, CacheEntry<DetectResult>>();
const authCache = new Map<string, CacheEntry<AuthResult>>();

function isStale(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.at >= CACHE_TTL_MS;
}

export function getCachedDetect(provider: string): DetectResult | undefined {
  const entry = detectCache.get(provider);
  if (!entry || isStale(entry)) return undefined;
  return entry.value;
}

export function setCachedDetect(provider: string, result: DetectResult): void {
  detectCache.set(provider, { value: result, at: Date.now() });
}

export function getCachedAuth(provider: string): AuthResult | undefined {
  const entry = authCache.get(provider);
  if (!entry || isStale(entry)) return undefined;
  return entry.value;
}

export function setCachedAuth(provider: string, result: AuthResult): void {
  authCache.set(provider, { value: result, at: Date.now() });
}

/** Evict both caches for the given provider (called on Recheck/Retry). */
export function evict(provider: ProviderId | 'openspec'): void {
  detectCache.delete(provider);
  authCache.delete(provider);
}
