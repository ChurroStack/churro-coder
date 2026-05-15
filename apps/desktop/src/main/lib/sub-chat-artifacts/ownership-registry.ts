/**
 * In-memory single-writer claim registry for sub-chats.
 *
 * Each subChatId can have at most one owner at a time. Ownership is identified
 * by (windowId, paneId). The registry is in-memory only — it resets on app
 * restart, which is correct because PTY sessions are also reset on restart.
 *
 * Callers subscribe to ownership changes via addOwnershipListener.
 */

export interface OwnershipEntry {
  subChatId: string;
  windowId: number;
  paneId: string;
}

export interface OwnershipChangeEvent {
  subChatId: string;
  owner: OwnershipEntry | null;
}

type OwnershipListener = (event: OwnershipChangeEvent) => void;

const registry = new Map<string, OwnershipEntry>();
const listeners = new Set<OwnershipListener>();

function notify(subChatId: string): void {
  const event: OwnershipChangeEvent = {
    subChatId,
    owner: registry.get(subChatId) ?? null
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors
    }
  }
}

export function claimOwnership(entry: OwnershipEntry): { granted: boolean; currentOwner: OwnershipEntry | null } {
  const existing = registry.get(entry.subChatId);
  if (existing) {
    return { granted: false, currentOwner: existing };
  }
  registry.set(entry.subChatId, entry);
  console.log(`[ownership] claimed subChat=${entry.subChatId} window=${entry.windowId} pane=${entry.paneId}`);
  console.log(`[resilience] subChat=${entry.subChatId} event=claim`);
  notify(entry.subChatId);
  return { granted: true, currentOwner: null };
}

export function releaseOwnership(subChatId: string, windowId: number, paneId: string): void {
  const existing = registry.get(subChatId);
  if (!existing || existing.windowId !== windowId || existing.paneId !== paneId) return;
  registry.delete(subChatId);
  console.log(`[ownership] released subChat=${subChatId} window=${windowId} pane=${paneId}`);
  notify(subChatId);
}

export function takeOverOwnership(entry: OwnershipEntry): void {
  const prior = registry.get(entry.subChatId);
  registry.set(entry.subChatId, entry);
  console.log(
    `[ownership] takeover subChat=${entry.subChatId} from=${prior ? `window=${prior.windowId} pane=${prior.paneId}` : 'none'} to=window=${entry.windowId} pane=${entry.paneId}`
  );
  console.log(`[resilience] subChat=${entry.subChatId} event=takeover`);
  notify(entry.subChatId);
}

export function getOwner(subChatId: string): OwnershipEntry | null {
  return registry.get(subChatId) ?? null;
}

export function releaseAllForWindow(windowId: number): void {
  const released: string[] = [];
  for (const [subChatId, entry] of registry) {
    if (entry.windowId === windowId) {
      registry.delete(subChatId);
      released.push(subChatId);
    }
  }
  for (const subChatId of released) {
    console.log(`[ownership] released-on-window-close subChat=${subChatId} window=${windowId}`);
    notify(subChatId);
  }
}

export function addOwnershipListener(fn: OwnershipListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test-only reset. */
export function __resetRegistryForTest(): void {
  registry.clear();
}
