## 1. Native STT Fallback Hook

- [x] 1.1 Create `apps/desktop/src/renderer/lib/hooks/use-speech-recognition-fallback.ts` with native-backend state and callbacks used internally by the shared voice facade. Accept `onTranscript(text: string)`, `onComplete()`, and `onError(err: Error)` callbacks.
- [x] 1.2 In the hook, wrap `window.SpeechRecognition || window.webkitSpeechRecognition` with `continuous: false`, `interimResults: false`, and `lang: navigator.language`. Expose `startRecording` that guards against double-start via `isRecording` check.
- [x] 1.3 Handle `recognition.onresult` — extract the first final transcript, call `onTranscript`, and clear `isRecording` / transcribing state.
- [x] 1.4 Handle `recognition.onend` without a prior `onresult` (silence timeout) — silently clear `isRecording` state with no callback and no error.
- [x] 1.5 Handle `recognition.onerror`: normalize `not-allowed` and `service-not-allowed` to "Microphone access denied. Update permissions in System Settings."; normalize `network` to an OS-focused fallback message; normalize other native errors to a compact `Error` message for the facade.
- [x] 1.6 Implement `cancelRecording` — call `recognition.abort()` and reset `isRecording` without calling `onTranscript`.
- [x] 1.7 Add a cleanup `useEffect` that calls `recognition.abort()` on hook unmount to prevent dangling sessions.

## 2. Broaden Voice Availability Contract

- [x] 2.1 In `apps/desktop/src/main/lib/trpc/routers/voice.ts`, broaden `isAvailable` so it reports additive method metadata for OpenAI and native OS-backed availability expectations, while preserving the existing `available` boolean for callers.
- [x] 2.2 In the renderer, keep final feature detection with `const hasSpeechRecognition = !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition)` and combine it with the broadened query result before enabling voice UI.

## 3. Shared Voice Facade

- [x] 3.1 Create `apps/desktop/src/renderer/lib/hooks/use-voice-input.ts` as the shared facade for desktop voice input. It composes `useVoiceRecording`, `trpc.voice.transcribe`, and `useSpeechRecognitionFallback`.
- [x] 3.2 The facade SHALL expose one unified contract: `isAvailable`, `backend`, `isRecording`, `isTranscribing`, `audioLevel`, `error`, `startRecording`, `stopRecording`, and `cancelRecording`.
- [x] 3.3 The facade SHALL prefer OpenAI Whisper when an OpenAI key is configured; otherwise it SHALL use native `SpeechRecognition` only when native support is expected and actually detected in the renderer.
- [x] 3.4 The facade SHALL append transcripts through a caller-supplied callback using the same whitespace-normalization rules already used after Whisper transcription.

## 4. Desktop-Wide Chat Input Integration

- [x] 4.1 Update `apps/desktop/src/renderer/features/agents/main/chat-input-area.tsx` to consume the shared voice facade instead of wiring `useVoiceRecording` directly.
- [x] 4.2 Update `apps/desktop/src/renderer/features/agents/main/new-chat-form.tsx` to consume the same shared voice facade so the UX change applies everywhere in the desktop chat input surface.
- [x] 4.3 In both files, add a `useEffect` that watches `hasContent`. When `hasContent` transitions to `true` while voice recording is active, call the facade's `cancelRecording()` and suppress transcript insertion.

## 5. Standardized Error Handling

- [x] 5.1 Standardize the permission-denied toast across both backends to "Microphone access denied. Update permissions in System Settings."
- [x] 5.2 Standardize the native network-error toast to an OS-focused message that also mentions Whisper as an optional fallback.
- [x] 5.3 Ensure both desktop chat-input prompts use the same toast/error behavior through the shared facade rather than duplicating backend-specific branches.

## 6. Verification

- [x] 6.1 Run `bun run ts:check` inside `apps/desktop` and fix any new type errors introduced by these changes.
- [x] 6.2 Manually test on macOS: confirm mic icon appears without OpenAI key, clicking mic triggers OS permission prompt, speech is transcribed and inserted into input.
- [x] 6.3 Manually test the icon switch: open a fresh chat, verify mic icon shows; type any character, verify arrow-up shows; clear text, verify mic returns.
- [x] 6.4 Manually test recording cancel: click mic, start speaking, then type — verify recording is cancelled and no transcription is appended.
- [x] 6.5 Manually test that with OpenAI key configured, the Whisper path is still used (not the native path) in both `chat-input-area` and `new-chat-form`.
