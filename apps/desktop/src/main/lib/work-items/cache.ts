import type { WorkItem, WorkItemPageInfo } from './types';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  items: WorkItem[];
  pageInfo: WorkItemPageInfo;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const bodyCache = new Map<string, string>();
const bodyInFlight = new Map<string, Promise<string>>();

function isStale(entry: CacheEntry): boolean {
  return Date.now() - entry.at >= CACHE_TTL_MS;
}

export function getCachedWorkItems(key: string): { items: WorkItem[]; pageInfo: WorkItemPageInfo } | undefined {
  const entry = cache.get(key);
  if (!entry || isStale(entry)) return undefined;
  return { items: entry.items, pageInfo: entry.pageInfo };
}

export function setCachedWorkItems(key: string, items: WorkItem[], pageInfo: WorkItemPageInfo): void {
  cache.set(key, { items, pageInfo, at: Date.now() });
}

export function appendCachedWorkItems(key: string, newItems: WorkItem[], pageInfo: WorkItemPageInfo): void {
  const existing = cache.get(key);
  const combined = existing ? [...existing.items, ...newItems] : newItems;
  cache.set(key, { items: combined, pageInfo, at: Date.now() });
}

export function evictWorkItems(key: string): void {
  cache.delete(key);
}

export function evictAllBodyCache(): void {
  bodyCache.clear();
  bodyInFlight.clear();
}

export function evictAll(): void {
  cache.clear();
  evictAllBodyCache();
}

export function getBodyCacheKey(owner: string, repo: string, number: number): string {
  return `github:${owner}/${repo}#${number}`;
}

export function getCachedBody(key: string): string | undefined {
  return bodyCache.get(key);
}

export function setCachedBody(key: string, body: string): void {
  bodyCache.set(key, body);
}

export function getBodyInFlight(key: string): Promise<string> | undefined {
  return bodyInFlight.get(key);
}

export function setBodyInFlight(key: string, promise: Promise<string>): void {
  bodyInFlight.set(key, promise);
}

export function clearBodyInFlight(key: string): void {
  bodyInFlight.delete(key);
}
