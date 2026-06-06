import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { trpcClient } from '../../../lib/trpc';
import { isDesktopApp } from '../../../lib/utils/platform';
import { useFileChangeListener, useGitWatcher } from '../../../lib/hooks/use-file-change-listener';
import {
  workspaceDiffCacheAtomFamily,
  workspaceDiffRefreshTickAtomFamily,
  type DiffStatsCache,
  type WorkspaceDiffCache
} from '../atoms';
import { splitUnifiedDiffByFile, type ParsedDiffFile } from '../ui/agent-diff-view';

/**
 * Shared diff-cache fetcher + always-mountable sync hook.
 *
 * Why this exists: `workspaceDiffCacheAtomFamily(chatId)` (diff stats +
 * parsed files + prefetched contents) used to be produced *only* by
 * `ChatView.fetchDiffStats`, which lives inside a transient dockview chat
 * surface. For CLI chats the chat panel is `ChatCliSurface` (not `ChatView`),
 * and even for builtin chats the fetcher stops when its tab isn't active — so
 * the always-mounted Changes widget / Diff panel / left-sidebar counts read a
 * stale or empty cache. Mounting `useWorkspaceDiffSync` in the always-mounted
 * `DetailsRail` keeps the cache fresh regardless of which dock tab is active.
 *
 * `fetchParsedDiffIntoCache` is the single source of truth for the fetch +
 * cache-write logic; both `ChatView` and `useWorkspaceDiffSync` call it. A
 * module-level per-chat in-flight map coalesces concurrent fetches so mounting
 * the sync in two places never double-hits git.
 */

export interface RemoteDiffStats {
  fileCount: number;
  additions: number;
  deletions: number;
}

type SetDiffStats = (val: DiffStatsCache | ((prev: DiffStatsCache) => DiffStatsCache)) => void;

export interface DiffCacheSetters {
  setParsedFileDiffs: (files: ParsedDiffFile[] | null) => void;
  setPrefetchedFileContents: (contents: Record<string, string>) => void;
  setDiffContent: (content: string | null) => void;
  setDiffStats: SetDiffStats;
}

// At most one in-flight fetch per chat/worktree key, shared across every
// component that mounts the sync. Concurrent callers await the same promise.
const inFlightByKey = new Map<string, Promise<void>>();
// Keys for which a refresh was requested while a fetch was already in flight.
// The in-flight fetch captured git state at its start, so a later request (a
// files-changed event, a tick bump) that coalesced onto it would otherwise see
// pre-edit data with no retry. We run exactly one more fetch when the current
// one settles so the explicitly-requested refresh is honoured.
const rerunPendingKeys = new Set<string>();

export async function fetchParsedDiffIntoCache(args: {
  chatId?: string | null;
  worktreePath?: string | null;
  sandboxId?: string | null;
  remoteStats?: RemoteDiffStats | null;
  setters: DiffCacheSetters;
}): Promise<void> {
  const { chatId, worktreePath, sandboxId, remoteStats, setters } = args;
  // Desktop uses worktreePath, web uses sandboxId. Skip (don't reset) when both
  // are temporarily undefined so a re-render doesn't wipe existing data.
  if (!worktreePath && !sandboxId) return;

  const key = chatId ?? worktreePath ?? sandboxId ?? '';
  const existing = inFlightByKey.get(key);
  if (existing) {
    // Coalesce, but remember that a fresh fetch was asked for so we re-run once
    // the in-flight one (which may predate the change that triggered us) ends.
    rerunPendingKeys.add(key);
    return existing;
  }

  const run = (async () => {
    const { setParsedFileDiffs, setPrefetchedFileContents, setDiffContent, setDiffStats } = setters;
    try {
      // Desktop: getParsedDiff is all-in-one (parsing + file contents).
      if (worktreePath && chatId) {
        const result = await trpcClient.chats.getParsedDiff.query({ chatId });
        const files = result?.files ?? [];
        const fileContents = result?.fileContents ?? {};
        const totalAdditions = result?.totalAdditions ?? 0;
        const totalDeletions = result?.totalDeletions ?? 0;

        if (files.length > 0) {
          setParsedFileDiffs(files as unknown as ParsedDiffFile[]);
          setPrefetchedFileContents(fileContents);
          // null diff content signals "use parsedFileDiffs".
          setDiffContent(null);
          setDiffStats({
            fileCount: files.length,
            additions: totalAdditions,
            deletions: totalDeletions,
            isLoading: false,
            hasChanges: files.length > 0
          });
        } else {
          setDiffStats({ fileCount: 0, additions: 0, deletions: 0, isLoading: false, hasChanges: false });
          // Empty array (not null) = "no changes" vs "still loading".
          setParsedFileDiffs([]);
          setPrefetchedFileContents({});
          setDiffContent(null);
        }
        return;
      }

      // Desktop without a chat (viewing main repo directly) — no endpoint yet.
      if (worktreePath && !chatId) return;

      // Remote sandbox.
      if (sandboxId) {
        // Desktop remote chat: use stats already provided in chat data; the
        // diff view isn't available without a worktree.
        if (isDesktopApp()) {
          if (remoteStats) {
            setDiffStats({
              fileCount: remoteStats.fileCount,
              additions: remoteStats.additions,
              deletions: remoteStats.deletions,
              isLoading: false,
              hasChanges: remoteStats.fileCount > 0
            });
          } else {
            setDiffStats({ fileCount: 0, additions: 0, deletions: 0, isLoading: false, hasChanges: false });
          }
          setParsedFileDiffs([]);
          setPrefetchedFileContents({});
          setDiffContent(null);
          return;
        }

        // Web: relative fetch for the actual diff text.
        const response = await fetch(`/api/agents/sandbox/${sandboxId}/diff`);
        if (!response.ok) {
          setDiffStats((prev) => ({ ...prev, isLoading: false }));
          return;
        }
        const data = await response.json();
        const rawDiff: string | null = data.diff || null;
        setDiffContent(rawDiff);

        if (rawDiff && rawDiff.trim()) {
          const parsedFiles = splitUnifiedDiffByFile(rawDiff);
          setParsedFileDiffs(parsedFiles);
          let additions = 0;
          let deletions = 0;
          for (const file of parsedFiles) {
            additions += file.additions;
            deletions += file.deletions;
          }
          setDiffStats({
            fileCount: parsedFiles.length,
            additions,
            deletions,
            isLoading: false,
            hasChanges: parsedFiles.length > 0
          });
        } else {
          setDiffStats({ fileCount: 0, additions: 0, deletions: 0, isLoading: false, hasChanges: false });
          setParsedFileDiffs([]);
          setPrefetchedFileContents({});
        }
      }
    } catch (error) {
      console.error('[workspace-diff-sync] fetch error:', error);
      setDiffStats((prev) => ({ ...prev, isLoading: false }));
    }
  })();

  const tracked = run.finally(() => {
    if (inFlightByKey.get(key) === tracked) inFlightByKey.delete(key);
    // A refresh arrived mid-flight — run one more fetch (fire-and-forget) so it
    // reflects post-change git state. Cleared first so this fetch's own
    // coalesced callers re-arm it rather than chaining off a stale flag.
    if (rerunPendingKeys.has(key)) {
      rerunPendingKeys.delete(key);
      void fetchParsedDiffIntoCache(args);
    }
  });
  inFlightByKey.set(key, tracked);
  return tracked;
}

const DIFF_THROTTLE_MS = 2000;

/**
 * Mount once per workspace to keep `workspaceDiffCacheAtomFamily(chatId)`
 * fresh: fetches on mount / dependency change / refresh-tick bump, and on
 * filesystem + git-watcher events (throttled). Safe to mount alongside
 * `ChatView`'s own fetcher — the module-level coalescing prevents double work.
 */
export function useWorkspaceDiffSync(opts: {
  chatId?: string | null;
  worktreePath?: string | null;
  sandboxId?: string | null;
  remoteStats?: RemoteDiffStats | null;
}): { fetchNow: () => Promise<void> } {
  const { chatId, worktreePath, sandboxId, remoteStats } = opts;
  const cacheKey = chatId ?? '';
  const setDiffCache = useSetAtom(workspaceDiffCacheAtomFamily(cacheKey));

  const setters = useMemo<DiffCacheSetters>(
    () => ({
      setParsedFileDiffs: (files) =>
        setDiffCache((prev) => ({
          ...prev,
          parsedFileDiffs: files as unknown as WorkspaceDiffCache['parsedFileDiffs']
        })),
      setPrefetchedFileContents: (contents) => setDiffCache((prev) => ({ ...prev, prefetchedFileContents: contents })),
      setDiffContent: (content) => setDiffCache((prev) => ({ ...prev, diffContent: content })),
      setDiffStats: (val) =>
        setDiffCache((prev) => {
          const next = typeof val === 'function' ? val(prev.diffStats) : val;
          // Return the same reference when nothing changed to avoid re-renders.
          if (
            prev.diffStats.fileCount === next.fileCount &&
            prev.diffStats.additions === next.additions &&
            prev.diffStats.deletions === next.deletions &&
            prev.diffStats.isLoading === next.isLoading &&
            prev.diffStats.hasChanges === next.hasChanges
          ) {
            return prev;
          }
          return { ...prev, diffStats: next };
        })
    }),
    [setDiffCache]
  );

  const fetchNow = useCallback(
    () => fetchParsedDiffIntoCache({ chatId, worktreePath, sandboxId, remoteStats, setters }),
    [chatId, worktreePath, sandboxId, remoteStats, setters]
  );

  // Fetch on mount + when chat/worktree/sandbox changes.
  useEffect(() => {
    void fetchNow();
  }, [fetchNow]);

  // External refresh trigger (Diff panel Refresh button, files-changed events).
  const tick = useAtomValue(useMemo(() => workspaceDiffRefreshTickAtomFamily(cacheKey), [cacheKey]));
  const lastTick = useRef(tick);
  useEffect(() => {
    if (tick === lastTick.current) return;
    lastTick.current = tick;
    void fetchNow();
  }, [tick, fetchNow]);

  // Throttled refresh for filesystem / git events.
  const lastFetchAt = useRef<number>(Date.now());
  const timer = useRef<NodeJS.Timeout | null>(null);
  const schedule = useCallback(() => {
    const now = Date.now();
    const since = now - lastFetchAt.current;
    if (since >= DIFF_THROTTLE_MS) {
      lastFetchAt.current = now;
      void fetchNow();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      lastFetchAt.current = Date.now();
      void fetchNow();
    }, DIFF_THROTTLE_MS - since);
  }, [fetchNow]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    },
    []
  );

  useFileChangeListener(worktreePath ?? null, { onChange: schedule });
  useGitWatcher(worktreePath ?? null, { onChange: schedule, debounceMs: 200 });

  return { fetchNow };
}
