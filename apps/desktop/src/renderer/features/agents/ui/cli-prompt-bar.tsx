import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { ChevronDown, RotateCcw, PanelRightOpen, Columns2, Rows2 } from 'lucide-react';
import { useHarnessSendDispatcher } from '../hooks/use-harness-send-dispatcher';
import { HARNESS_LABELS } from '../lib/harness-icons';
import { AgentSendButton } from '../components/agent-send-button';
import { VoiceWaveIndicator } from './voice-wave-indicator';
import { trpc } from '../../../lib/trpc';
import { CLAUDE_MODELS, CLI_MODEL_ALIASES, formatClaudeThinkingLabel, type ClaudeThinkingLevel } from '../lib/models';
import {
  subChatModelIdAtomFamily,
  subChatClaudeThinkingAtomFamily,
  subChatCliRestartHandlerAtomFamily
} from '../atoms';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../../../components/ui/alert-dialog';
import {
  pendingOpenSpecMessageAtom,
  openSpecSidebarContextAtomFamily,
  openSpecCurrentStepAtomFamily
} from '../../openspec/atoms';
import { buildOpenSpecCliPrefixedMessage } from '../../openspec/step-prefix';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { cliSplitLayoutAtomFamily, type CliSplitLayout } from '../atoms';
import { useVoiceInput } from '../../../lib/hooks/use-voice-input';
import { _resetCliAutoRenameTriggered } from '../lib/auto-rename-state';

// Re-export the test helper so existing tests / harnesses that imported it
// from this module continue to work. Autorename now lives in
// `useCliAutoRenameOnFirstMessage`; this re-export is retained for test
// compatibility.
export { _resetCliAutoRenameTriggered };

interface CliPromptBarProps {
  subChatId: string;
  isOwner?: boolean;
  harness?: 'builtin' | 'claude-cli' | 'codex-cli';
  /** Project directory — reserved for future per-project controls. */
  projectPath?: string;
}

const EFFORT_LEVELS: ClaudeThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

export function CliPromptBar({ subChatId, isOwner = true, harness }: CliPromptBarProps) {
  const { dispatch } = useHarnessSendDispatcher(subChatId, harness);

  const storeHarness = useAgentSubChatStore(
    (s) => s.allSubChats.find((sc) => sc.id === subChatId)?.harness ?? 'builtin'
  );
  const resolvedHarness = harness ?? storeHarness;
  const isCodexCli = resolvedHarness === 'codex-cli';

  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const cliRestartHandler = useAtomValue(useMemo(() => subChatCliRestartHandlerAtomFamily(subChatId), [subChatId]));

  const modelAtom = useMemo(() => subChatModelIdAtomFamily(subChatId), [subChatId]);
  const [selectedModelId, setSelectedModelId] = useAtom(modelAtom);

  const thinkingAtom = useMemo(() => subChatClaudeThinkingAtomFamily(subChatId), [subChatId]);
  const [selectedThinking, setSelectedThinking] = useAtom(thinkingAtom);

  const [pendingOpenSpecMessage, setPendingOpenSpecMessage] = useAtom(pendingOpenSpecMessageAtom);
  const [cliReadyToReceive, setCliReadyToReceive] = useState(false);

  // OpenSpec context: when the CLI surface is mounted as the sidebar of an
  // OpenSpec change editor, prefix outgoing prompts with `/opsx:propose` or
  // `/opsx:apply` based on the active tab so the CLI runs the right workflow.
  const openSpecContextAtom = useMemo(() => openSpecSidebarContextAtomFamily(subChatId), [subChatId]);
  const openSpecContext = useAtomValue(openSpecContextAtom);
  const openSpecCurrentStepAtom = useMemo(() => openSpecCurrentStepAtomFamily(subChatId), [subChatId]);
  const openSpecCurrentStep = useAtomValue(openSpecCurrentStepAtom);
  const isOpenSpec = openSpecContext !== null;

  trpc.terminal.state.useSubscription(`cli:${subChatId}`, {
    enabled: resolvedHarness !== 'builtin' && !cliReadyToReceive,
    onData: ({ state }) => {
      if (state === 'idle') setCliReadyToReceive(true);
    }
  });

  useEffect(() => {
    if (!cliReadyToReceive) return;
    if (!pendingOpenSpecMessage) return;
    if (pendingOpenSpecMessage.subChatId !== subChatId) return;
    if (!isOwner) return;
    if (resolvedHarness === 'builtin') return;
    const changeIdPrefix = pendingOpenSpecMessage.message.split('\n')[0]?.slice(0, 40) ?? '';
    console.log(`[openspec/cli-bootstrap] dispatched subChat=${subChatId} changeIdPrefix=${changeIdPrefix}`);
    dispatch(pendingOpenSpecMessage.message);
    setPendingOpenSpecMessage(null);
  }, [
    cliReadyToReceive,
    pendingOpenSpecMessage,
    subChatId,
    isOwner,
    resolvedHarness,
    dispatch,
    setPendingOpenSpecMessage
  ]);

  // Opus Plan (and any other CLI-only alias) is pinned to the top of the
  // switcher; it dispatches `/model opusplan` like any other model pick.
  const cliModels = useMemo(() => [...CLI_MODEL_ALIASES, ...CLAUDE_MODELS], []);
  const selectedModel = useMemo(
    () => cliModels.find((m) => m.id === selectedModelId) ?? cliModels[0]!,
    [cliModels, selectedModelId]
  );

  // Submit a finished voice utterance (or any caller-supplied text) to the CLI.
  // Autorename is intentionally NOT handled here — it lives in
  // `useCliAutoRenameOnFirstMessage`, which triggers off the ingester so
  // direct-in-CLI typing also gets renamed.
  const submitToCli = useCallback(
    (text: string) => {
      if (!isOwner) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const cliHarness = resolvedHarness === 'builtin' ? 'claude-cli' : resolvedHarness;
      const messageToSend = buildOpenSpecCliPrefixedMessage({
        message: trimmed,
        isOpenSpec,
        currentStep: openSpecCurrentStep,
        harness: cliHarness
      });
      dispatch(messageToSend);
    },
    [isOwner, resolvedHarness, isOpenSpec, openSpecCurrentStep, dispatch]
  );

  // Voice input: collect transcripts in a buffer while recording/transcribing,
  // then flush as one CLI submission on the falling edge. The native
  // SpeechRecognition backend can emit multiple finals per held-mic session
  // (R-VOICE-SPLIT); batching here keeps "one press = one submission".
  const voiceBufferRef = useRef<string[]>([]);
  const voiceActiveRef = useRef(false);

  const {
    isAvailable: isVoiceAvailable,
    isRecording: isVoiceRecording,
    isTranscribing: isVoiceTranscribing,
    audioLevel: voiceAudioLevel,
    startRecording,
    stopRecording
  } = useVoiceInput({
    onTranscript: (transcript) => {
      if (transcript) voiceBufferRef.current.push(transcript);
    }
  });

  useEffect(() => {
    const active = isVoiceRecording || isVoiceTranscribing;
    if (voiceActiveRef.current && !active) {
      const buffered = voiceBufferRef.current.join(' ').trim();
      voiceBufferRef.current = [];
      if (buffered) submitToCli(buffered);
    }
    voiceActiveRef.current = active;
  }, [isVoiceRecording, isVoiceTranscribing, submitToCli]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModelId(modelId);
      if (!isCodexCli) dispatch(`/model ${modelId}`);
    },
    [setSelectedModelId, dispatch, isCodexCli]
  );

  const handleEffortChange = useCallback(
    (level: ClaudeThinkingLevel) => {
      setSelectedThinking(level);
      if (!isCodexCli) dispatch(`/effort ${level}`);
    },
    [setSelectedThinking, dispatch, isCodexCli]
  );

  const showVoiceButton = isVoiceAvailable && isOwner;

  return (
    <div data-testid="cli-prompt-bar" className="flex-shrink-0 border-t border-border bg-background flex flex-col">
      {/* Bottom toolbar — the "notch". The CLI's own TUI input is the only
          text-input surface; users dictate via the mic to send a single line. */}
      <div className="px-3 py-2 flex items-center gap-1.5">
        {/* Conversation pane layout toggle — applies to both CLI harnesses.
            Click cycles off -> vertical -> horizontal; the chevron opens a
            menu for direct selection. */}
        <CliLayoutToggle subChatId={subChatId} />

        {/* Model + effort selectors — Claude CLI only; Codex uses its own model config */}
        {!isCodexCli && (
          <>
            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={!isOwner}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                  <span>
                    {selectedModel.name} {selectedModel.version}
                  </span>
                  <ChevronDown size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]">
                {cliModels.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onSelect={() => handleModelChange(model.id)}
                    className={model.id === selectedModelId ? 'font-medium' : ''}>
                    {model.name} {model.version}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Effort selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={!isOwner}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                  <span>{formatClaudeThinkingLabel(selectedThinking as ClaudeThinkingLevel)}</span>
                  <ChevronDown size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[110px]">
                {EFFORT_LEVELS.map((level) => (
                  <DropdownMenuItem
                    key={level}
                    onSelect={() => handleEffortChange(level)}
                    className={level === selectedThinking ? 'font-medium' : ''}>
                    {formatClaudeThinkingLabel(level)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Restart button — visible on CLI harnesses; triggers kill + re-inject */}
        {(resolvedHarness === 'claude-cli' || resolvedHarness === 'codex-cli') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Restart CLI"
                data-testid="cli-restart-button"
                disabled={!isOwner}
                onClick={() => setShowRestartDialog(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                <RotateCcw size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Restart CLI session</TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1" />

        {isVoiceRecording && <VoiceWaveIndicator isRecording={isVoiceRecording} audioLevel={voiceAudioLevel} />}

        {showVoiceButton && (
          <AgentSendButton
            onClick={() => {}}
            onStop={async () => {}}
            isStreaming={false}
            hasContent={false}
            disabled={!isOwner}
            showVoiceInput
            isRecording={isVoiceRecording}
            isTranscribing={isVoiceTranscribing}
            onVoiceMouseDown={startRecording}
            onVoiceMouseUp={stopRecording}
          />
        )}
      </div>

      {/* Restart CLI confirmation dialog */}
      <AlertDialog open={showRestartDialog} onOpenChange={setShowRestartDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restart {HARNESS_LABELS[resolvedHarness as 'claude-cli' | 'codex-cli'] ?? 'CLI'} session?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The CLI will be killed and re-launched, and the first user message will be re-sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRestartDialog(false);
                if (cliRestartHandler) {
                  void cliRestartHandler();
                }
              }}>
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const LAYOUT_LABELS: Record<CliSplitLayout, string> = {
  off: 'Hide conversation pane',
  vertical: 'Vertical split — chat left',
  horizontal: 'Horizontal split — chat on top'
};
const LAYOUT_ORDER: CliSplitLayout[] = ['off', 'vertical', 'horizontal'];

function CliLayoutToggle({ subChatId }: { subChatId: string }) {
  const [layout, setLayout] = useAtom(cliSplitLayoutAtomFamily(subChatId));
  const Icon = layout === 'off' ? PanelRightOpen : layout === 'vertical' ? Columns2 : Rows2;
  const cycle = () => {
    const idx = LAYOUT_ORDER.indexOf(layout);
    setLayout(LAYOUT_ORDER[(idx + 1) % LAYOUT_ORDER.length]);
  };
  return (
    <DropdownMenu>
      <div className="flex items-center">
        <button
          aria-label={`Conversation pane: ${LAYOUT_LABELS[layout]}`}
          title={LAYOUT_LABELS[layout]}
          onClick={cycle}
          className="flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors rounded-l px-1.5 py-1 hover:bg-muted">
          <Icon size={12} />
        </button>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Choose conversation pane layout"
            className="flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors rounded-r py-1 pr-1 hover:bg-muted">
            <ChevronDown size={10} />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {LAYOUT_ORDER.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setLayout(opt)} className={opt === layout ? 'font-medium' : ''}>
            {LAYOUT_LABELS[opt]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
