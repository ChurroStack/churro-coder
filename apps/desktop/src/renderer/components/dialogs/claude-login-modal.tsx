'use client';

import { useAtom, useSetAtom } from 'jotai';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pendingAuthRetryMessageAtom } from '../../features/agents/atoms';
import {
  agentsLoginModalOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  anthropicOnboardingCompletedAtom,
  type SettingsTab
} from '../../lib/atoms';
import { appStore } from '../../lib/jotai-store';
import { trpc } from '../../lib/trpc';
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { ClaudeCodeIcon, IconSpinner } from '../ui/icons';
import { Logo } from '../ui/logo';

type AuthFlowState = { step: 'idle' } | { step: 'connecting'; sessionId: string } | { step: 'error'; message: string };

type ClaudeLoginModalProps = {
  hideCustomModelSettingsLink?: boolean;
  autoStartAuth?: boolean;
};

export function ClaudeLoginModal({
  hideCustomModelSettingsLink = false,
  autoStartAuth = false
}: ClaudeLoginModalProps) {
  const [open, setOpen] = useAtom(agentsLoginModalOpenAtom);
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom);
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom);
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom);
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: 'idle' });
  const [ignoredExistingToken, setIgnoredExistingToken] = useState(false);
  const [isUsingExistingToken, setIsUsingExistingToken] = useState(false);
  const [existingTokenError, setExistingTokenError] = useState<string | null>(null);
  const autoCompletedRef = useRef(false);
  const didAutoStartForOpenRef = useRef(false);
  // Baseline snapshot taken on the first keychain poll while the modal is open.
  // Success is detected when a subsequent poll returns a different accessToken
  // or expiresAt — meaning the CLI's loopback callback wrote new creds.
  const baselineCredsRef = useRef<{ accessToken: string | null; expiresAt: number | null } | null>(null);

  const startAuthMutation = trpc.claudeCode.startAuth.useMutation();
  const cancelAuthMutation = trpc.claudeCode.cancelAuth.useMutation();
  const importSystemTokenMutation = trpc.claudeCode.importSystemToken.useMutation();
  const trpcUtils = trpc.useUtils();
  const activeSessionId = flowState.step === 'connecting' ? flowState.sessionId : '';

  // Existing keychain creds - offered as a one-click import when present,
  // so users with a valid CLI session don't need to re-authenticate.
  const existingTokenQuery = trpc.claudeCode.getSystemToken.useQuery(undefined, { enabled: open });
  const existingToken = existingTokenQuery.data?.token ?? null;
  const hasExistingToken = !!existingToken;
  const checkedExistingToken = !open || (!existingTokenQuery.isLoading && existingTokenQuery.isFetched);
  const shouldOfferExistingToken = open && checkedExistingToken && hasExistingToken && !ignoredExistingToken;

  // Keychain poll: fallback success-detection mechanism. Runs every 5 s
  // while the modal is open. We compare against a baseline snapshot taken
  // the first time this query resolves; a diff means the CLI's OAuth
  // callback wrote fresh credentials to the keychain.
  const credsQuery = trpc.claudeCode.getSystemCredentials.useQuery(undefined, {
    enabled: open,
    refetchInterval: 5000,
    refetchIntervalInBackground: true
  });

  // Session poll: primary completion signal. The main process already knows
  // when `claude setup-token` exits successfully, so the renderer should not
  // wait indefinitely for a later keychain diff if the session already ended.
  const authStatusInput = { sandboxUrl: 'local', sessionId: activeSessionId };
  const authStatusOptions = {
    enabled: open && flowState.step === 'connecting',
    refetchInterval: 1000,
    refetchIntervalInBackground: true
  };
  const authStatusQuery = trpc.claudeCode.pollStatus.useQuery(authStatusInput, authStatusOptions);

  // Seed baseline on first successful poll.
  useEffect(() => {
    if (!open || !credsQuery.isFetched || baselineCredsRef.current !== null) return;
    baselineCredsRef.current = {
      accessToken: credsQuery.data?.accessToken ?? null,
      expiresAt: credsQuery.data?.expiresAt ?? null
    };
    if (import.meta.env.DEV) {
      console.log('[ClaudeAuth] modal: baseline seeded, has=', !!baselineCredsRef.current.accessToken);
    }
  }, [open, credsQuery.isFetched, credsQuery.data]);

  useEffect(() => {
    if (!open || flowState.step !== 'connecting' || autoCompletedRef.current || !authStatusQuery.data) return;

    if (authStatusQuery.data.state === 'success') {
      autoCompletedRef.current = true;
      console.log('[ClaudeAuth] modal: session reported success, completing auth', {
        sessionId: flowState.sessionId
      });
      handleAuthSuccess();
      return;
    }

    if (authStatusQuery.data.state === 'error') {
      console.log('[ClaudeAuth] modal: session reported error', {
        sessionId: flowState.sessionId,
        error: authStatusQuery.data.error
      });
      setFlowState({
        step: 'error',
        message: authStatusQuery.data.error ?? 'Authentication failed'
      });
    }
  }, [open, flowState, authStatusQuery.data]);

  // Detect new credentials: only fire when connecting, baseline is set,
  // and creds differ from baseline (fresh write from CLI callback).
  useEffect(() => {
    if (
      !open ||
      flowState.step !== 'connecting' ||
      autoCompletedRef.current ||
      !credsQuery.data ||
      !baselineCredsRef.current
    ) {
      return;
    }
    const baseline = baselineCredsRef.current;
    const curr = credsQuery.data;
    const fresh =
      !!curr.accessToken && (curr.accessToken !== baseline.accessToken || curr.expiresAt !== baseline.expiresAt);
    if (!fresh) return;

    autoCompletedRef.current = true;
    if (import.meta.env.DEV) console.log('[ClaudeAuth] modal: fresh keychain token detected, importing');
    importSystemTokenMutation
      .mutateAsync()
      .then(() => handleAuthSuccess())
      .catch((e) => {
        autoCompletedRef.current = false;
        console.error('[ClaudeAuth] modal: import failed', e);
        setFlowState({ step: 'error', message: e instanceof Error ? e.message : 'Import failed' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flowState.step, flowState.step === 'connecting' ? flowState.sessionId : null, credsQuery.data]);

  // Reset all state when modal closes.
  useEffect(() => {
    if (!open) {
      setFlowState({ step: 'idle' });
      setIgnoredExistingToken(false);
      setIsUsingExistingToken(false);
      setExistingTokenError(null);
      didAutoStartForOpenRef.current = false;
      autoCompletedRef.current = false;
      baselineCredsRef.current = null;
    }
  }, [open]);

  const triggerAuthRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom);
    if (pending && pending.provider === 'claude-code') {
      console.log('[ClaudeLoginModal] OAuth success - triggering retry for subChatId:', pending.subChatId);
      appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true });
    }
  };

  const clearPendingRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom);
    if (pending && pending.provider === 'claude-code' && !pending.readyToRetry) {
      console.log('[ClaudeLoginModal] Modal closed without success - clearing pending retry');
      appStore.set(pendingAuthRetryMessageAtom, null);
    }
  };

  const handleAuthSuccess = () => {
    triggerAuthRetry();
    setAnthropicOnboardingCompleted(true);
    setOpen(false);
    void Promise.allSettled([
      trpcUtils.anthropicAccounts.list.invalidate(),
      trpcUtils.anthropicAccounts.getActive.invalidate(),
      trpcUtils.claudeCode.getIntegration.invalidate()
    ]);
  };

  const startConnect = useCallback(async () => {
    if (import.meta.env.DEV) console.log('[ClaudeAuth] modal: flow state connecting');
    try {
      const result = await startAuthMutation.mutateAsync();
      if (import.meta.env.DEV) console.log('[ClaudeAuth] modal: flow state connecting, sessionId=', result.sessionId);
      setFlowState({ step: 'connecting', sessionId: result.sessionId });
    } catch (err) {
      if (import.meta.env.DEV) console.log('[ClaudeAuth] modal: flow state error');
      setFlowState({
        step: 'error',
        message: err instanceof Error ? err.message : 'Failed to start authentication'
      });
    }
  }, [startAuthMutation]);

  const handleConnectClick = useCallback(async () => {
    if (flowState.step === 'connecting') return;
    await startConnect();
  }, [flowState.step, startConnect]);

  // Auto-start when prop is set and we've resolved the keychain check.
  useEffect(() => {
    if (
      !open ||
      !autoStartAuth ||
      flowState.step !== 'idle' ||
      didAutoStartForOpenRef.current ||
      !checkedExistingToken ||
      shouldOfferExistingToken
    ) {
      return;
    }
    didAutoStartForOpenRef.current = true;
    void handleConnectClick();
  }, [autoStartAuth, flowState.step, handleConnectClick, open, checkedExistingToken, shouldOfferExistingToken]);

  const handleUseExistingToken = async () => {
    if (!hasExistingToken || isUsingExistingToken) return;
    setIsUsingExistingToken(true);
    setExistingTokenError(null);
    try {
      await importSystemTokenMutation.mutateAsync();
      handleAuthSuccess();
    } catch (err) {
      setExistingTokenError(err instanceof Error ? err.message : 'Failed to use existing token');
      setIsUsingExistingToken(false);
    }
  };

  const handleRejectExistingToken = () => {
    // Pre-flag the auto-start guard. Without this, the auto-start effect
    // re-fires on the next render (when `shouldOfferExistingToken` flips
    // to false) and races with our manual call here while the
    // `startAuth` mutation is still in flight - spawning two CLI children.
    didAutoStartForOpenRef.current = true;
    setIgnoredExistingToken(true);
    setExistingTokenError(null);
    void handleConnectClick();
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Kill the spawned CLI subprocess if one is running.
      if (flowState.step === 'connecting') {
        cancelAuthMutation.mutate({ sessionId: flowState.sessionId });
      }
      clearPendingRetry();
    }
    setOpen(newOpen);
  };

  const handleOpenModelsSettings = () => {
    clearPendingRetry();
    setSettingsActiveTab('models' as SettingsTab);
    setSettingsOpen(true);
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <div className="space-y-8">
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
              <h1 className="text-base font-semibold tracking-tight">Claude Code</h1>
              <p className="text-sm text-muted-foreground">Connect your Claude Code subscription</p>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6">
            {/* Existing-token prompt */}
            {shouldOfferExistingToken && flowState.step === 'idle' && (
              <div className="space-y-3">
                <div className="p-3 bg-muted/50 border border-border rounded-md">
                  <p className="text-sm font-medium">Existing Claude Code credentials found</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use the token already saved in your system keychain.
                  </p>
                </div>
                {existingTokenError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                    <p className="text-sm text-destructive">{existingTokenError}</p>
                  </div>
                )}
                <div className="flex w-full gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleRejectExistingToken}
                    disabled={isUsingExistingToken}
                    className="flex-1">
                    Auth with Anthropic
                  </Button>
                  <Button onClick={handleUseExistingToken} disabled={isUsingExistingToken} className="flex-1">
                    {isUsingExistingToken ? <IconSpinner className="h-4 w-4" /> : 'Use existing token'}
                  </Button>
                </div>
              </div>
            )}

            {/* Idle: Connect button */}
            {checkedExistingToken && !shouldOfferExistingToken && flowState.step === 'idle' && (
              <Button onClick={handleConnectClick} className="w-full">
                Connect
              </Button>
            )}

            {/* Connecting: spinner + manual-terminal hint */}
            {flowState.step === 'connecting' && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <IconSpinner className="h-4 w-4 shrink-0" />
                  <span>Connecting to Claude Code…</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Your browser will open for authorization. If it doesn't, open a terminal and run:{' '}
                  <code className="font-mono">claude setup-token</code>
                </p>
              </div>
            )}

            {/* Error */}
            {flowState.step === 'error' && (
              <div className="space-y-4">
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{flowState.message}</p>
                </div>
                <Button variant="secondary" onClick={handleConnectClick} className="w-full">
                  Try Again
                </Button>
              </div>
            )}

            {!hideCustomModelSettingsLink && (
              <div className="text-center !mt-2">
                <button
                  type="button"
                  onClick={handleOpenModelsSettings}
                  className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
                  Set a custom model in Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
