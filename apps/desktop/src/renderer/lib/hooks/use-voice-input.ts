import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '../trpc';
import { blobToBase64, getAudioFormat, useVoiceRecording } from './use-voice-recording';
import { useSpeechRecognitionFallback } from './use-speech-recognition-fallback';

type VoiceBackend = 'native' | 'openai' | 'unavailable';

interface VoiceAvailability {
  available: boolean;
  method: 'native' | 'openai' | null;
  nativeExpected: boolean;
  openAiAvailable: boolean;
  reason?: string | undefined;
}

interface UseVoiceInputOptions {
  onError?: (error: Error) => void;
  onTranscript?: (text: string) => void;
}

interface UseVoiceInputReturn {
  audioLevel: number;
  backend: VoiceBackend;
  cancelRecording: () => void;
  error: Error | null;
  isAvailable: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  voiceAvailability: VoiceAvailability | undefined;
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function resolveSpeechRecognitionAvailability(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    Boolean(
      (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
    ) ||
    Boolean(
      (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    )
  );
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn {
  const { onError, onTranscript } = options;
  const mountedRef = useRef(true);
  const [isTranscribing, setIsTranscribing] = useState(false);
  // Refs (not state) so the SpeechRecognition.onresult handler — which is
  // installed once at start time — observes the latest value when a late
  // result lands between stopRecording and cancelRecording.
  const nativeTranscriptSuppressedRef = useRef(false);
  const nativeHasPendingResultRef = useRef(false);

  const { data: voiceAvailability } = trpc.voice.isAvailable.useQuery();
  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const hasSpeechRecognition = resolveSpeechRecognitionAvailability();

  const openAiRecording = useVoiceRecording();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openAiAvailable = voiceAvailability?.openAiAvailable ?? false;
  const nativeExpected = voiceAvailability?.nativeExpected ?? false;

  const backend = useMemo<VoiceBackend>(() => {
    if (openAiAvailable) return 'openai';
    if (nativeExpected && hasSpeechRecognition) return 'native';
    return 'unavailable';
  }, [hasSpeechRecognition, nativeExpected, openAiAvailable]);

  useEffect(() => {
    console.log(
      '[VoiceInput] backend=%s openai=%s nativeExpected=%s speechRecognition=%s available=%s',
      backend,
      String(openAiAvailable),
      String(nativeExpected),
      String(hasSpeechRecognition),
      String(backend !== 'unavailable')
    );
  }, [backend, hasSpeechRecognition, nativeExpected, openAiAvailable]);

  const isAvailable = backend !== 'unavailable';

  // Clears UI-side transcription state only. The suppression flag is
  // intentionally NOT reset here so a late onresult that races a
  // cancel still observes suppression=true. It is reset on the next
  // startRecording — the natural "clean slate" boundary.
  const finishNativeTranscription = useCallback(() => {
    nativeHasPendingResultRef.current = false;
    if (mountedRef.current) {
      setIsTranscribing(false);
    }
  }, []);

  const nativeRecording = useSpeechRecognitionFallback({
    onTranscript: (text) => {
      const normalized = normalizeTranscript(text);
      if (normalized && !nativeTranscriptSuppressedRef.current) {
        onTranscript?.(normalized);
      }
    },
    onComplete: finishNativeTranscription,
    onError: (error) => {
      finishNativeTranscription();
      onError?.(error);
    }
  });

  const startRecording = useCallback(async () => {
    if (!isAvailable) {
      const unavailableError = new Error('Voice input unavailable on this device.');
      console.warn('[VoiceInput] action=start backend=unavailable');
      onError?.(unavailableError);
      throw unavailableError;
    }

    if (backend === 'openai') {
      console.log('[VoiceInput] action=start backend=openai');
      try {
        await openAiRecording.startRecording();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to start recording'));
        throw error;
      }
      return;
    }

    nativeTranscriptSuppressedRef.current = false;
    nativeHasPendingResultRef.current = false;
    console.log('[VoiceInput] action=start backend=native');
    try {
      await nativeRecording.startRecording();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Failed to start speech recognition'));
      throw error;
    }
  }, [backend, isAvailable, nativeRecording, onError, openAiRecording]);

  const stopRecording = useCallback(async () => {
    if (backend === 'unavailable') {
      return;
    }

    if (backend === 'native') {
      console.log('[VoiceInput] action=stop backend=native');
      if (!nativeRecording.isRecording) return;
      nativeHasPendingResultRef.current = true;
      nativeTranscriptSuppressedRef.current = false;
      if (mountedRef.current) {
        setIsTranscribing(true);
      }
      await nativeRecording.stopRecording();
      return;
    }

    if (!openAiRecording.isRecording) return;

    console.log('[VoiceInput] action=stop backend=openai');
    if (mountedRef.current) {
      setIsTranscribing(true);
    }

    try {
      const blob = await openAiRecording.stopRecording();
      if (blob.size < 1000) {
        return;
      }

      const base64 = await blobToBase64(blob);
      const format = getAudioFormat(blob.type);
      const result = await transcribeMutation.mutateAsync({ audio: base64, format });
      const normalized = normalizeTranscript(result.text ?? '');

      if (normalized) {
        onTranscript?.(normalized);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Voice transcription failed'));
      throw error;
    } finally {
      if (mountedRef.current) {
        setIsTranscribing(false);
      }
    }
  }, [backend, nativeRecording, onError, onTranscript, openAiRecording, transcribeMutation]);

  const cancelRecording = useCallback(() => {
    if (backend === 'native') {
      const pending = nativeHasPendingResultRef.current;
      const recording = nativeRecording.isRecording;
      console.log(
        '[VoiceInput] action=cancel backend=native pending=%s recording=%s',
        String(pending),
        String(recording)
      );
      // Set synchronously so an in-flight onresult ref-check sees suppression.
      nativeTranscriptSuppressedRef.current = pending || recording;
      nativeRecording.cancelRecording();
      finishNativeTranscription();
      return;
    }

    console.log('[VoiceInput] action=cancel backend=openai');
    openAiRecording.cancelRecording();
    if (mountedRef.current) {
      setIsTranscribing(false);
    }
  }, [backend, finishNativeTranscription, nativeRecording, openAiRecording]);

  const error = backend === 'native' ? nativeRecording.error : openAiRecording.error;
  const isRecording = backend === 'native' ? nativeRecording.isRecording : openAiRecording.isRecording;
  const audioLevel = backend === 'native' ? nativeRecording.audioLevel : openAiRecording.audioLevel;

  return {
    voiceAvailability: voiceAvailability as VoiceAvailability | undefined,
    isAvailable,
    backend,
    isRecording,
    isTranscribing,
    audioLevel,
    error,
    startRecording,
    stopRecording,
    cancelRecording
  };
}
