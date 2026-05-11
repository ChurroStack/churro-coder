// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// Module-level capture of the latest options passed to the mocked
// useSpeechRecognitionFallback so individual tests can simulate native
// callbacks (onTranscript / onComplete / onError) at arbitrary points
// in the lifecycle.
interface NativeOptions {
  onTranscript?: (text: string) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}
let latestNativeOptions: NativeOptions | null = null;
let nativeMockState = {
  isRecording: false,
  error: null as Error | null,
  audioLevel: 0,
  startCount: 0,
  stopCount: 0,
  cancelCount: 0
};

let voiceAvailabilityFixture: {
  available: boolean;
  method: string | null;
  openAiAvailable: boolean;
  nativeExpected: boolean;
  reason?: string;
} = {
  available: false,
  method: null,
  openAiAvailable: false,
  nativeExpected: false
};

vi.mock('../trpc', () => ({
  trpc: {
    voice: {
      isAvailable: {
        useQuery: () => ({ data: voiceAvailabilityFixture })
      },
      transcribe: {
        useMutation: () => ({
          mutateAsync: vi.fn(async (_input: unknown) => ({ text: 'whisper output' }))
        })
      }
    }
  }
}));

vi.mock('./use-voice-recording', () => ({
  blobToBase64: vi.fn(async () => 'AAA='),
  getAudioFormat: vi.fn(() => 'webm'),
  useVoiceRecording: () => ({
    isRecording: false,
    error: null,
    audioLevel: 0,
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => new Blob([new Uint8Array(2048)])),
    cancelRecording: vi.fn()
  })
}));

vi.mock('./use-speech-recognition-fallback', async () => {
  const { useState } = await import('react');
  return {
    useSpeechRecognitionFallback: (opts: NativeOptions) => {
      // Always capture the latest options reference so the test can
      // drive callbacks even after re-renders.
      latestNativeOptions = opts;
      const [isRecording, setIsRecording] = useState(false);
      return {
        isAvailable: true,
        isRecording,
        error: nativeMockState.error,
        audioLevel: nativeMockState.audioLevel,
        startRecording: async () => {
          nativeMockState.startCount += 1;
          setIsRecording(true);
          nativeMockState.isRecording = true;
        },
        stopRecording: async () => {
          nativeMockState.stopCount += 1;
        },
        cancelRecording: () => {
          nativeMockState.cancelCount += 1;
          setIsRecording(false);
          nativeMockState.isRecording = false;
        }
      };
    }
  };
});

import { useVoiceInput } from './use-voice-input';

beforeEach(() => {
  latestNativeOptions = null;
  nativeMockState = {
    isRecording: false,
    error: null,
    audioLevel: 0,
    startCount: 0,
    stopCount: 0,
    cancelCount: 0
  };
  voiceAvailabilityFixture = {
    available: false,
    method: null,
    openAiAvailable: false,
    nativeExpected: false
  };
  // Default: SpeechRecognition is present in the renderer.
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {};
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('useVoiceInput backend selection', () => {
  it('picks openai when OpenAI is reported available', () => {
    voiceAvailabilityFixture = {
      available: true,
      method: 'openai',
      openAiAvailable: true,
      nativeExpected: true
    };
    const { result } = renderHook(() => useVoiceInput({}));
    expect(result.current.backend).toBe('openai');
    expect(result.current.isAvailable).toBe(true);
  });

  it('picks native when openai is absent but native is expected and SpeechRecognition exists', () => {
    voiceAvailabilityFixture = {
      available: true,
      method: 'native',
      openAiAvailable: false,
      nativeExpected: true
    };
    const { result } = renderHook(() => useVoiceInput({}));
    expect(result.current.backend).toBe('native');
    expect(result.current.isAvailable).toBe(true);
  });

  it('reports unavailable when native is expected but SpeechRecognition is missing', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    voiceAvailabilityFixture = {
      available: true,
      method: 'native',
      openAiAvailable: false,
      nativeExpected: true
    };
    const { result } = renderHook(() => useVoiceInput({}));
    expect(result.current.backend).toBe('unavailable');
    expect(result.current.isAvailable).toBe(false);
  });

  it('reports unavailable when neither openai nor native is expected', () => {
    voiceAvailabilityFixture = {
      available: false,
      method: null,
      openAiAvailable: false,
      nativeExpected: false
    };
    const { result } = renderHook(() => useVoiceInput({}));
    expect(result.current.backend).toBe('unavailable');
  });
});

describe('useVoiceInput native transcript suppression', () => {
  beforeEach(() => {
    voiceAvailabilityFixture = {
      available: true,
      method: 'native',
      openAiAvailable: false,
      nativeExpected: true
    };
  });

  it('drops a late native onresult that arrives after cancelRecording', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));
    expect(result.current.backend).toBe('native');

    await act(async () => {
      await result.current.startRecording();
    });
    expect(nativeMockState.startCount).toBe(1);

    // Simulate user typing → cancel runs while recording is still active.
    act(() => {
      result.current.cancelRecording();
    });
    expect(nativeMockState.cancelCount).toBe(1);

    // A delayed onresult that slipped through before the recognition
    // engine actually halted MUST be ignored thanks to the suppress ref.
    act(() => {
      latestNativeOptions?.onTranscript?.('late transcript');
    });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('forwards a native transcript through onTranscript when no cancel happened', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopRecording();
    });
    act(() => {
      latestNativeOptions?.onTranscript?.('hello there');
      latestNativeOptions?.onComplete?.();
    });

    expect(onTranscript).toHaveBeenCalledWith('hello there');
    expect(result.current.isTranscribing).toBe(false);
  });

  it('clears isTranscribing after onComplete fires', async () => {
    const { result } = renderHook(() => useVoiceInput({}));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopRecording();
    });
    expect(result.current.isTranscribing).toBe(true);

    act(() => {
      latestNativeOptions?.onComplete?.();
    });
    expect(result.current.isTranscribing).toBe(false);
  });
});
