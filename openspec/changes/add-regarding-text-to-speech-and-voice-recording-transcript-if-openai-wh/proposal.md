## Why

Voice input currently requires an OpenAI API key to function, locking out users who haven't configured one even though macOS and Windows ship built-in speech recognition that Electron can access for free via the `SpeechRecognition` browser API (backed by `SFSpeechRecognizer` on macOS ≥ Catalina and Windows Speech Recognition). Additionally, the mic icon today only appears when voice is available AND the input is empty, creating an inconsistent UX where the icon jumps in and out of the toolbar depending on provider config — users who have typed text and then cleared it are surprised to see the icon re-appear.

## What Changes

- **OS-native STT fallback**: When no OpenAI key is set, voice transcription falls back to the platform's `SpeechRecognition` API (Chromium/Electron built-in on macOS and Windows; gracefully unavailable on Linux builds where the API is absent or network-gated).
- **Persistent mic icon**: The send button shows a microphone icon whenever the text input is empty, regardless of which transcription backend will be used. The icon is always present as long as *any* voice backend is available.
- **Dynamic mic ↔ arrow swap**: As soon as the user begins typing text, the mic icon transitions to the standard arrow-up send icon. Clearing the text reverts it back to the mic. No separate "voice mode" toggle needed.
- **Permission gating on first use**: Clicking the mic triggers a microphone permission check; if denied, an inline error toast explains what happened without breaking normal text input.
- **`voice.isAvailable` broadened**: The tRPC endpoint now reports voice availability when either the OpenAI key is configured *or* the current desktop runtime is expected to support native OS speech recognition. The renderer still performs final feature detection before starting native STT.

## Capabilities

### New Capabilities

- `native-stt-fallback`: Web Speech API (`SpeechRecognition`) transcription path in the renderer, used when no OpenAI key is present. Covers provider selection logic, permission handling, interim/final result wiring, and cross-platform availability detection.
- `voice-input-ux`: Dynamic mic ↔ send-arrow icon behavior in `AgentSendButton` and the desktop chat input prompts that use it, including `chat-input-area` and `new-chat-form`. Covers when the mic is shown, how typing switches the icon, and edge cases (recording interrupted by typing, streaming active, transcription in progress).

### Modified Capabilities

_(none — no existing specs)_

## Impact

- **`apps/desktop/src/main/lib/trpc/routers/voice.ts`** — `isAvailable` procedure is broadened to report desktop voice availability for either OpenAI Whisper or native OS-backed speech recognition, and returns enough method metadata for the renderer to prefer Whisper when both are possible.
- **`apps/desktop/src/renderer/lib/hooks/use-voice-input.ts`** — New shared facade that exposes one renderer contract for both backends (`openai` MediaRecorder + Whisper, or native `SpeechRecognition`) so call sites do not have to manage two incompatible recording lifecycles.
- **`apps/desktop/src/renderer/lib/hooks/use-speech-recognition-fallback.ts`** — New hook wrapping `window.SpeechRecognition`, handling start/stop, interim text, permission errors, and cleanup.
- **`apps/desktop/src/renderer/features/agents/components/agent-send-button.tsx`** — icon semantics stay the same; it simply receives `showVoiceInput={true}` whenever any backend is available.
- **`apps/desktop/src/renderer/features/agents/main/chat-input-area.tsx`** — migrated to the shared voice-input facade for desktop chat input behavior.
- **`apps/desktop/src/renderer/features/agents/main/new-chat-form.tsx`** — migrated to the same shared facade so the UX change applies to desktop chat input prompts everywhere, not just one screen.
- No new npm dependencies — `SpeechRecognition` is a Chromium built-in; platform probing happens in main for coarse availability and feature-detection happens in the renderer before the native path is used.
