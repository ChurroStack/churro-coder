import { useCallback, useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { appStore } from '../../lib/jotai-store';
import { trpc } from '../../lib/trpc';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';
import { applyModeDefaultModelAndSwitchProvider } from '../agents/lib/model-switching';
import { forceFreshSubChatSession } from '../agents/lib/session-reset';
import { useSubChatMode } from '../agents/hooks/use-sub-chat-mode';
import { submitToCli } from '../agents/hooks/use-harness-send-dispatcher';
import { openSpecSidebarContextAtomFamily, pendingOpenSpecMessageAtom, type OpenSpecSidebarContext } from './atoms';
import { expandOpenSpecCommand } from './openspec-command-expander';
import { openSpecCommandPrefix, type CliHarness, type OpenSpecVerb } from './command-prefix';

type OpenSpecActionKind = 'execute' | 'apply';

export interface OpenSpecActionInput {
  verb: OpenSpecVerb;
  /** Optional CLI-style argument string appended after the command prefix (e.g. a task scope `1.3`). */
  args?: string;
  kind: OpenSpecActionKind;
}

export function useOpenSpecAction(context: OpenSpecSidebarContext, subChatId: string) {
  const trpcUtils = trpc.useUtils();
  const openSubChatForChange = trpc.openspec.openSubChatForChange.useMutation();
  const updateSubChatMode = trpc.chats.updateSubChatMode.useMutation();
  const writeToTerminal = trpc.terminal.write.useMutation();
  const setPendingMessage = useSetAtom(pendingOpenSpecMessageAtom);
  const { setMode } = useSubChatMode(subChatId);

  const contextAtom = useMemo(() => openSpecSidebarContextAtomFamily(subChatId), [subChatId]);
  const setSidebarContext = useSetAtom(contextAtom);

  return useCallback(
    async (input: OpenSpecActionInput) => {
      const { verb, args, kind } = input;
      const targetMode = 'execute';
      const resolvedSubChat = await openSubChatForChange.mutateAsync({
        chatId: context.chatId,
        projectId: context.projectId,
        changeId: context.changeId
      });

      const targetSubChatId = resolvedSubChat.id;
      const harness = (resolvedSubChat.harness ?? 'builtin') as CliHarness;
      const trimmedArgs = args?.trim() ?? '';
      const prefix = openSpecCommandPrefix(verb, harness);
      const message = trimmedArgs ? `${prefix} ${trimmedArgs}` : prefix;
      const targetContext = { ...context, changePath: context.changePath || `openspec/changes/${context.changeId}` };
      const resolvedMode =
        resolvedSubChat.mode === 'plan' || resolvedSubChat.mode === 'execute' || resolvedSubChat.mode === 'explore'
          ? resolvedSubChat.mode
          : 'plan';

      useAgentSubChatStore.getState().addToAllSubChats({
        id: resolvedSubChat.id,
        name: resolvedSubChat.name || context.changeId,
        mode: resolvedMode,
        projectId: context.projectId,
        openspecChangeId: context.changeId,
        openspecChangePath: targetContext.changePath
      });
      useAgentSubChatStore.getState().addToOpenSubChats(targetSubChatId);
      useAgentSubChatStore.getState().setActiveSubChat(targetSubChatId);

      if (targetSubChatId === subChatId) {
        setSidebarContext(targetContext);
        setMode(targetMode);
      } else {
        appStore.set(openSpecSidebarContextAtomFamily(targetSubChatId), targetContext);
        trpcUtils.chats.getSubChat.setData({ id: targetSubChatId }, (prev) =>
          prev ? { ...prev, mode: targetMode } : prev
        );
        useAgentSubChatStore.getState().updateSubChatMode(targetSubChatId, targetMode);
        updateSubChatMode.mutate({ id: targetSubChatId, mode: targetMode });
      }
      applyModeDefaultModelAndSwitchProvider(targetSubChatId, targetMode);

      await trpcUtils.chats.getSubChat.invalidate({ id: targetSubChatId });
      forceFreshSubChatSession(targetSubChatId);

      if (harness === 'claude-cli') {
        // Claude path: expand the local `.j2` prompt template before sending so
        // the CLI receives the fully rendered instruction.
        const payload = expandOpenSpecCommand(message);
        submitToCli({
          subChatId: targetSubChatId,
          payload,
          writeMutation: writeToTerminal,
          injectMcpReminderIfFirst: false
        });
      } else if (harness === 'codex-cli') {
        // Codex path: skip local expansion — codex resolves `$openspec-<verb>`
        // via its own skill engine. Sending the rendered template would bypass
        // that and double-prompt. Force bracketed paste so codex's skill
        // autocomplete menu doesn't swallow the trailing \r.
        submitToCli({
          subChatId: targetSubChatId,
          payload: message,
          writeMutation: writeToTerminal,
          injectMcpReminderIfFirst: false,
          forceBracketedPaste: true
        });
      } else {
        setPendingMessage({ subChatId: targetSubChatId, message });
      }

      console.log(
        `[openspec/action] changeId=${context.changeId} subChatId=${targetSubChatId} kind=${kind} mode=${targetMode} harness=${harness} verb=${verb} prefix=${prefix}`
      );
    },
    [
      context,
      openSubChatForChange,
      setMode,
      setPendingMessage,
      setSidebarContext,
      subChatId,
      trpcUtils,
      updateSubChatMode,
      writeToTerminal
    ]
  );
}
