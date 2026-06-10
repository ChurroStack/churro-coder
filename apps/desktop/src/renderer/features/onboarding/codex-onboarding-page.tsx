'use client';

import { useAtomValue, useSetAtom } from 'jotai';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { CodexLoginContent } from '../agents/components/codex-login-content';
import { useCodexLoginFlow } from '../agents/hooks/use-codex-login-flow';
import { billingMethodAtom, codexOnboardingAuthMethodAtom, codexOnboardingCompletedAtom } from '../../lib/atoms';

export function CodexOnboardingPage() {
  const billingMethod = useAtomValue(billingMethodAtom);
  const setBillingMethod = useSetAtom(billingMethodAtom);
  const setCodexOnboardingCompleted = useSetAtom(codexOnboardingCompletedAtom);
  const setCodexOnboardingAuthMethod = useSetAtom(codexOnboardingAuthMethodAtom);
  const didAutoStartRef = useRef(false);
  const onboardingMethod = useMemo(() => {
    if (billingMethod === 'codex-api-key') return 'api_key';
    return 'chatgpt';
  }, [billingMethod]);

  const {
    state,
    method,
    apiKeyInput,
    url,
    error,
    isRunning,
    isOpeningUrl,
    start,
    saveApiKey,
    setMethod,
    setApiKeyInput,
    cancel,
    openUrl
  } = useCodexLoginFlow();

  useEffect(() => {
    setMethod(onboardingMethod);
  }, [onboardingMethod, setMethod]);

  useEffect(() => {
    if (onboardingMethod !== 'chatgpt') {
      return;
    }

    // Wait until flow state reflects selected onboarding method to avoid
    // triggering OAuth from the default "chatgpt" value on first render.
    if (method !== onboardingMethod) {
      return;
    }

    if (didAutoStartRef.current) {
      return;
    }

    didAutoStartRef.current = true;
    void start();
  }, [method, onboardingMethod, start]);

  useEffect(() => {
    if (state === 'success') {
      setCodexOnboardingCompleted(true);
      setCodexOnboardingAuthMethod(method);
    }
  }, [method, setCodexOnboardingAuthMethod, setCodexOnboardingCompleted, state]);

  const handleBack = async () => {
    if (isRunning) {
      await cancel();
    }
    setBillingMethod(null);
  };

  // Skip subscription: enter the app without resolving a token. The native
  // codex CLI handles its own auth for codex-cli harness chats, so a token
  // is not required here.
  const handleSkip = async () => {
    if (isRunning) {
      await cancel();
    }
    setCodexOnboardingCompleted(true);
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      <div className="fixed top-0 left-0 right-0 h-10" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <button
        onClick={() => void handleBack()}
        className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors">
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="w-full max-w-[480px] px-4">
        <CodexLoginContent
          state={state}
          method={method}
          apiKey={apiKeyInput}
          error={error}
          url={url}
          isOpeningUrl={isOpeningUrl}
          isConnecting={isRunning || isOpeningUrl}
          onOpenUrl={() => {
            void openUrl();
          }}
          onRetry={() => {
            void start();
          }}
          onApiKeyChange={setApiKeyInput}
          onSubmitApiKey={() => {
            void saveApiKey();
          }}
        />

        {/* Skip subscription — use the native Codex CLI instead */}
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => void handleSkip()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline">
            Skip for now — I'll use the Codex CLI
          </button>
        </div>
      </div>
    </div>
  );
}
