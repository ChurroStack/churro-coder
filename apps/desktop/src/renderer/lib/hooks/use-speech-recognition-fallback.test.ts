// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  speechRecognitionErrorMessages,
  useSpeechRecognitionFallback
} from './use-speech-recognition-fallback';

interface FakeResult {
  isFinal: boolean;
  0: { transcript: string };
}

class FakeSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  startCount = 0;
  stopCount = 0;
  abortCount = 0;

  start() {
    this.startCount += 1;
  }
  stop() {
    this.stopCount += 1;
  }
  abort() {
    this.abortCount += 1;
  }

  emitResult(transcript: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal, 0: { transcript } }]
    });
  }

  emitError(error: string, message?: string) {
    this.onerror?.({ error, message });
  }

  emitEnd() {
    this.onend?.();
  }
}

let lastRecognition: FakeSpeechRecognition | null = null;

beforeEach(() => {
  lastRecognition = null;
  (window as unknown as { SpeechRecognition: typeof FakeSpeechRecognition }).SpeechRecognition =
    class extends FakeSpeechRecognition {
      constructor() {
        super();
        lastRecognition = this;
      }
    };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('useSpeechRecognitionFallback', () => {
  it('reports isAvailable when SpeechRecognition constructor is present', () => {
    const { result } = renderHook(() => useSpeechRecognitionFallback({}));
    expect(result.current.isAvailable).toBe(true);
  });

  it('reports unavailable when no SpeechRecognition constructor is present', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognitionFallback({}));
    expect(result.current.isAvailable).toBe(false);
  });

  it('emits the final transcript through onTranscript and clears recording state on end', async () => {
    const onTranscript = vi.fn();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useSpeechRecognitionFallback({ onTranscript, onComplete })
    );

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);
    expect(lastRecognition?.startCount).toBe(1);

    act(() => {
      lastRecognition?.emitResult('hello world');
      lastRecognition?.emitEnd();
    });

    expect(onTranscript).toHaveBeenCalledWith('hello world');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.isRecording).toBe(false);
  });

  it('silently completes when onend fires without any prior result (silence)', async () => {
    const onTranscript = vi.fn();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useSpeechRecognitionFallback({ onTranscript, onComplete })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      lastRecognition?.emitEnd();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.isRecording).toBe(false);
  });

  it('normalizes not-allowed errors to the standard microphone-denied message', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognitionFallback({ onError }));

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      lastRecognition?.emitError('not-allowed');
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe(speechRecognitionErrorMessages.microphoneDenied);
    expect(result.current.error?.message).toBe(speechRecognitionErrorMessages.microphoneDenied);
    expect(result.current.isRecording).toBe(false);
  });

  it('normalizes network errors to the network-unavailable message', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognitionFallback({ onError }));

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      lastRecognition?.emitError('network');
    });

    expect(onError.mock.calls[0][0].message).toBe(
      speechRecognitionErrorMessages.networkUnavailable
    );
  });

  it('aborts on cancelRecording and does not invoke onComplete', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSpeechRecognitionFallback({ onComplete }));

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      result.current.cancelRecording();
    });

    expect(lastRecognition?.abortCount).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  it('keeps isRecording true after stopRecording until onend fires', async () => {
    const { result } = renderHook(() => useSpeechRecognitionFallback({}));
    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await result.current.stopRecording();
    });
    expect(lastRecognition?.stopCount).toBe(1);
    expect(result.current.isRecording).toBe(true);

    act(() => {
      lastRecognition?.emitEnd();
    });
    expect(result.current.isRecording).toBe(false);
  });

  it('only runs unmount cleanup once even when option identities change between renders', async () => {
    const onComplete = vi.fn();
    const { result, rerender, unmount } = renderHook(
      (props: { onComplete: () => void }) =>
        useSpeechRecognitionFallback({ onComplete: props.onComplete }),
      { initialProps: { onComplete } }
    );

    await act(async () => {
      await result.current.startRecording();
    });
    expect(lastRecognition?.abortCount).toBe(0);

    // Re-render with a brand-new onComplete identity. The old buggy version
    // recreated `cancelRecording` and triggered the effect's cleanup, which
    // would abort the in-flight recording.
    rerender({ onComplete: vi.fn() });
    rerender({ onComplete: vi.fn() });
    expect(lastRecognition?.abortCount).toBe(0);
    expect(result.current.isRecording).toBe(true);

    unmount();
    expect(lastRecognition?.abortCount).toBe(1);
  });

  it('does not start a new session if one is already active', async () => {
    const { result } = renderHook(() => useSpeechRecognitionFallback({}));
    await act(async () => {
      await result.current.startRecording();
    });
    const firstRecognition = lastRecognition;
    await act(async () => {
      await result.current.startRecording();
    });
    expect(lastRecognition).toBe(firstRecognition);
    expect(firstRecognition?.startCount).toBe(1);
  });
});
