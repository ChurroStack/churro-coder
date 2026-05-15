/**
 * Task 11.11 — Single-writer claim race.
 *
 * Two concurrent claim calls for the same subChatId → exactly one wins,
 * the other loses with currentOwner set. Then take-over swaps and the
 * first owner receives a subscription event with the new state.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  claimOwnership,
  takeOverOwnership,
  getOwner,
  addOwnershipListener,
  __resetRegistryForTest
} from './ownership-registry';

beforeEach(() => {
  __resetRegistryForTest();
});

describe('11.11 — single-writer claim race', () => {
  test('two concurrent claims: exactly one granted, one rejected', () => {
    const results = [
      claimOwnership({ subChatId: 'sc-race', windowId: 1, paneId: 'p-1' }),
      claimOwnership({ subChatId: 'sc-race', windowId: 2, paneId: 'p-2' })
    ];

    const granted = results.filter((r) => r.granted);
    const rejected = results.filter((r) => !r.granted);

    expect(granted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].currentOwner).not.toBeNull();
  });

  test('take-over from second client swaps ownership', () => {
    claimOwnership({ subChatId: 'sc-swap', windowId: 1, paneId: 'p-1' });

    // Second client tries claim but is rejected
    const result = claimOwnership({ subChatId: 'sc-swap', windowId: 2, paneId: 'p-2' });
    expect(result.granted).toBe(false);

    // Second client forces take-over
    takeOverOwnership({ subChatId: 'sc-swap', windowId: 2, paneId: 'p-2' });
    expect(getOwner('sc-swap')).toMatchObject({ windowId: 2, paneId: 'p-2' });
  });

  test('first client receives a subscription event reflecting new owner after take-over', () => {
    const eventsForClient1: unknown[] = [];

    claimOwnership({ subChatId: 'sc-takeover', windowId: 1, paneId: 'p-1' });

    // Client 1 subscribes to ownership changes for this subChat
    const unsub = addOwnershipListener((event) => {
      if (event.subChatId === 'sc-takeover') {
        eventsForClient1.push(event);
      }
    });

    // Client 2 takes over
    takeOverOwnership({ subChatId: 'sc-takeover', windowId: 2, paneId: 'p-new' });

    unsub();

    expect(eventsForClient1).toHaveLength(1);
    expect(eventsForClient1[0]).toMatchObject({
      subChatId: 'sc-takeover',
      owner: { windowId: 2, paneId: 'p-new' }
    });
  });

  test('take-over does not affect other subChats', () => {
    claimOwnership({ subChatId: 'sc-other', windowId: 10, paneId: 'p-other' });
    claimOwnership({ subChatId: 'sc-target', windowId: 10, paneId: 'p-target' });

    takeOverOwnership({ subChatId: 'sc-target', windowId: 20, paneId: 'p-new' });

    // sc-other must be unchanged
    expect(getOwner('sc-other')).toMatchObject({ windowId: 10, paneId: 'p-other' });
    // sc-target is now owned by window 20
    expect(getOwner('sc-target')).toMatchObject({ windowId: 20, paneId: 'p-new' });
  });
});
