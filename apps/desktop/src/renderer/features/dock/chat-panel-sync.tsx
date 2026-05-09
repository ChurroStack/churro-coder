import { useEffect } from 'react';
import { useAtom } from 'jotai';
import type { DockviewApi } from 'dockview-react';
import { useAgentSubChatStore, type SubChatMeta } from '../agents/stores/sub-chat-store';
import { pendingOpenSpecPanelAtom } from '../openspec/atoms';
import { addOrFocus } from './add-or-focus';

/**
 * ChatPanelSync — keeps a workspace's dockview chat panels (`chat:*`) in
 * lockstep with the sub-chat store's `openSubChatIds` / `activeSubChatId`.
 *
 * One instance is mounted per `WorkspaceDockShell`. Only the *active*
 * workspace's instance runs (others bail via the `active` prop), so the
 * inactive workspaces' DockShells stay frozen with whatever panels they
 * had — preserving terminals, chat streams, scroll positions, etc.
 *
 * Responsibilities while active:
 * 1. Hydrate `allSubChats` from the DB so dock tab titles can resolve to
 *    real names without waiting for `ChatViewInner` to mount.
 * 2. When the user picks no chat (`selectedChatId === null`): close any
 *    `chat:*` panels and ensure the `main` placeholder is mounted.
 * 3. When a chat is selected and we're its WorkspaceDockShell: open one
 *    `chat:${subChatId}` panel for every entry in `openSubChatIds`, and
 *    close any `chat:*` panel that's no longer in that list.
 * 4. When `activeSubChatId` changes: make the matching panel the active
 *    dockview panel.
 *
 * Inactive instances are no-ops — their dockview keeps every panel as it
 * was when the workspace was last active.
 */
export interface ChatPanelSyncProps {
  /** This shell's workspace id. Used to gate effects: only the workspace
   *  matching the global `selectedChatId` reconciles its dockview. */
  workspaceId: string | null;
  /** When false, every effect bails — the inactive shell stays frozen. */
  active: boolean;
  /** The dockview instance owned by this shell. */
  dockApi: DockviewApi | null;
}

interface DbSubChat {
  id: string;
  name: string | null;
  mode?: 'plan' | 'execute' | 'explore' | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function ChatPanelSync({ workspaceId, active, dockApi }: ChatPanelSyncProps) {
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats);
  const storeChatId = useAgentSubChatStore((s) => s.chatId);

  // Workspace-level hydration of `allSubChats` from DB.
  // The populate normally happens inside `ChatViewInner`
  // (active-chat.tsx ~L5056), which doesn't mount until a `ChatPanel`
  // becomes `isVisible`. On app boot dockview's restored panels can stay
  // `isVisible=false` until the user clicks a tab — which is exactly the
  // "tab titles stuck on 'New Chat' until I click another tab" bug.
  //
  // Reuse the direct chat snapshot path used by chat content hydration. This
  // avoids React Query's corrupted cache without maintaining a second IPC API.
  useEffect(() => {
    if (!active || !workspaceId) return;
    if (storeChatId !== workspaceId) return;

    let cancelled = false;
    window.desktopApi
      .getAgentChatSnapshot(workspaceId)
      .then((snapshot) => {
        if (cancelled) return;

        const dbSubChats: DbSubChat[] = Array.isArray(snapshot?.subChats) ? snapshot.subChats : [];
        const store = useAgentSubChatStore.getState();
        const existingMap = new Map(store.allSubChats.map((sc) => [sc.id, sc]));
        const hydratedIds = new Set<string>();
        const now = new Date().toISOString();

        const hydrated: SubChatMeta[] = dbSubChats.map((sc) => {
          const existing = existingMap.get(sc.id);
          hydratedIds.add(sc.id);
          return {
            id: sc.id,
            name: sc.name || 'New Chat',
            created_at: sc.createdAt ?? existing?.created_at ?? now,
            updated_at: sc.updatedAt ?? existing?.updated_at,
            mode: (sc.mode as 'plan' | 'execute' | 'explore' | undefined) || existing?.mode || 'plan'
          };
        });

        for (const id of store.openSubChatIds) {
          if (!hydratedIds.has(id)) {
            const existing = existingMap.get(id);
            hydrated.push({
              id,
              name: existing?.name || 'New Chat',
              created_at: existing?.created_at ?? now,
              updated_at: existing?.updated_at,
              mode: existing?.mode ?? 'plan'
            });
          }
        }

        const identical =
          hydrated.length === store.allSubChats.length &&
          hydrated.every((sc) => {
            const prev = existingMap.get(sc.id);
            return prev?.name === sc.name && prev?.mode === sc.mode;
          });
        if (!identical) store.setAllSubChats(hydrated);
      })
      .catch((err) => {
        console.warn('[ChatPanelSync] chat snapshot hydrate failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [active, workspaceId, storeChatId]);

  // Effect (1) — no chat selected: close chat panels, ensure `main`.
  useEffect(() => {
    if (!active || !dockApi) return;
    if (workspaceId !== null) return;
    for (const panel of dockApi.panels) {
      if (panel.id.startsWith('chat:')) panel.api.close();
    }
    if (!dockApi.getPanel('main')) {
      dockApi.addPanel({
        id: 'main',
        component: 'main',
        title: 'Workspace'
      });
    }
  }, [active, dockApi, workspaceId]);

  // Effect (2) — workspace selected: reconcile chat panels.
  useEffect(() => {
    if (!active || !dockApi || !workspaceId) return;
    // The store loads its slice on `setChatId`; if it lags behind the
    // workspace switch we bail to wait for the next render.
    if (storeChatId !== workspaceId) return;
    // On startup the dock snapshot can restore chat panels before the
    // sub-chat store hydrates from the DB. Wait for that hydration pass
    // before reconciling so we don't recreate or retitle panels from
    // stale placeholder state.
    if (openSubChatIds.length > 0 && allSubChats.length === 0) return;

    if (openSubChatIds.length > 0) {
      const main = dockApi.getPanel('main');
      if (main) main.api.close();
    }

    for (const subChatId of openSubChatIds) {
      const id = `chat:${subChatId}`;
      const sc = allSubChats.find((x) => x.id === subChatId);
      const nextTitle = sc?.name || 'New Chat';
      const existing = dockApi.getPanel(id);
      if (existing) {
        if (sc && existing.api.title !== nextTitle) {
          existing.api.setTitle(nextTitle);
        }
        continue;
      }
      dockApi.addPanel({
        id,
        component: 'chat',
        title: nextTitle,
        params: {
          subChatId,
          chatId: workspaceId,
          name: sc?.name
        }
      });
    }

    for (const panel of dockApi.panels) {
      if (!panel.id.startsWith('chat:')) continue;
      const subChatId = panel.id.slice('chat:'.length);
      if (!openSubChatIds.includes(subChatId)) {
        panel.api.close();
      }
    }
  }, [active, dockApi, workspaceId, storeChatId, openSubChatIds, allSubChats]);

  // Effect (3) — active sub-chat → setActive on the matching panel.
  useEffect(() => {
    if (!active || !dockApi || !workspaceId) return;
    if (storeChatId !== workspaceId) return;
    if (!activeSubChatId) return;
    const panel = dockApi.getPanel(`chat:${activeSubChatId}`);
    if (panel && !panel.api.isActive) panel.api.setActive();
  }, [active, dockApi, workspaceId, storeChatId, activeSubChatId]);

  // Effect (4) — pending OpenSpec panel → open once this workspace's dockview is ready.
  // Written by handleSelectSpec/handleSend in new-chat-form.tsx via pendingOpenSpecPanelAtom.
  // Using the atom instead of calling addOrFocus directly avoids the stale captured-dockApi
  // problem: the form callback captures the null-workspace dock, but this effect runs inside
  // the target workspace's WorkspaceDockShell with the correct live dockApi.
  const [pendingPanel, setPendingPanel] = useAtom(pendingOpenSpecPanelAtom);
  useEffect(() => {
    if (!active || !dockApi || !pendingPanel) return;
    if (pendingPanel.chatId !== workspaceId) return;
    addOrFocus(dockApi, { kind: 'openspec-change', data: pendingPanel });
    setPendingPanel(null);
  }, [active, dockApi, pendingPanel, workspaceId, setPendingPanel]);

  return null;
}
