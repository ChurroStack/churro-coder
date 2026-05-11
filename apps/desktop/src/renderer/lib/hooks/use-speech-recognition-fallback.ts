import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MICROPHONE_DENIED_MESSAGE = 'Microphone access denied. Update permissions in System Settings.';
const NATIVE_NETWORK_ERROR_MESSAGE =
  'Native speech recognition is unavailable on this device right now. Check your OS speech settings, or add an OpenAI API key in Settings to use Whisper instead.';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  isFinal?: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  abort(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

interface UseSpeechRecognitionFallbackOptions {
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onTranscript?: (text: string) => void;
}

interface UseSpeechRecognitionFallbackReturn {
  audioLevel: number;
  cancelRecording: () => void;
  error: Error | null;
  isAvailable: boolean;
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function normalizeSpeechRecognitionError(errorCode: string, message?: string): Error {
  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
    return new Error(MICROPHONE_DENIED_MESSAGE);
  }
  if (errorCode === 'network') {
    return new Error(NATIVE_NETWORK_ERROR_MESSAGE);
  }
  return new Error(message?.trim() || `Speech recognition error: ${errorCode}`);
}

export function useSpeechRecognitionFallback(
  options: UseSpeechRecognitionFallbackOptions
): UseSpeechRecognitionFallbackReturn {
  const { onComplete, onError, onTranscript } = options;
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isCancellingRef = useRef(false);
  const isStartingRef = useRef(false);

  // Latest callbacks held in refs so handlers installed once on the
  // SpeechRecognition instance always see fresh consumer logic without
  // having to rebind onresult/onerror/onend on every render.
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const onTranscriptRef = useRef(onTranscript);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;
  onTranscriptRef.current = onTranscript;

  const isAvailable = useMemo(() => getSpeechRecognitionConstructor() !== null, []);

  const finishSession = useCallback((callOnComplete: boolean) => {
    isStartingRef.current = false;
    setIsRecording(false);

    if (callOnComplete) {
      onCompleteRef.current?.();
    }
  }, []);

  const cleanupRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognitionRef.current = null;
  }, []);

  const cancelRecording = useCallback(() => {
    console.log('[VoiceNative] action=cancel');
    isCancellingRef.current = true;
    finishSession(false);

    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore abort failures during cleanup
    } finally {
      cleanupRecognition();
      isCancellingRef.current = false;
    }
  }, [cleanupRecognition, finishSession]);

  const startRecording = useCallback(async () => {
    if (isStartingRef.current || isRecording) {
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      const unavailableError = new Error('Speech recognition unavailable on this device.');
      console.warn('[VoiceNative] action=start result=unavailable reason=no-speechrecognition-constructor');
      setError(unavailableError);
      throw unavailableError;
    }

    isStartingRef.current = true;
    isCancellingRef.current = false;
    setError(null);

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language;

    recognition.onresult = (event) => {
      const resultIndex = event.resultIndex ?? 0;
      const result = event.results[resultIndex];
      const transcript = result?.[0]?.transcript?.trim();

      if (result?.isFinal !== false && transcript) {
        console.log('[VoiceNative] action=result status=ok chars=%d', transcript.length);
        onTranscriptRef.current?.(transcript);
      }
    };

    recognition.onerror = (event) => {
      if (isCancellingRef.current) {
        return;
      }

      const normalizedError = normalizeSpeechRecognitionError(event.error, event.message);
      console.warn(
        '[VoiceNative] action=error code=%s message=%s normalized=%s',
        event.error,
        event.message ?? '',
        normalizedError.message
      );
      cleanupRecognition();
      setError(normalizedError);
      onErrorRef.current?.(normalizedError);
      finishSession(true);
    };

    recognition.onend = () => {
      const wasCancelling = isCancellingRef.current;
      const shouldComplete = !wasCancelling;
      console.log('[VoiceNative] action=end cancelled=%s complete=%s', String(wasCancelling), String(shouldComplete));

      cleanupRecognition();
      finishSession(shouldComplete);

      isCancellingRef.current = false;
    };

    recognitionRef.current = recognition;

    try {
      console.log('[VoiceNative] action=start lang=%s', recognition.lang);
      recognition.start();
      setIsRecording(true);
      isStartingRef.current = false;
    } catch (err) {
      cleanupRecognition();
      finishSession(false);

      const startError = err instanceof Error ? err : new Error('Failed to start speech recognition');
      console.warn('[VoiceNative] action=start result=exception message=%s', startError.message);
      setError(startError);
      throw startError;
    }
  }, [cleanupRecognition, finishSession, isRecording]);

  const stopRecording = useCallback(async () => {
    if (!recognitionRef.current || !isRecording) {
      return;
    }

    // Leave isRecording true until onend fires so concurrent
    // cancelRecording calls still see an active session and run the
    // abort path instead of falling through their isRecording guard.
    console.log('[VoiceNative] action=stop');
    recognitionRef.current.stop();
  }, [isRecording]);

  // Unmount-only cleanup. The previous version depended on `cancelRecording`
  // which would re-run on every re-render where the consumer's `onComplete`
  // identity changed and silently abort an in-flight recording. A ref keeps
  // the latest cancel function around while letting this effect run once.
  const cancelRecordingRef = useRef(cancelRecording);
  cancelRecordingRef.current = cancelRecording;
  useEffect(() => {
    return () => {
      cancelRecordingRef.current();
    };
  }, []);

  return {
    isAvailable,
    isRecording,
    error,
    audioLevel: isRecording ? 0.5 : 0,
    startRecording,
    stopRecording,
    cancelRecording
  };
}

export const speechRecognitionErrorMessages = {
  microphoneDenied: MICROPHONE_DENIED_MESSAGE,
  networkUnavailable: NATIVE_NETWORK_ERROR_MESSAGE
} as const;
