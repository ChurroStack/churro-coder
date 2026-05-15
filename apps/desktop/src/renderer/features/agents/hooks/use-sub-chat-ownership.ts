import { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { subChatNonOwnerSetAtom } from '../atoms';

export interface OwnerInfo {
  windowId: number;
  paneId: string;
}

export interface SubChatOwnershipResult {
  /** True when this panel currently owns the subChat. */
  isOwner: boolean;
  /** Identity of the current owner (null if unclaimed or this panel owns it). */
  currentOwner: OwnerInfo | null;
  /** Request ownership from the current owner. */
  takeOver: () => void;
}

/**
 * Claims ownership of a subChat for a specific dockview pane.
 *
 * On mount: calls `chats.claimOwnership`. If the claim is denied,
 * `isOwner` is false and a subscription updates it when ownership changes.
 *
 * On unmount: calls `chats.releaseOwnership` to free the claim.
 *
 * Also writes to `subChatNonOwnerSetAtom` so `ChatInputArea` can read
 * ownership state without prop drilling.
 *
 * `paneId` must be stable across renders (e.g. `chat:<subChatId>`).
 * `windowId` should be `parseInt(useWindowId(), 10) || 1`.
 */
export function useSubChatOwnership(subChatId: string, windowId: number, paneId: string): SubChatOwnershipResult {
  const [nonOwners, setNonOwners] = useAtom(subChatNonOwnerSetAtom);
  const isOwner = !nonOwners.has(subChatId);
  const currentOwnerRef = useRef<OwnerInfo | null>(null);
  // Tracks whether this window currently believes it owns the subChat, so the
  // unmount cleanup can clear the non-owner flag only when *we* were the
  // non-owner — clearing unconditionally caused a flicker when another window
  // owned the subChat.
  const wasOwnerRef = useRef<boolean>(true);
  const mountedRef = useRef<boolean>(true);

  const claimMutation = trpc.chats.claimOwnership.useMutation();
  const releaseMutation = trpc.chats.releaseOwnership.useMutation();
  const takeOverMutation = trpc.chats.takeOverOwnership.useMutation();

  const setIsOwner = (owned: boolean, owner: OwnerInfo | null) => {
    if (!mountedRef.current) return;
    currentOwnerRef.current = owned ? null : owner;
    wasOwnerRef.current = owned;
    setNonOwners((prev) => {
      const next = new Set(prev);
      if (owned) next.delete(subChatId);
      else next.add(subChatId);
      return next;
    });
  };

  // Claim on mount, release on unmount
  useEffect(() => {
    if (!subChatId) return;
    mountedRef.current = true;
    claimMutation.mutate(
      { subChatId, windowId, paneId },
      {
        onSuccess: (result) => {
          const owner = result.currentOwner
            ? { windowId: result.currentOwner.windowId, paneId: result.currentOwner.paneId }
            : null;
          setIsOwner(result.granted, owner);
        }
      }
    );
    return () => {
      mountedRef.current = false;
      releaseMutation.mutate({ subChatId, windowId, paneId });
      // Only clear the non-owner flag if WE were the non-owner. Otherwise
      // another window still owns the subChat and that flag must persist.
      if (!wasOwnerRef.current) {
        setNonOwners((prev) => {
          if (!prev.has(subChatId)) return prev;
          const next = new Set(prev);
          next.delete(subChatId);
          return next;
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subChatId, windowId, paneId]);

  // Subscribe to ownership changes
  trpc.chats.ownership.useSubscription(subChatId, {
    enabled: !!subChatId,
    onData: (event) => {
      if (!mountedRef.current) return;
      if (!event.owner) {
        setIsOwner(true, null);
        return;
      }
      const isMine = event.owner.windowId === windowId && event.owner.paneId === paneId;
      setIsOwner(isMine, { windowId: event.owner.windowId, paneId: event.owner.paneId });
    }
  });

  const takeOver = () => {
    takeOverMutation.mutate({ subChatId, windowId, paneId }, { onSuccess: () => setIsOwner(true, null) });
  };

  return { isOwner, currentOwner: currentOwnerRef.current, takeOver };
}
