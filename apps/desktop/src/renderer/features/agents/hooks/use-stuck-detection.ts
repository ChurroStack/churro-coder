import { useEffect, useMemo, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { useStreamingStatusStore } from '../stores/streaming-status-store';
import { subChatStuckReasonsAtomFamily, type StuckReason } from '../atoms/stuck-detection';

const PTY_EARLY_EXIT_THRESHOLD_MS = 5_000;
const PTY_SILENCE_MS = 60_000;
const STREAM_SILENCE_MS = 120_000;

interface UseStuckDetectionProps {
  subChatId: string;
  harness: 'builtin' | 'claude-cli' | 'codex-cli';
  /** For CLI: the paneId to subscribe to ('cli:<subChatId>'). */
  paneId?: string;
  /** For CLI: whether the PTY session is currently active (status === 'ready'). */
  ptyActive?: boolean;
}

function addToSet(set: ReadonlySet<StuckReason>, reason: StuckReason): ReadonlySet<StuckReason> {
  if (set.has(reason)) return set;
  const next = new Set(set);
  next.add(reason);
  return next;
}

function removeFromSet(set: ReadonlySet<StuckReason>, reason: StuckReason): ReadonlySet<StuckReason> {
  if (!set.has(reason)) return set;
  const next = new Set(set);
  next.delete(reason);
  return next;
}

/**
 * Heuristic stuck-session detection for a subChat.
 *
 * Writes to `subChatStuckReasonsAtomFamily(subChatId)` when any heuristic
 * triggers. Does NOT auto-reset — the user always decides via Hard-reset.
 *
 * Heuristics:
 *   1. pty-early-exit  — PTY exits with code ≠ 0 within PTY_EARLY_EXIT_THRESHOLD_MS of spawn
 *   2. pty-silence     — No PTY output for PTY_SILENCE_MS while ptyActive=true
 *   3. mcp-5xx         — (signaled externally; hook clears it when ptyActive goes false)
 *   4. stream-silence  — builtin stream stays 'streaming' for STREAM_SILENCE_MS with no status transition
 */
export function useStuckDetection({ subChatId, harness, paneId, ptyActive = false }: UseStuckDetectionProps) {
  const stuckAtom = useMemo(() => subChatStuckReasonsAtomFamily(subChatId), [subChatId]);
  const setStuck = useSetAtom(stuckAtom);
  const spawnTimeRef = useRef<number | null>(null);
  const lastDataTimeRef = useRef<number>(Date.now());
  const isCliHarness = harness === 'claude-cli' || harness === 'codex-cli';

  // Track PTY spawn time so early-exit heuristic can check elapsed time
  useEffect(() => {
    if (!isCliHarness || !ptyActive) {
      spawnTimeRef.current = null;
      return;
    }
    spawnTimeRef.current = Date.now();
    lastDataTimeRef.current = Date.now();
    // Clear pty-early-exit and pty-silence when a new session starts
    setStuck((prev) => removeFromSet(removeFromSet(prev, 'pty-early-exit'), 'pty-silence'));
  }, [isCliHarness, ptyActive, setStuck]);

  // Heuristic 1 + 2: watch terminal stream for CLI harnesses
  trpc.terminal.stream.useSubscription(paneId ?? '', {
    enabled: isCliHarness && !!paneId && ptyActive,
    onData: (event) => {
      if (event.type === 'data') {
        lastDataTimeRef.current = Date.now();
        // Clear silence if data arrives
        setStuck((prev) => removeFromSet(prev, 'pty-silence'));
      } else if (event.type === 'exit') {
        const exitCode = event.exitCode ?? 0;
        if (exitCode !== 0 && spawnTimeRef.current !== null) {
          const elapsed = Date.now() - spawnTimeRef.current;
          if (elapsed < PTY_EARLY_EXIT_THRESHOLD_MS) {
            console.log(
              `[stuck-detect] subChat=${subChatId} reason=pty-early-exit exitCode=${exitCode} elapsed=${elapsed}ms`
            );
            setStuck((prev) => addToSet(prev, 'pty-early-exit'));
          }
        }
      }
    }
  });

  // Heuristic 2: PTY silence timer — fires when no data for PTY_SILENCE_MS while
  // active. We check membership via the functional setStuck so the effect doesn't
  // need to depend on the latest `stuck` value — re-basing the interval on every
  // membership change would reset the silence timer and could mask a real stall.
  useEffect(() => {
    if (!isCliHarness || !ptyActive || !paneId) return;

    const check = () => {
      const elapsed = Date.now() - lastDataTimeRef.current;
      if (elapsed >= PTY_SILENCE_MS) {
        setStuck((prev) => {
          if (prev.has('pty-silence')) return prev;
          console.log(`[stuck-detect] subChat=${subChatId} reason=pty-silence silenceMs=${elapsed}`);
          return addToSet(prev, 'pty-silence');
        });
      }
    };

    const interval = setInterval(check, 5_000);
    return () => clearInterval(interval);
  }, [isCliHarness, ptyActive, paneId, subChatId, setStuck]);

  // Heuristic 4: builtin stream silence >120s
  const streamingStatus = useStreamingStatusStore((s) => s.getStatus(subChatId));
  const streamingStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (harness !== 'builtin') return;
    const isActive = streamingStatus === 'streaming' || streamingStatus === 'submitted';

    if (isActive) {
      if (streamingStartRef.current === null) {
        streamingStartRef.current = Date.now();
      }
    } else {
      streamingStartRef.current = null;
      // Clear when stream ends normally
      setStuck((prev) => removeFromSet(prev, 'stream-silence'));
      return;
    }

    const timer = setTimeout(() => {
      if (streamingStartRef.current !== null) {
        console.log(`[stuck-detect] subChat=${subChatId} reason=stream-silence`);
        setStuck((prev) => addToSet(prev, 'stream-silence'));
      }
    }, STREAM_SILENCE_MS);

    return () => clearTimeout(timer);
  }, [harness, streamingStatus, subChatId, setStuck]);
}
