import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { router, publicProcedure } from '../index';
import { observable } from '@trpc/server/observable';
import { terminalManager } from '../../terminal/manager';
import { resolveCliParentChatId } from '../../terminal/resolve-cli-parent';
import type { CliStateEvent, TerminalEvent, TerminalOutputState } from '../../terminal/types';
import { TRPCError } from '@trpc/server';
import { postSpawnLocateAndAttach } from './cli-session';
import { snapshotCodexCandidatePaths } from '../../cli-session/locator';

const bootstrapSchema = z
  .object({
    cwd: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    initialInput: z.string().optional(),
    initialInputChunks: z.array(z.string()).optional(),
    idleDetection: z
      .object({
        silenceMs: z.number().int().positive().optional()
      })
      .optional()
  })
  .optional();

export const terminalRouter = router({
  /**
   * Create or attach to an existing terminal session.
   * Returns serializedState for recovery if reattaching.
   */
  createOrAttach: publicProcedure
    .input(
      z.object({
        paneId: z.string().min(1),
        tabId: z.string().optional(),
        workspaceId: z.string().optional(),
        scopeKey: z.string().optional(),
        cols: z.number().int().positive().optional(),
        rows: z.number().int().positive().optional(),
        cwd: z.string().optional(),
        initialCommands: z.array(z.string()).optional(),
        bootstrap: bootstrapSchema
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Pre-spawn snapshot of codex's day-window dirs. Any rollout file that
        // existed before this moment cannot be ours, so the locator skips it.
        // Cheap (3 readdir calls); taken unconditionally for cli:* panes so
        // we don't have to know the harness here. Ignored by the claude path.
        const isCli = input.paneId.startsWith('cli:');
        const spawnedAt = isCli ? Date.now() : 0;
        const codexSnapshot = isCli
          ? await snapshotCodexCandidatePaths(spawnedAt).catch(() => new Set<string>())
          : undefined;
        const result = await terminalManager.createOrAttach(input);
        // CLI session ingestion hook: fire-and-forget post-spawn locator for
        // CLI panes (paneId convention is `cli:<subChatId>`). Failure is
        // non-fatal — the user can hit the Refresh button to retry.
        if (result.isNew && isCli) {
          const subChatId = input.paneId.slice('cli:'.length);
          // Guard the IPC boundary: subChatId is sliced from a client-supplied
          // paneId and flows downstream as a DB key / locator argument.
          // createId() only ever emits [0-9a-z], so reject anything carrying
          // path separators or other unexpected characters — a malformed
          // paneId (e.g. "cli:../..") must not reach the locator.
          if (subChatId && /^[A-Za-z0-9_-]+$/.test(subChatId)) {
            void postSpawnLocateAndAttach(subChatId, spawnedAt, input.cwd, codexSnapshot).catch((err) => {
              console.warn('[TerminalRouter] post-spawn locator failed', err);
            });
          } else if (subChatId) {
            console.warn(
              `[TerminalRouter] skipping post-spawn locator: malformed subChatId from paneId="${input.paneId}"`
            );
          }
        }
        return {
          paneId: input.paneId,
          isNew: result.isNew,
          serializedState: result.serializedState
        };
      } catch (err) {
        console.error('[TerminalRouter] createOrAttach error:', err);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Failed to create terminal'
        });
      }
    }),

  write: publicProcedure
    .input(
      z.object({
        paneId: z.string().min(1),
        data: z.string()
      })
    )
    .mutation(({ input }) => {
      terminalManager.write(input);
    }),

  resize: publicProcedure
    .input(
      z.object({
        paneId: z.string().min(1),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
      })
    )
    .mutation(({ input }) => {
      terminalManager.resize(input);
    }),

  /**
   * Send a signal to the terminal process.
   */
  signal: publicProcedure
    .input(
      z.object({
        paneId: z.string().min(1),
        signal: z.string().optional()
      })
    )
    .mutation(({ input }) => {
      terminalManager.signal(input);
    }),

  /**
   * Kill terminal session - actually terminate it.
   */
  kill: publicProcedure
    .input(
      z.object({
        paneId: z.string().min(1)
      })
    )
    .mutation(async ({ input }) => {
      await terminalManager.kill(input);
    }),

  /**
   * Detach from terminal - keep session alive.
   * Called on component unmount. Stores serialized state for recovery.
   */
  detach: publicProcedure
    .input(
      z.object({
        paneId: z.string().min(1),
        serializedState: z.string().optional()
      })
    )
    .mutation(({ input }) => {
      terminalManager.detach(input);
    }),

  /**
   * Clear scrollback buffer for terminal (used by Cmd+K / clear command)
   */
  clearScrollback: publicProcedure.input(z.object({ paneId: z.string().min(1) })).mutation(({ input }) => {
    terminalManager.clearScrollback(input);
  }),

  getSession: publicProcedure.input(z.string().min(1)).query(({ input: paneId }) => {
    return terminalManager.getSession(paneId);
  }),

  /**
   * Get count of active terminal sessions for a workspace
   */
  getActiveSessionCount: publicProcedure.input(z.object({ workspaceId: z.string() })).query(({ input }) => {
    return terminalManager.getSessionCountByWorkspaceId(input.workspaceId);
  }),

  /**
   * List alive terminal sessions for a given scope key.
   * Used by new workspaces to discover shared terminals (local mode).
   */
  listSessionsByScopeKey: publicProcedure.input(z.object({ scopeKey: z.string() })).query(({ input }) => {
    return terminalManager.getSessionsByScopeKey(input.scopeKey);
  }),

  /**
   * Get workspace cwd for terminal initialization
   */
  getWorkspaceCwd: publicProcedure.input(z.string()).query(({ input }) => {
    // For now, just return null - the workspace path comes from the chat/project
    // In the future this could look up the workspace's root directory
    return null;
  }),

  /**
   * List directory contents for navigation
   */
  listDirectory: publicProcedure.input(z.object({ dirPath: z.string() })).query(async ({ input }) => {
    const { dirPath } = input;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const items = entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: path.join(dirPath, entry.name),
          isDirectory: entry.isDirectory()
        }))
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

      // Get parent directory
      const parentPath = path.dirname(dirPath);
      const hasParent = parentPath !== dirPath;

      return {
        currentPath: dirPath,
        parentPath: hasParent ? parentPath : null,
        items
      };
    } catch {
      return {
        currentPath: dirPath,
        parentPath: null,
        items: [],
        error: 'Unable to read directory'
      };
    }
  }),

  stream: publicProcedure.input(z.string().min(1)).subscription(({ input: paneId }) => {
    return observable<TerminalEvent>((emit) => {
      const onData = (data: string) => {
        emit.next({ type: 'data', data });
      };

      const onExit = (exitCode: number, signal?: number) => {
        emit.next({ type: 'exit', exitCode, signal });
        emit.complete();
      };

      terminalManager.on(`data:${paneId}`, onData);
      terminalManager.on(`exit:${paneId}`, onExit);

      return () => {
        terminalManager.off(`data:${paneId}`, onData);
        terminalManager.off(`exit:${paneId}`, onExit);
      };
    });
  }),

  /**
   * Single source of truth for CLI idle/running state. Emits the current
   * state immediately on subscribe so late mounters see the right value
   * without waiting for the next transition, then emits on every flip.
   * Only flips fire — never idle→idle or running→running.
   */
  state: publicProcedure.input(z.string().min(1)).subscription(({ input: paneId }) => {
    return observable<{ paneId: string; state: TerminalOutputState }>((emit) => {
      const current = terminalManager.getOutputState(paneId);
      if (current) emit.next({ paneId, state: current });
      const onState = (state: TerminalOutputState) => emit.next({ paneId, state });
      terminalManager.on(`state:${paneId}`, onState);
      return () => terminalManager.off(`state:${paneId}`, onState);
    });
  }),

  /**
   * Multiplexed subscription for ALL `cli:*` panes. One observable across
   * every CLI sub-chat — replaces per-panel `terminal.state` subscriptions
   * for CLI busy tracking. Emits {subChatId, parentChatId, state} on every
   * running↔idle transition AND on PTY exit (state: 'exited').
   *
   * Late subscribers receive a snapshot of every alive cli:* session before
   * future transitions land. The listener is attached BEFORE the snapshot
   * loop runs — a transition firing in the gap would otherwise be lost.
   * Subsequent duplication (snapshot says 'running' AND a 'running'
   * transition fires) is idempotent on the consumer side.
   */
  allCliStates: publicProcedure.subscription(() => {
    return observable<CliStateEvent>((emit) => {
      // Backfill a missing parentChatId from subChats.chatId. A session whose
      // PTY recorded no workspaceId (restored / remote-controlled CLI) would
      // otherwise emit parentChatId: null, and the parent-keyed sidebar /
      // project-group / kanban busy spinners skip null-parented entries — so
      // the CLI looks idle in the chrome while it's working.
      const onCliState = (evt: CliStateEvent) =>
        emit.next({ ...evt, parentChatId: resolveCliParentChatId(evt.subChatId, evt.parentChatId) });
      // Step 1: attach listener BEFORE reading snapshot.
      terminalManager.on('cli-state', onCliState);
      // Step 2: snapshot. Duplicates of in-flight transitions are
      // idempotent on the renderer (Map.set with the same value).
      for (const s of terminalManager.listActiveCliSessions()) {
        emit.next({
          subChatId: s.subChatId,
          parentChatId: resolveCliParentChatId(s.subChatId, s.parentChatId),
          state: s.state
        });
      }
      return () => terminalManager.off('cli-state', onCliState);
    });
  })
});
