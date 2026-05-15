import { useState, useRef, useMemo, useCallback } from 'react';
import { useAtom } from 'jotai';
import { ChevronDown } from 'lucide-react';
import { useHarnessSendDispatcher } from '../hooks/use-harness-send-dispatcher';
import { AgentSendButton } from '../components/agent-send-button';
import { VoiceWaveIndicator } from './voice-wave-indicator';
import { trpc } from '../../../lib/trpc';
import { CLAUDE_MODELS, formatClaudeThinkingLabel, type ClaudeThinkingLevel } from '../lib/models';
import { subChatModelIdAtomFamily, subChatClaudeThinkingAtomFamily } from '../atoms';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { useVoiceInput } from '../../../lib/hooks/use-voice-input';

interface CliPromptBarProps {
  subChatId: string;
  isOwner?: boolean;
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

export function CliPromptBar({ subChatId, isOwner = true }: CliPromptBarProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { dispatch } = useHarnessSendDispatcher(subChatId);

  const harness = useAgentSubChatStore((s) => s.allSubChats.find((sc) => sc.id === subChatId)?.harness ?? 'builtin');
  const isCodexCli = harness === 'codex-cli';

  // Per-subChat model atom
  const modelAtom = useMemo(() => subChatModelIdAtomFamily(subChatId), [subChatId]);
  const [selectedModelId, setSelectedModelId] = useAtom(modelAtom);

  // Per-subChat effort/thinking atom
  const thinkingAtom = useMemo(() => subChatClaudeThinkingAtomFamily(subChatId), [subChatId]);
  const [selectedThinking, setSelectedThinking] = useAtom(thinkingAtom);

  const selectedModel = useMemo(
    () => CLAUDE_MODELS.find((m) => m.id === selectedModelId) ?? CLAUDE_MODELS[0]!,
    [selectedModelId]
  );

  const writePastedImage = trpc.files.writePastedImage.useMutation();
  const writePastedText = trpc.files.writePastedText.useMutation();

  // Voice input
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

  // Only dispatch /model and /effort to claude-cli (codex-cli uses different protocol)
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
    if (!isOwner || !trimmed) return;
    dispatch(trimmed);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [isOwner, text, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!isOwner) return;

      const { clipboardData } = e;

      // Image paste — save to disk, insert path reference into the textarea so
      // the user can type a prompt alongside it ("explain this image"); they
      // dispatch with Enter when ready.
      const imageItem = Array.from(clipboardData.items).find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return;
        try {
          const base64Data = await fileToBase64(file);
          const result = await writePastedImage.mutateAsync({
            subChatId,
            base64Data,
            mediaType: file.type || 'image/png'
          });
          const ref = `@${result.filePath}`;
          setText((prev) => (prev ? `${prev} ${ref}` : ref));
        } catch (err) {
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

  return (
    <div data-testid="cli-prompt-bar" className="flex-shrink-0 border-t border-border bg-background flex flex-col">
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

        <div className="flex-1" />

        {isVoiceRecording && <VoiceWaveIndicator isRecording={isVoiceRecording} audioLevel={voiceAudioLevel} />}

        <AgentSendButton
          onClick={handleSend}
          onStop={async () => {}}
          isStreaming={false}
          hasContent={text.length > 0}
          disabled={!isOwner}
          showVoiceInput={isVoiceAvailable && isOwner}
          isRecording={isVoiceRecording}
          isTranscribing={isVoiceTranscribing}
          onVoiceMouseDown={startRecording}
          onVoiceMouseUp={stopRecording}
        />
      </div>
    </div>
  );
}
