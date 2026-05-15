/**
 * Task 10.9 — single-writer claim registry.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  claimOwnership,
  releaseOwnership,
  takeOverOwnership,
  getOwner,
  releaseAllForWindow,
  addOwnershipListener,
  __resetRegistryForTest
} from './ownership-registry';

beforeEach(() => {
  __resetRegistryForTest();
});

describe('claimOwnership', () => {
  test('grants claim on an unclaimed subChat', () => {
    const result = claimOwnership({ subChatId: 'sc-1', windowId: 1, paneId: 'p-1' });
    expect(result.granted).toBe(true);
    expect(result.currentOwner).toBeNull();
  });

  test('rejects claim on an already-owned subChat', () => {
    claimOwnership({ subChatId: 'sc-1', windowId: 1, paneId: 'p-1' });
    const result = claimOwnership({ subChatId: 'sc-1', windowId: 2, paneId: 'p-2' });
    expect(result.granted).toBe(false);
    expect(result.currentOwner).toMatchObject({ windowId: 1, paneId: 'p-1' });
  });

  test('notifies listeners on successful claim', () => {
    const events: unknown[] = [];
    const unsub = addOwnershipListener((e) => events.push(e));
    claimOwnership({ subChatId: 'sc-notify', windowId: 1, paneId: 'p-1' });
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subChatId: 'sc-notify', owner: { windowId: 1, paneId: 'p-1' } });
  });
});

describe('releaseOwnership', () => {
  test('releases ownership when called by the owner', () => {
    claimOwnership({ subChatId: 'sc-1', windowId: 1, paneId: 'p-1' });
    releaseOwnership('sc-1', 1, 'p-1');
    expect(getOwner('sc-1')).toBeNull();
  });

  test('no-ops when called by a non-owner', () => {
    claimOwnership({ subChatId: 'sc-1', windowId: 1, paneId: 'p-1' });
    releaseOwnership('sc-1', 2, 'p-2'); // wrong owner
    expect(getOwner('sc-1')).toMatchObject({ windowId: 1, paneId: 'p-1' });
  });

  test('notifies listeners on release', () => {
    claimOwnership({ subChatId: 'sc-rel', windowId: 1, paneId: 'p-1' });
    const events: unknown[] = [];
    const unsub = addOwnershipListener((e) => events.push(e));
    releaseOwnership('sc-rel', 1, 'p-1');
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subChatId: 'sc-rel', owner: null });
  });
});

describe('takeOverOwnership', () => {
  test('takes over from an existing owner', () => {
    claimOwnership({ subChatId: 'sc-1', windowId: 1, paneId: 'p-1' });
    takeOverOwnership({ subChatId: 'sc-1', windowId: 2, paneId: 'p-2' });
    expect(getOwner('sc-1')).toMatchObject({ windowId: 2, paneId: 'p-2' });
  });

  test('notifies listeners on takeover', () => {
    claimOwnership({ subChatId: 'sc-to', windowId: 1, paneId: 'p-1' });
    const events: unknown[] = [];
    const unsub = addOwnershipListener((e) => events.push(e));
    takeOverOwnership({ subChatId: 'sc-to', windowId: 2, paneId: 'p-new' });
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subChatId: 'sc-to', owner: { windowId: 2, paneId: 'p-new' } });
  });

  test('after takeover, original claimer cannot release', () => {
    claimOwnership({ subChatId: 'sc-1', windowId: 1, paneId: 'p-1' });
    takeOverOwnership({ subChatId: 'sc-1', windowId: 2, paneId: 'p-2' });
    releaseOwnership('sc-1', 1, 'p-1'); // old owner tries to release — no-op
    expect(getOwner('sc-1')).toMatchObject({ windowId: 2, paneId: 'p-2' });
  });
});

describe('releaseAllForWindow', () => {
  test('releases all subChats owned by a window', () => {
    claimOwnership({ subChatId: 'sc-a', windowId: 5, paneId: 'p-a' });
    claimOwnership({ subChatId: 'sc-b', windowId: 5, paneId: 'p-b' });
    claimOwnership({ subChatId: 'sc-c', windowId: 6, paneId: 'p-c' });

    releaseAllForWindow(5);

    expect(getOwner('sc-a')).toBeNull();
    expect(getOwner('sc-b')).toBeNull();
    expect(getOwner('sc-c')).toMatchObject({ windowId: 6 });
  });
});
