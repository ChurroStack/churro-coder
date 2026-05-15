/**
 * Task 10.14 — Two test stores opening the same subChatId.
 *
 * Simulates two independent renderer "windows" (stores) that both try to
 * own the same subChatId. Asserts:
 *   (a) First store gets ownership; second gets read-only.
 *   (b) Second store takes over; first loses ownership.
 *   (c) Subscription events fire correctly for both ownership transitions.
 *   (d) releaseAllForWindow(window 1) releases first owner; second store
 *       can then claim without takeOver.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  claimOwnership,
  takeOverOwnership,
  releaseAllForWindow,
  addOwnershipListener,
  getOwner,
  __resetRegistryForTest
} from './ownership-registry';

const SC = 'sc-two-stores-1';
const WIN_A = 10;
const WIN_B = 20;
const PANE_A = `chat:${SC}-a`;
const PANE_B = `chat:${SC}-b`;

beforeEach(() => {
  __resetRegistryForTest();
});

describe('(a) First store claims, second is denied', () => {
  test('store A claims first — granted', () => {
    const result = claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    expect(result.granted).toBe(true);
    expect(result.currentOwner).toBeNull();
  });

  test('store B claims second — denied with store A as current owner', () => {
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    const result = claimOwnership({ subChatId: SC, windowId: WIN_B, paneId: PANE_B });
    expect(result.granted).toBe(false);
    expect(result.currentOwner).toMatchObject({ windowId: WIN_A, paneId: PANE_A });
  });
});

describe('(b) Store B takes over; store A loses ownership', () => {
  test('after takeOver, getOwner returns store B', () => {
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    takeOverOwnership({ subChatId: SC, windowId: WIN_B, paneId: PANE_B });
    const owner = getOwner(SC);
    expect(owner).toMatchObject({ windowId: WIN_B, paneId: PANE_B });
  });

  test('after takeOver, store A claim is denied', () => {
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    takeOverOwnership({ subChatId: SC, windowId: WIN_B, paneId: PANE_B });
    const result = claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    expect(result.granted).toBe(false);
    expect(result.currentOwner).toMatchObject({ windowId: WIN_B });
  });
});

describe('(c) Subscription events on claim and takeover', () => {
  test('addOwnershipListener fires on initial claim with correct owner', () => {
    const events: Array<{ subChatId: string; owner: { windowId: number } | null }> = [];
    const unsub = addOwnershipListener((e) => events.push(e as any));
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0].owner?.windowId).toBe(WIN_A);
  });

  test('addOwnershipListener fires on takeover with new owner', () => {
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    const events: Array<{ subChatId: string; owner: { windowId: number } | null }> = [];
    const unsub = addOwnershipListener((e) => events.push(e as any));
    takeOverOwnership({ subChatId: SC, windowId: WIN_B, paneId: PANE_B });
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0].owner?.windowId).toBe(WIN_B);
  });
});

describe('(d) releaseAllForWindow — unclaims, other store can then claim', () => {
  test('after releaseAllForWindow(WIN_A), store B can claim without takeOver', () => {
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    releaseAllForWindow(WIN_A);
    expect(getOwner(SC)).toBeNull();

    const result = claimOwnership({ subChatId: SC, windowId: WIN_B, paneId: PANE_B });
    expect(result.granted).toBe(true);
    expect(getOwner(SC)).toMatchObject({ windowId: WIN_B });
  });

  test('releaseAllForWindow fires a null-owner subscription event', () => {
    claimOwnership({ subChatId: SC, windowId: WIN_A, paneId: PANE_A });
    const events: Array<{ owner: null | object }> = [];
    const unsub = addOwnershipListener((e) => events.push(e as any));
    releaseAllForWindow(WIN_A);
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0].owner).toBeNull();
  });
});
