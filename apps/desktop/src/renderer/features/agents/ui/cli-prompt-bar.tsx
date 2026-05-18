import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { ChevronDown, X, RotateCcw } from 'lucide-react';
import { useHarnessSendDispatcher } from '../hooks/use-harness-send-dispatcher';
import { HARNESS_LABELS } from '../lib/harness-icons';
import { AgentSendButton } from '../components/agent-send-button';
import { VoiceWaveIndicator } from './voice-wave-indicator';
import { trpc } from '../../../lib/trpc';
import { CLAUDE_MODELS, formatClaudeThinkingLabel, type ClaudeThinkingLevel } from '../lib/models';
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
import { useVoiceInput } from '../../../lib/hooks/use-voice-input';
import { AgentsSlashCommand, type SlashCommandOption } from '../commands';

interface CliPromptBarProps {
  subChatId: string;
  isOwner?: boolean;
  harness?: 'builtin' | 'claude-cli' | 'codex-cli';
  /** Project directory — enables custom slash commands from .claude/commands/ */
  projectPath?: string;
}

interface PastedImage {
  id: string;
  path: string;
  objectUrl: string;
}

const LARGE_PASTE_THRESHOLD = 500;

const EFFORT_LEVELS: ClaudeThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function CliPromptBar({ subChatId, isOwner = true, harness, projectPath }: CliPromptBarProps) {
  const [text, setText] = useState('');
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [showSlashDropdown, setShowSlashDropdown] = useState(false);
  const [slashSearchText, setSlashSearchText] = useState('');
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const selectedModel = useMemo(
    () => CLAUDE_MODELS.find((m) => m.id === selectedModelId) ?? CLAUDE_MODELS[0]!,
    [selectedModelId]
  );

  const writePastedImage = trpc.files.writePastedImage.useMutation();
  const writePastedText = trpc.files.writePastedText.useMutation();

  const {
    isAvailable: isVoiceAvailable,
    isRecording: isVoiceRecording,
    isTranscribing: isVoiceTranscribing,
    audioLevel: voiceAudioLevel,
    startRecording,
    stopRecording
  } = useVoiceInput({
    onTranscript: (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    }
  });

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

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!isOwner || (!trimmed && pastedImages.length === 0)) return;

    const imageRefs = pastedImages.map((img) => `@${img.path}`).join(' ');
    const fullText = imageRefs ? (trimmed ? `${imageRefs}\n${trimmed}` : imageRefs) : trimmed;
    const messageToSend = buildOpenSpecCliPrefixedMessage({
      message: fullText,
      isOpenSpec,
      currentStep: openSpecCurrentStep,
      harness: resolvedHarness
    });
    dispatch(messageToSend);

    pastedImages.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    setPastedImages([]);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [isOwner, text, pastedImages, dispatch, isOpenSpec, openSpecCurrentStep, resolvedHarness]);

  const handleSlashSelect = useCallback(
    (command: SlashCommandOption) => {
      setShowSlashDropdown(false);
      if (command.category === 'builtin') {
        if (['plan', 'execute', 'explore', 'compact', 'clear'].includes(command.name)) {
          dispatch(`/${command.name}`);
          setText('');
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
          return;
        }
      }
      // For prompt-based and custom commands: insert as text; user can add args and press Enter
      setText(`/${command.name} `);
      textareaRef.current?.focus();
    },
    [dispatch]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && showSlashDropdown) {
      setShowSlashDropdown(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !showSlashDropdown) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;

    // Show slash autocomplete when the entire input is a /command (e.g. "/" or "/plan")
    const slashMatch = val.match(/^\/(\w*)$/);
    if (slashMatch) {
      const rect = el.getBoundingClientRect();
      setSlashSearchText(slashMatch[1]);
      setSlashPosition({ top: rect.top, left: rect.left });
      setShowSlashDropdown(true);
    } else {
      setShowSlashDropdown(false);
    }
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!isOwner) return;

      const { clipboardData } = e;

      // Image paste — save to disk, show thumbnail chip; path is prepended on send
      const imageItem = Array.from(clipboardData.items).find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        try {
          const base64Data = await fileToBase64(file);
          const result = await writePastedImage.mutateAsync({
            subChatId,
            base64Data,
            mediaType: file.type || 'image/png'
          });
          setPastedImages((prev) => [...prev, { id: crypto.randomUUID(), path: result.filePath, objectUrl }]);
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          console.error('[cli-prompt-bar] Failed to save pasted image:', err);
        }
        return;
      }

      // Large text paste — save to file, send path
      const pastedText = clipboardData.getData('text/plain');
      if (pastedText.length > LARGE_PASTE_THRESHOLD) {
        e.preventDefault();
        try {
          const result = await writePastedText.mutateAsync({ subChatId, text: pastedText });
          const ref = `@${result.filePath}`;
          setText((prev) => (prev ? `${prev} ${ref}` : ref));
        } catch (err) {
          console.error('[cli-prompt-bar] Failed to save pasted text:', err);
          // Fall through — let the default paste happen
        }
      }
    },
    [isOwner, subChatId, writePastedImage, writePastedText]
  );

  const removeImage = useCallback((id: string) => {
    setPastedImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.objectUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const hasContent = text.length > 0 || pastedImages.length > 0;

  return (
    <div data-testid="cli-prompt-bar" className="flex-shrink-0 border-t border-border bg-background flex flex-col">
      {/* Image thumbnail chips */}
      {pastedImages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {pastedImages.map((img) => (
            <div key={img.id} className="relative group">
              <img src={img.objectUrl} alt="pasted" className="h-14 w-14 object-cover rounded border border-border" />
              <button
                onClick={() => removeImage(img.id)}
                aria-label="Remove image"
                className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className="px-3 pt-3 pb-1">
        <textarea
          ref={textareaRef}
          data-testid="cli-prompt-input"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isOwner ? 'Describe your task — Enter to send, Shift+Enter for newline' : 'Read-only — take over to send'
          }
          disabled={!isOwner}
          rows={1}
          aria-label="Send to terminal"
          className="w-full resize-none bg-transparent text-sm outline-none disabled:opacity-50 placeholder:text-muted-foreground overflow-hidden leading-5 min-h-[20px]"
          style={{ height: 'auto' }}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="px-3 pb-2 flex items-center gap-1.5">
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
                {CLAUDE_MODELS.map((model) => (
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

        <AgentSendButton
          onClick={handleSend}
          onStop={async () => {}}
          isStreaming={false}
          hasContent={hasContent}
          disabled={!isOwner}
          showVoiceInput={isVoiceAvailable && isOwner}
          isRecording={isVoiceRecording}
          isTranscribing={isVoiceTranscribing}
          onVoiceMouseDown={startRecording}
          onVoiceMouseUp={stopRecording}
        />
      </div>

      {/* Slash command autocomplete dropdown */}
      <AgentsSlashCommand
        isOpen={showSlashDropdown}
        onClose={() => setShowSlashDropdown(false)}
        onSelect={handleSlashSelect}
        searchText={slashSearchText}
        position={slashPosition}
        projectPath={projectPath}
      />

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
