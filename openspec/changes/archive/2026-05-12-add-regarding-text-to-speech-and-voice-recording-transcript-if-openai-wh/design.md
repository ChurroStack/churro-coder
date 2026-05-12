## Context

Voice transcription today is a single-path feature in both desktop chat-input entry points: `chat-input-area.tsx` and `new-chat-form.tsx` call `trpc.voice.isAvailable`; today that returns `available: true` only when `getOpenAIApiKey()` is set in `voice.ts`. Both components then wire `useVoiceRecording` (MediaRecorder → base64 audio blob) into `trpc.voice.transcribe`, which calls the OpenAI Whisper v1 endpoint.

The `AgentSendButton` icon logic is already correct for the desired UX: `isVoiceMode = showVoiceInput && !isStreaming && (!hasContent || isRecording)` naturally shows the mic when the field is empty and switches to arrow-up when text is present. The only broken assumption is that `showVoiceInput` is `false` for users without an OpenAI key.

**Platform availability:**
- **macOS ≥ Catalina**: Electron's Chromium exposes `window.SpeechRecognition` (or `webkitSpeechRecognition`) backed by the on-device `SFSpeechRecognizer` — no network required.
- **Windows 10/11**: Chromium exposes `window.SpeechRecognition` backed by Windows Speech Recognition, which works locally if a speech language pack is installed.
- **Linux**: Chromium typically does not expose `window.SpeechRecognition` in standard Electron builds (no built-in OS engine), so native fallback is unavailable.

## Goals / Non-Goals

**Goals:**
- Voice input works on macOS and Windows even without an OpenAI key.
- Mic icon appears in the send button whenever the text field is empty and any voice backend is functional.
- Icon transitions to arrow-up the moment the user types any text.
- Permission denial and speech recognition errors surface as short inline toasts, not silent failures.
- No new npm dependencies added.

**Non-Goals:**
- Continuous (always-on) listening or wake-word detection.
- Linux native STT support (no free offline engine available in Electron without bundling a model).
- Replacing the OpenAI path when a key is present — Whisper stays as the preferred backend.
- Language configuration UI for native STT (defaults to `navigator.language`).

## Decisions

### D1: Broaden `voice.isAvailable`, then confirm native support in the renderer

**Decision:** Broaden `trpc.voice.isAvailable` so it returns voice availability when either an OpenAI key is configured or the current desktop platform is one where native OS speech recognition is expected to be supported. The renderer still performs final feature detection with `!!(window.SpeechRecognition || window.webkitSpeechRecognition)` before it selects the native path.

**Rationale:** The app needs one coarse availability contract that works across both desktop chat-input entry points and keeps the mic visible when the product intends voice to be usable. Main-process platform probing gives that coarse contract; renderer-side feature detection remains the final gate because Web Speech availability can still vary by runtime and Windows language-pack state.

**Contract shape:** `isAvailable` remains the single query, but its payload is broadened so the renderer can distinguish whether OpenAI is configured and whether native capability is expected. The renderer then resolves the final backend using both query data and feature detection.

**Change in both desktop chat inputs:**
```ts
const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const isVoiceAvailable = (voiceAvailability?.available ?? false) && (
  voiceAvailability?.openAiAvailable ||
  (voiceAvailability?.nativeExpected && hasSpeechRecognition)
);
```

### D2: Introduce a shared renderer facade for voice input

**Decision:** Create `use-voice-input.ts` as the shared facade used by both `chat-input-area.tsx` and `new-chat-form.tsx`. Internally it composes the existing `useVoiceRecording` hook for the OpenAI path and a new `use-speech-recognition-fallback.ts` hook for the native path, and exposes one unified contract:

```ts
{
  isAvailable: boolean;
  backend: 'openai' | 'native' | 'unavailable';
  isRecording: boolean;
  isTranscribing: boolean;
  audioLevel: number;
  error: Error | null;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  cancelRecording(): void;
}
```

**Rationale:** `useVoiceRecording` returns a blob-producing stop path, while native `SpeechRecognition` returns text asynchronously via events. Those are incompatible low-level contracts. The facade lets call sites consume one product-level interaction contract while each backend keeps its own lifecycle internally.

The two backend lifecycles remain fundamentally different:
- MediaRecorder: record → blob → async Whisper call → text
- SpeechRecognition: start → browser streams audio to engine → `onresult` event → text

Keeping them in separate backend hooks prevents a single low-level hook from growing two incompatible state machines. The new facade is the only shared abstraction because the two desktop chat-input prompts both need the same user-visible behavior.

**`audioLevel` in native path:** `SpeechRecognition` gives no audio level data. The hook returns a static `0.5` during recognition so the `VoiceWaveIndicator` shows a pulsing-but-non-responsive animation as a visual cue that recording is active.

### D3: Desktop chat-input prompts use the shared facade, not backend-specific wiring

**Decision:** `chat-input-area.tsx` and `new-chat-form.tsx` both consume `useVoiceInput(...)` instead of directly owning backend-specific recording logic. The facade appends transcript text through a shared callback supplied by the caller.

```ts
const voiceInput = useVoiceInput({
  voiceAvailability,
  onTranscript: (text) => appendToEditor(text),
  onError: (err) => toast.error(err.message),
});

async function handleVoiceMouseDown() {
  await voiceInput.startRecording();
}

async function handleVoiceMouseUp() {
  await voiceInput.stopRecording();
}
```

**Alternative:** Leave `chat-input-area.tsx` and `new-chat-form.tsx` on hand-written dispatch logic. Rejected because the repo already has duplicated voice-input behavior in both files and this UX change is explicitly desktop-wide.

### D4: Recording interrupted when user types while mic is active

**Decision:** In both desktop chat-input prompts, an effect watches `hasContent` and calls the facade's `cancelRecording()` if recording is active and content becomes non-empty (user pasted or typed while mic was already open).

**Rationale:** The user's stated rule is "if user starts writing, no audio will be recorded." Without this guard, a user could click mic, then type — the icon would shift to arrow but recording would silently continue in the background.

### D5: Standardize native permission and error handling

**Decision:** Both backends surface errors via `toast.error(...)` using the existing toast system. No new error UI components are needed. Native speech recognition errors are normalized inside `use-speech-recognition-fallback.ts` before they reach the shared facade.

- **Microphone permission denied, service blocked, or native recognition not allowed** (`SpeechRecognition.onerror` values such as `not-allowed` or `service-not-allowed`, plus MediaRecorder `NotAllowedError`): toast "Microphone access denied. Update permissions in System Settings."
- **SpeechRecognition `onerror: network`** (Linux / offline Windows): toast "Native speech recognition is unavailable on this device right now. Check your OS speech settings, or add an OpenAI API key in Settings to use Whisper instead."
- **SpeechRecognition unavailable in the renderer despite native platform expectation**: treat backend as unavailable and do not start recording; the mic remains driven by the resolved availability contract.
- **SpeechRecognition `onend` with no result** (silence timeout): silently clear transcribing state; no toast (user just didn't say anything).
- **Whisper timeout / API error**: existing `transcribeMutation.onError` path already handles this.
- **Tracing**: log the selected voice backend and native `SpeechRecognition` error code/message so runtime failures can be distinguished from Whisper-path failures.

## Risks / Trade-offs

**[Risk] Web Speech API on Windows may require an internet connection on older Windows versions or without a locally installed speech language pack**
→ Mitigation: Catch `onerror: network`, display an OS-focused message, and log the native error code/message. Users on affected Windows configurations can still use voice via OpenAI.

**[Risk] `window.SpeechRecognition` is available but returns empty results silently**
→ Mitigation: `onend` without a prior `onresult` is treated as "no speech detected" — transcribing state clears without error. The user can try again.

**[Risk] Shared facade accidentally exposes overlapping backend state during rapid interaction**
→ Mitigation: The native hook does NOT call `getUserMedia` directly; `SpeechRecognition` manages the media stream internally. The MediaRecorder hook already guards with `isStartingRef`, and the shared facade owns backend selection so only one backend lifecycle can be active at a time.

**[Risk] `SpeechRecognition.start()` throws if called while another recognition session is active**
→ Mitigation: `startNative()` checks `isRecording` state before calling `.start()` and no-ops if already active.

**[Risk] macOS speech recognition privacy prompt blocks recording the first time**
→ Mitigation: The OS handles this automatically via Chromium's mic permission flow; no extra code needed. If denied, the normalized permission-denied handling path fires (`SpeechRecognition.onerror` for native STT, `NotAllowedError` for MediaRecorder).

## Migration Plan

No database migrations. The `isAvailable` tRPC payload mostly grows additively (new `openAiAvailable` and `nativeExpected` flags) so existing callers can continue reading `available`. The `method` literal does change in one place: the OpenAI path now reports `method: 'openai'` instead of the previous `method: 'local'`, and the new native path reports `method: 'native'`. The only consumer of `method` in this repo is the new shared voice facade; renderer-side feature detection remains additive.

Rollout is a standard desktop app release. No feature flag needed — the native path is activated only when OpenAI is absent, native support is expected by the query contract, and `SpeechRecognition` is actually detected in the renderer.

## Open Questions

1. **Windows language packs**: Should the settings UI detect and warn Windows users that a speech language pack is required? Out of scope for this change; defer to a follow-up if user reports are received.
2. **`continuous: true` for dictation mode**: Some users may want to keep speaking without clicking stop. Out of scope — the current push-to-talk mental model is retained.
3. **Audio level animation for native path**: The static `0.5` level gives a "pulsing" animation that doesn't reflect real volume. A more accurate signal would require calling `getUserMedia` separately for analysis (complex). Acceptable for now; revisit if user feedback calls it out.
