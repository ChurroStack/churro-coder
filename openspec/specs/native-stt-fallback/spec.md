# Native STT Fallback

## Purpose

Defines how the desktop uses the browser's native Web Speech API (`window.SpeechRecognition`) as a fallback voice-input backend when no OpenAI API key is configured.

## Requirements

### Requirement: Native STT availability detection
The system SHALL use a two-stage availability check for native STT: broadened tRPC availability metadata from `voice.isAvailable`, plus renderer-side feature detection using `window.SpeechRecognition || window.webkitSpeechRecognition`.

#### Scenario: Native expected and SpeechRecognition present with no OpenAI key
- **WHEN** `window.SpeechRecognition` is defined AND `voice.isAvailable` reports native voice is expected but OpenAI is unavailable
- **THEN** `isVoiceAvailable` in the active desktop chat input prompt SHALL be `true`
- **THEN** the native backend SHALL be eligible for selection

#### Scenario: Native expected but SpeechRecognition absent
- **WHEN** `window.SpeechRecognition` is undefined AND `voice.isAvailable` reports native voice is expected but OpenAI is unavailable
- **THEN** `isVoiceAvailable` in the active desktop chat input prompt SHALL be `false`
- **THEN** the native backend SHALL NOT be started

#### Scenario: SpeechRecognition present and OpenAI key configured
- **WHEN** both `window.SpeechRecognition` is defined AND `voice.isAvailable` reports OpenAI voice is available
- **THEN** the OpenAI Whisper path SHALL be used (OpenAI takes precedence)

---

### Requirement: Native STT recording lifecycle
The `useSpeechRecognitionFallback` hook SHALL manage the full native recording lifecycle using `window.SpeechRecognition`, and the `useVoiceInput` facade SHALL translate that lifecycle into the shared desktop voice-input contract.

#### Scenario: Successful transcription via native STT
- **WHEN** `startRecording()` is called and the user speaks
- **THEN** the hook SHALL call the `onTranscript` callback with the final transcribed text after `recognition.onresult` fires

#### Scenario: Transcribing state after stop
- **WHEN** `stopRecording()` is called
- **THEN** native recording SHALL stop listening
- **THEN** the shared facade SHALL set `isTranscribing: true` while waiting for `onresult` or `onend`
- **THEN** the shared facade SHALL return `isTranscribing` to `false` once `onresult` or `onend` fires

#### Scenario: Silence timeout (no speech detected)
- **WHEN** `recognition.onend` fires without a prior `onresult` event
- **THEN** `isRecording` and the caller's `isTranscribing` SHALL both be `false`
- **THEN** no `onTranscript` SHALL be called and no error toast SHALL be shown

#### Scenario: Audio level during native recording
- **WHEN** native recording is active
- **THEN** `audioLevel` SHALL return a constant `0.5` (no real audio level data from Web Speech API)

---

### Requirement: Microphone permission handling
The system SHALL handle microphone permission denial gracefully on both the OpenAI and native STT paths.

#### Scenario: Permission denied on native path
- **WHEN** native `SpeechRecognition.onerror` reports `not-allowed` or `service-not-allowed`
- **THEN** the system SHALL show a toast error: "Microphone access denied. Update permissions in System Settings."
- **THEN** `isRecording` SHALL remain `false`

#### Scenario: Permission denied on OpenAI path
- **WHEN** `startVoiceRecording()` (MediaRecorder path) results in `NotAllowedError`
- **THEN** the same toast message SHALL be shown

---

### Requirement: Network error on native STT path
The system SHALL detect when `SpeechRecognition` fires `onerror` with `error: 'network'` and surface a helpful message.

#### Scenario: SpeechRecognition network error
- **WHEN** `recognition.onerror` fires with `event.error === 'network'`
- **THEN** the system SHALL show a toast: "Native speech recognition is unavailable on this device right now. Check your OS speech settings, or add an OpenAI API key in Settings to use Whisper instead."
- **THEN** `isRecording` SHALL be `false`
- **THEN** the system SHALL log the native speech error code/message for diagnostics

---

### Requirement: Start guard on native STT hook
The `useSpeechRecognitionFallback` hook SHALL not call `recognition.start()` if a recognition session is already active.

#### Scenario: Rapid double-click on mic button
- **WHEN** `startRecording()` is called while `isRecording` is already `true`
- **THEN** the call SHALL be a no-op (no new session started, no error thrown)
