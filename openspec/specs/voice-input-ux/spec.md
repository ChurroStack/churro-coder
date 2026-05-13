# Voice Input UX

## Purpose

Defines the user-facing behavior of the voice input button and recording states in desktop chat input prompts. Applies to all surfaces using the shared `useVoiceInput` facade (chat-input-area, new-chat-form).

## Requirements

### Requirement: Mic icon visible when input is empty and voice is available
The `AgentSendButton` SHALL display a microphone icon whenever the text input is empty (`hasContent = false`), the system is not streaming, and voice input is available (`showVoiceInput = true`). Voice availability includes both the OpenAI Whisper path and the native STT path, and this behavior SHALL apply to desktop chat input prompts everywhere the shared voice facade is used.

#### Scenario: Empty input, voice available
- **WHEN** the chat input field is empty AND `isVoiceAvailable` is `true`
- **THEN** `AgentSendButton` SHALL show the `MicrophoneIcon`

#### Scenario: Empty input, voice unavailable
- **WHEN** the chat input field is empty AND `isVoiceAvailable` is `false`
- **THEN** `AgentSendButton` SHALL show the arrow-up send icon (current disabled behavior unchanged)

---

### Requirement: Arrow icon replaces mic when user types
The send button icon SHALL transition to the arrow-up send icon as soon as the user types any character into the input. The microphone SHALL not activate while text is present.

#### Scenario: User types into empty input
- **WHEN** the chat input transitions from empty to having content (any character typed)
- **THEN** `AgentSendButton` SHALL immediately show the arrow-up send icon
- **THEN** no voice recording session SHALL be started by this typing action

#### Scenario: User clears all typed text
- **WHEN** the chat input transitions back to empty (user deletes all text)
- **THEN** `AgentSendButton` SHALL show the `MicrophoneIcon` again (if voice is available)

#### Scenario: User pastes text into empty input
- **WHEN** user pastes non-empty text into the empty input field
- **THEN** `AgentSendButton` SHALL show the arrow-up icon immediately

---

### Requirement: Typing while recording cancels the session
If the user types any text while a voice recording session is active, the recording SHALL be cancelled immediately.

#### Scenario: Typing during active recording
- **WHEN** `isRecording` is `true` AND the input transitions from empty to having content
- **THEN** `cancelRecording()` SHALL be called on the active recording session
- **THEN** `isRecording` SHALL become `false`
- **THEN** no transcription SHALL be triggered

#### Scenario: Desktop-wide behavior consistency
- **WHEN** the user interacts with either `chat-input-area` or `new-chat-form`
- **THEN** the same mic-to-arrow switching, cancel-on-type, and transcription behavior SHALL be applied

---

### Requirement: Recording and transcribing state icons
During recording and transcription, `AgentSendButton` SHALL show the correct state icons regardless of which backend is in use.

#### Scenario: Recording active (mic clicked, listening)
- **WHEN** `isRecording` is `true`
- **THEN** `AgentSendButton` SHALL show the stop (square) icon
- **THEN** clicking the button SHALL call `onVoiceMouseUp` to stop recording

#### Scenario: Transcribing (audio captured, awaiting text)
- **WHEN** `isTranscribing` is `true` (audio captured, awaiting result from either Whisper or native STT)
- **THEN** `AgentSendButton` SHALL show the spinning `Loader2` icon
- **THEN** the button SHALL be disabled

#### Scenario: Transcription completes
- **WHEN** transcribed text is received
- **THEN** the text SHALL be appended to the chat input field
- **THEN** `isTranscribing` SHALL return to `false`
- **THEN** the icon SHALL switch to the arrow-up send icon (because `hasContent` is now `true`)

---

### Requirement: Voice input disabled during streaming
While a chat response is streaming, voice recording SHALL not be available regardless of backend.

#### Scenario: Mic icon during streaming
- **WHEN** `isStreaming` is `true`
- **THEN** `AgentSendButton` SHALL NOT enter voice mode (`isVoiceMode` is `false`)
- **THEN** the button SHALL follow the normal streaming behavior (stop-square or queue-arrow)

---

### Requirement: Mic button tooltip indicates available backend
The tooltip shown when hovering the mic button SHALL be consistent regardless of which backend will be used.

#### Scenario: Tooltip when no OpenAI key (native STT)
- **WHEN** native STT is the active backend AND the button is in mic state
- **THEN** the tooltip SHALL read "Voice input" (same as the OpenAI path)

---

### Requirement: First-use permission prompt on mic click
Clicking the mic button for the first time SHALL trigger the microphone permission request. The request SHALL be initiated by the recording library (MediaRecorder or SpeechRecognition), not proactively on page load.

#### Scenario: First mic click triggers permission dialog
- **WHEN** user clicks the mic button for the first time
- **THEN** the browser/OS microphone permission dialog SHALL appear
- **THEN** if granted, recording SHALL begin
- **THEN** if denied, a toast error SHALL appear and recording SHALL not start
