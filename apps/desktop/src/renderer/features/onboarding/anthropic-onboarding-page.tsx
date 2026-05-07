'use client';

import { useSetAtom } from 'jotai';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ClaudeCodeIcon, IconSpinner } from '../../components/ui/icons';
import { Logo } from '../../components/ui/logo';
import { anthropicOnboardingCompletedAtom, billingMethodAtom } from '../../lib/atoms';
import { trpc } from '../../lib/trpc';

type AuthFlowState = { step: 'idle' } | { step: 'connecting'; sessionId: string } | { step: 'error'; message: string };

export function AnthropicOnboardingPage() {
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: 'idle' });
  const [ignoredExistingToken, setIgnoredExistingToken] = useState(false);
  const [isUsingExistingToken, setIsUsingExistingToken] = useState(false);
  const [existingTokenError, setExistingTokenError] = useState<string | null>(null);
  const autoCompletedRef = useRef(false);
  const didAutoStartRef = useRef(false);
  // Baseline snapshot taken on first keychain poll. Success = diff from baseline.
  const baselineCredsRef = useRef<{ accessToken: string | null; expiresAt: number | null } | null>(null);
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom);
  const setBillingMethod = useSetAtom(billingMethodAtom);

  const handleBack = () => {
    setBillingMethod(null);
  };

  const formatTokenPreview = (token: string) => {
    const trimmed = token.trim();
    if (trimmed.length <= 16) return trimmed;
    return `${trimmed.slice(0, 19)}...${trimmed.slice(-6)}`;
  };

  const startAuthMutation = trpc.claudeCode.startAuth.useMutation();
  const cancelAuthMutation = trpc.claudeCode.cancelAuth.useMutation();
  const importSystemTokenMutation = trpc.claudeCode.importSystemToken.useMutation();
  const activeSessionId = flowState.step === 'connecting' ? flowState.sessionId : '';

  const existingTokenQuery = trpc.claudeCode.getSystemToken.useQuery();
  const existingToken = existingTokenQuery.data?.token ?? null;
  const hasExistingToken = !!existingToken;
  const checkedExistingToken = !existingTokenQuery.isLoading;
  const shouldOfferExistingToken = checkedExistingToken && hasExistingToken && !ignoredExistingToken;

  // Keychain poll: sole success-detection fallback. Every 5 s while on this page.
  const credsQuery = trpc.claudeCode.getSystemCredentials.useQuery(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: true
  });

  // Session poll: primary completion signal. This closes the loop when the
  // main process already saw the CLI exit successfully but the keychain diff
  // arrives late or is missed while the window is unfocused.
  const authStatusInput = { sandboxUrl: 'local', sessionId: activeSessionId };
  const authStatusOptions = {
    enabled: flowState.step === 'connecting',
    refetchInterval: 1000,
    refetchIntervalInBackground: true
  };
  const authStatusQuery = trpc.claudeCode.pollStatus.useQuery(authStatusInput, authStatusOptions);

  // Seed baseline on first successful poll.
  useEffect(() => {
    if (!credsQuery.isFetched || baselineCredsRef.current !== null) return;
    baselineCredsRef.current = {
      accessToken: credsQuery.data?.accessToken ?? null,
      expiresAt: credsQuery.data?.expiresAt ?? null
    };
    if (import.meta.env.DEV) {
      console.log('[ClaudeAuth] onboarding: baseline seeded, has=', !!baselineCredsRef.current.accessToken);
    }
  }, [credsQuery.isFetched, credsQuery.data]);

  useEffect(() => {
    if (flowState.step !== 'connecting' || autoCompletedRef.current || !authStatusQuery.data) return;

    if (authStatusQuery.data.state === 'success') {
      autoCompletedRef.current = true;
      console.log('[ClaudeAuth] onboarding: session reported success, completing auth', {
        sessionId: flowState.sessionId
      });
      setAnthropicOnboardingCompleted(true);
      return;
    }

    if (authStatusQuery.data.state === 'error') {
      console.log('[ClaudeAuth] onboarding: session reported error', {
        sessionId: flowState.sessionId,
        error: authStatusQuery.data.error
      });
      setFlowState({
        step: 'error',
        message: authStatusQuery.data.error ?? 'Authentication failed'
      });
    }
  }, [flowState, authStatusQuery.data, setAnthropicOnboardingCompleted]);

  // Detect fresh keychain write from the CLI's OAuth callback.
  useEffect(() => {
    if (flowState.step !== 'connecting' || autoCompletedRef.current || !credsQuery.data || !baselineCredsRef.current) {
      return;
    }
    const baseline = baselineCredsRef.current;
    const curr = credsQuery.data;
    const fresh =
      !!curr.accessToken && (curr.accessToken !== baseline.accessToken || curr.expiresAt !== baseline.expiresAt);
    if (!fresh) return;

    autoCompletedRef.current = true;
    if (import.meta.env.DEV) console.log('[ClaudeAuth] onboarding: fresh keychain token detected, importing');
    importSystemTokenMutation
      .mutateAsync()
      .then(() => setAnthropicOnboardingCompleted(true))
      .catch((e) => {
        autoCompletedRef.current = false;
        console.error('[ClaudeAuth] onboarding: import failed', e);
        setFlowState({ step: 'error', message: e instanceof Error ? e.message : 'Import failed' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowState.step, flowState.step === 'connecting' ? flowState.sessionId : null, credsQuery.data]);

  const startConnect = useCallback(async () => {
    if (import.meta.env.DEV) console.log('[ClaudeAuth] onboarding: flow state connecting');
    try {
      const result = await startAuthMutation.mutateAsync();
      setFlowState({ step: 'connecting', sessionId: result.sessionId });
    } catch (err) {
      setFlowState({
        step: 'error',
        message: err instanceof Error ? err.message : 'Failed to start authentication'
      });
    }
  }, [startAuthMutation]);

  // Auto-start once we know whether to offer existing token. The
  // `didAutoStartRef` guard prevents this effect from re-firing when
  // `shouldOfferExistingToken` flips to false during a reject - the
  // reject handler does its own manual `startConnect`.
  useEffect(() => {
    if (didAutoStartRef.current) return;
    if (!checkedExistingToken || shouldOfferExistingToken || flowState.step !== 'idle') return;
    didAutoStartRef.current = true;
    void startConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedExistingToken, shouldOfferExistingToken]);

  const handleConnectClick = async () => {
    if (flowState.step === 'connecting') return;
    // Kill the running subprocess before retrying.
    if (flowState.step === 'error') {
      autoCompletedRef.current = false;
    }
    await startConnect();
  };

  const handleUseExistingToken = async () => {
    if (!hasExistingToken || isUsingExistingToken) return;
    setIsUsingExistingToken(true);
    setExistingTokenError(null);
    try {
      await importSystemTokenMutation.mutateAsync();
      setAnthropicOnboardingCompleted(true);
    } catch (err) {
      setExistingTokenError(err instanceof Error ? err.message : 'Failed to use existing token');
      setIsUsingExistingToken(false);
    }
  };

  const handleRejectExistingToken = () => {
    // Suppress the auto-start effect from re-firing once
    // `shouldOfferExistingToken` flips to false on the next render -
    // we're starting auth manually right here.
    didAutoStartRef.current = true;
    setIgnoredExistingToken(true);
    setExistingTokenError(null);
    void startConnect();
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      {/* Draggable title bar area */}
      <div className="fixed top-0 left-0 right-0 h-10" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Back button */}
      <button
        onClick={() => {
          if (flowState.step === 'connecting') {
            cancelAuthMutation.mutate({ sessionId: flowState.sessionId });
          }
          handleBack();
        }}
        className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors">
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="w-full max-w-[440px] space-y-8 px-4">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-5 h-5" fill="white" />
            </div>
            <div className="w-10 h-10 rounded-full bg-[#D97757] flex items-center justify-center">
              <ClaudeCodeIcon className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold tracking-tight">Connect Claude Code</h1>
            <p className="text-sm text-muted-foreground">Connect your Claude Code subscription to get started</p>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-6 flex flex-col items-center">
          {/* Existing-token prompt */}
          {shouldOfferExistingToken && flowState.step === 'idle' && (
            <div className="space-y-4 w-full">
              <div className="p-4 bg-muted/50 border border-border rounded-lg">
                <p className="text-sm font-medium">Existing Claude Code credentials found</p>
                {existingToken && (
                  <pre className="mt-2 px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap break-words font-mono bg-background/60 rounded border border-border/60">
                    {formatTokenPreview(existingToken)}
                  </pre>
                )}
              </div>
              {existingTokenError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{existingTokenError}</p>
                </div>
              )}
              <div className="flex w-full gap-2">
                <button
                  onClick={handleRejectExistingToken}
                  disabled={isUsingExistingToken}
                  className="h-8 px-3 flex-1 bg-muted text-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted/80 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                  Auth with Anthropic
                </button>
                <button
                  onClick={handleUseExistingToken}
                  disabled={isUsingExistingToken}
                  className="h-8 px-3 flex-1 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                  {isUsingExistingToken ? <IconSpinner className="h-4 w-4" /> : 'Use existing token'}
                </button>
              </div>
            </div>
          )}

          {/* Connecting: spinner + manual-terminal hint */}
          {flowState.step === 'connecting' && (
            <div className="space-y-3 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <IconSpinner className="h-4 w-4 shrink-0" />
                <span>Connecting to Claude Code…</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Your browser will open for authorization. If it doesn't, open a terminal and run:{' '}
                <code className="font-mono">claude setup-token</code>
              </p>
            </div>
          )}

          {/* Error */}
          {flowState.step === 'error' && (
            <div className="space-y-4 w-full">
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{flowState.message}</p>
              </div>
              <button
                onClick={handleConnectClick}
                className="w-full h-8 px-3 bg-muted text-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted/80 active:scale-[0.97] flex items-center justify-center">
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
