"use client"

import { useAtom, useSetAtom } from "jotai"
import { X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import {
  agentsLoginModalOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  anthropicOnboardingCompletedAtom,
  type SettingsTab,
} from "../../lib/atoms"
import { appStore } from "../../lib/jotai-store"
import { trpc } from "../../lib/trpc"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
} from "../ui/alert-dialog"
import { Button } from "../ui/button"
import { ClaudeCodeIcon, IconSpinner } from "../ui/icons"
import { Input } from "../ui/input"
import { Logo } from "../ui/logo"

type AuthFlowState =
  | { step: "idle" }
  | { step: "starting" }
  | {
      step: "waiting_url"
      sandboxId: string
      sandboxUrl: string
      sessionId: string
    }
  | {
      step: "has_url"
      sandboxId: string
      oauthUrl: string
      sandboxUrl: string
      sessionId: string
    }
  | { step: "submitting" }
  | { step: "error"; message: string }

type ClaudeLoginModalProps = {
  hideCustomModelSettingsLink?: boolean
  autoStartAuth?: boolean
}

export function ClaudeLoginModal({
  hideCustomModelSettingsLink = false,
  autoStartAuth = false,
}: ClaudeLoginModalProps) {
  const [open, setOpen] = useAtom(agentsLoginModalOpenAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(
    anthropicOnboardingCompletedAtom,
  )
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const [authCode, setAuthCode] = useState("")
  const [userClickedConnect, setUserClickedConnect] = useState(false)
  const [urlOpened, setUrlOpened] = useState(false)
  const [savedOauthUrl, setSavedOauthUrl] = useState<string | null>(null)
  const [ignoredExistingToken, setIgnoredExistingToken] = useState(false)
  const [isUsingExistingToken, setIsUsingExistingToken] = useState(false)
  const [existingTokenError, setExistingTokenError] = useState<string | null>(
    null,
  )
  const urlOpenedRef = useRef(false)
  const didAutoStartForOpenRef = useRef(false)
  const autoCompletedRef = useRef(false)

  // tRPC mutations
  const startAuthMutation = trpc.claudeCode.startAuth.useMutation()
  const submitCodeMutation = trpc.claudeCode.submitCode.useMutation()
  const openOAuthUrlMutation = trpc.claudeCode.openOAuthUrl.useMutation()
  const importSystemTokenMutation =
    trpc.claudeCode.importSystemToken.useMutation()
  const trpcUtils = trpc.useUtils()

  // Detect an existing Claude Code keychain token so we can offer a
  // one-click import instead of running `claude setup-token` again. When
  // valid creds already exist, the setup-token subprocess can hang in
  // closed-stdin and leave the user stuck on the Connect spinner. Only
  // query while the modal is open to avoid keychain access at app boot.
  const existingTokenQuery = trpc.claudeCode.getSystemToken.useQuery(
    undefined,
    { enabled: open },
  )
  const existingToken = existingTokenQuery.data?.token ?? null
  const hasExistingToken = !!existingToken
  const checkedExistingToken =
    !open || (!existingTokenQuery.isLoading && existingTokenQuery.isFetched)
  const shouldOfferExistingToken =
    open && checkedExistingToken && hasExistingToken && !ignoredExistingToken

  // Poll for OAuth URL and — once the browser is open — for subprocess completion
  const pollStatusQuery = trpc.claudeCode.pollStatus.useQuery(
    {
      sandboxUrl:
        flowState.step === "waiting_url" || flowState.step === "has_url"
          ? flowState.sandboxUrl
          : "",
      sessionId:
        flowState.step === "waiting_url" || flowState.step === "has_url"
          ? flowState.sessionId
          : "",
    },
    {
      enabled:
        flowState.step === "waiting_url" ||
        (flowState.step === "has_url" && urlOpened),
      refetchInterval: 1500,
    }
  )

  // Update flow state when we get the OAuth URL
  useEffect(() => {
    if (
      flowState.step === "waiting_url" &&
      pollStatusQuery.data?.oauthUrl
    ) {
      setSavedOauthUrl(pollStatusQuery.data.oauthUrl)
      setFlowState({
        step: "has_url",
        sandboxId: flowState.sandboxId,
        oauthUrl: pollStatusQuery.data.oauthUrl,
        sandboxUrl: flowState.sandboxUrl,
        sessionId: flowState.sessionId,
      })
    } else if (
      flowState.step === "waiting_url" &&
      pollStatusQuery.data?.state === "error"
    ) {
      setFlowState({
        step: "error",
        message: pollStatusQuery.data.error || "Failed to get OAuth URL",
      })
    }
  }, [pollStatusQuery.data, flowState])

  // Auto-close when the CLI subprocess completes the OAuth flow autonomously.
  // This fires when the subprocess's local HTTP server receives the browser
  // redirect and session.status flips to "success" — no code paste required.
  useEffect(() => {
    if (
      flowState.step === "has_url" &&
      urlOpened &&
      !autoCompletedRef.current &&
      pollStatusQuery.data?.state === "success"
    ) {
      autoCompletedRef.current = true
      handleAuthSuccess()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollStatusQuery.data?.state, flowState.step, urlOpened])

  // Open URL in browser when ready (after user clicked Connect)
  useEffect(() => {
    if (
      flowState.step === "has_url" &&
      userClickedConnect &&
      !urlOpenedRef.current
    ) {
      urlOpenedRef.current = true
      setUrlOpened(true)
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    }
  }, [flowState, userClickedConnect, openOAuthUrlMutation])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setFlowState({ step: "idle" })
      setAuthCode("")
      setUserClickedConnect(false)
      setUrlOpened(false)
      setSavedOauthUrl(null)
      setIgnoredExistingToken(false)
      setIsUsingExistingToken(false)
      setExistingTokenError(null)
      urlOpenedRef.current = false
      didAutoStartForOpenRef.current = false
      autoCompletedRef.current = false
      // Clear pending retry if modal closed without success (user cancelled)
      // Note: We don't clear here because success handler sets readyToRetry=true first
    }
  }, [open])

  // Helper to trigger retry after successful OAuth
  const triggerAuthRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending && pending.provider === "claude-code") {
      console.log("[ClaudeLoginModal] OAuth success - triggering retry for subChatId:", pending.subChatId)
      appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
    }
  }

  // Helper to clear pending retry (on cancel/close without success)
  const clearPendingRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (
      pending &&
      pending.provider === "claude-code" &&
      !pending.readyToRetry
    ) {
      console.log("[ClaudeLoginModal] Modal closed without success - clearing pending retry")
      appStore.set(pendingAuthRetryMessageAtom, null)
    }
  }

  const handleAuthSuccess = () => {
    triggerAuthRetry()
    setAnthropicOnboardingCompleted(true)
    setOpen(false)
    void Promise.allSettled([
      trpcUtils.anthropicAccounts.list.invalidate(),
      trpcUtils.anthropicAccounts.getActive.invalidate(),
      trpcUtils.claudeCode.getIntegration.invalidate(),
    ])
  }

  // Check if the code looks like a valid Claude auth code (format: XXX#YYY)
  const isValidCodeFormat = (code: string) => {
    const trimmed = code.trim()
    return trimmed.length > 50 && trimmed.includes("#")
  }

  const handleConnectClick = useCallback(async () => {
    setUserClickedConnect(true)

    if (flowState.step === "has_url") {
      // URL is ready, open it immediately
      urlOpenedRef.current = true
      setUrlOpened(true)
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    } else if (flowState.step === "error") {
      // Retry on error
      urlOpenedRef.current = false
      setUrlOpened(false)
      setFlowState({ step: "starting" })
      try {
        const result = await startAuthMutation.mutateAsync()
        setFlowState({
          step: "waiting_url",
          sandboxId: result.sandboxId,
          sandboxUrl: result.sandboxUrl,
          sessionId: result.sessionId,
        })
      } catch (err) {
        setFlowState({
          step: "error",
          message: err instanceof Error ? err.message : "Failed to start authentication",
        })
      }
    } else if (flowState.step === "idle") {
      // Start auth
      setFlowState({ step: "starting" })
      try {
        const result = await startAuthMutation.mutateAsync()
        setFlowState({
          step: "waiting_url",
          sandboxId: result.sandboxId,
          sandboxUrl: result.sandboxUrl,
          sessionId: result.sessionId,
        })
      } catch (err) {
        setFlowState({
          step: "error",
          message: err instanceof Error ? err.message : "Failed to start authentication",
        })
      }
    }
  }, [flowState, openOAuthUrlMutation, startAuthMutation])

  useEffect(() => {
    if (
      !open ||
      !autoStartAuth ||
      flowState.step !== "idle" ||
      didAutoStartForOpenRef.current ||
      // Wait until the keychain check resolves; if we're going to surface
      // the existing-token prompt, don't kick off the OAuth subprocess.
      !checkedExistingToken ||
      shouldOfferExistingToken
    ) {
      return
    }

    didAutoStartForOpenRef.current = true
    void handleConnectClick()
  }, [
    autoStartAuth,
    flowState.step,
    handleConnectClick,
    open,
    checkedExistingToken,
    shouldOfferExistingToken,
  ])

  const handleUseExistingToken = async () => {
    if (!hasExistingToken || isUsingExistingToken) return

    setIsUsingExistingToken(true)
    setExistingTokenError(null)

    try {
      await importSystemTokenMutation.mutateAsync()
      handleAuthSuccess()
    } catch (err) {
      setExistingTokenError(
        err instanceof Error ? err.message : "Failed to use existing token",
      )
      setIsUsingExistingToken(false)
    }
  }

  const handleRejectExistingToken = () => {
    setIgnoredExistingToken(true)
    setExistingTokenError(null)
    void handleConnectClick()
  }

  const handleSubmitCode = async () => {
    if (!authCode.trim() || flowState.step !== "has_url") return

    const { sandboxUrl, sessionId } = flowState
    setFlowState({ step: "submitting" })

    try {
      await submitCodeMutation.mutateAsync({
        sandboxUrl,
        sessionId,
        code: authCode.trim(),
      })
      handleAuthSuccess()
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to submit code",
      })
    }
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setAuthCode(value)

    // Auto-submit if the pasted value looks like a valid auth code
    if (isValidCodeFormat(value) && flowState.step === "has_url") {
      const { sandboxUrl, sessionId } = flowState
      setTimeout(async () => {
        setFlowState({ step: "submitting" })
        try {
          await submitCodeMutation.mutateAsync({
            sandboxUrl,
            sessionId,
            code: value.trim(),
          })
          handleAuthSuccess()
        } catch (err) {
          setFlowState({
            step: "error",
            message: err instanceof Error ? err.message : "Failed to submit code",
          })
        }
      }, 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && authCode.trim()) {
      handleSubmitCode()
    }
  }

  const handleOpenFallbackUrl = () => {
    if (savedOauthUrl) {
      openOAuthUrlMutation.mutate(savedOauthUrl)
    }
  }

  const handleOpenModelsSettings = () => {
    clearPendingRetry()
    setSettingsActiveTab("models" as SettingsTab)
    setSettingsOpen(true)
    setOpen(false)
  }

  const isLoadingAuth =
    flowState.step === "starting" || flowState.step === "waiting_url"
  const isSubmitting = flowState.step === "submitting"

  // Handle modal open/close - clear pending retry if closing without success
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      clearPendingRetry()
    }
    setOpen(newOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
        {/* Close button */}
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <div className="space-y-8">
          {/* Header with dual icons */}
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
              <h1 className="text-base font-semibold tracking-tight">
                Claude Code
              </h1>
              <p className="text-sm text-muted-foreground">
                Connect your Claude Code subscription
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6">
            {/* Existing token prompt — shown when the Claude Code CLI
                already has valid creds in the keychain, so the user can
                skip the OAuth subprocess. */}
            {shouldOfferExistingToken && flowState.step === "idle" && (
              <div className="space-y-3">
                <div className="p-3 bg-muted/50 border border-border rounded-md">
                  <p className="text-sm font-medium">
                    Existing Claude Code credentials found
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use the token already saved in your system keychain.
                  </p>
                </div>
                {existingTokenError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                    <p className="text-sm text-destructive">
                      {existingTokenError}
                    </p>
                  </div>
                )}
                <div className="flex w-full gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleRejectExistingToken}
                    disabled={isUsingExistingToken}
                    className="flex-1"
                  >
                    Auth with Anthropic
                  </Button>
                  <Button
                    onClick={handleUseExistingToken}
                    disabled={isUsingExistingToken}
                    className="flex-1"
                  >
                    {isUsingExistingToken ? (
                      <IconSpinner className="h-4 w-4" />
                    ) : (
                      "Use existing token"
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Connect Button - shows loader only if user clicked AND loading.
                Hidden until the keychain check resolves and only when not
                offering the existing-token prompt. */}
            {checkedExistingToken &&
              !shouldOfferExistingToken &&
              !urlOpened &&
              flowState.step !== "has_url" &&
              flowState.step !== "error" && (
                <Button
                  onClick={handleConnectClick}
                  className="w-full"
                  disabled={userClickedConnect && isLoadingAuth}
                >
                  {userClickedConnect && isLoadingAuth ? (
                    <IconSpinner className="h-4 w-4" />
                  ) : (
                    "Connect"
                  )}
                </Button>
              )}

            {/* Code Input - Show after URL is opened or if has_url */}
            {(urlOpened ||
              flowState.step === "has_url" ||
              flowState.step === "submitting") && (
              <div className="space-y-4">
                {/* Polling indicator while waiting for the browser redirect */}
                {urlOpened && !authCode && !isSubmitting && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <IconSpinner className="h-4 w-4 shrink-0" />
                    <span>Waiting for browser authorization…</span>
                  </div>
                )}
                <Input
                  value={authCode}
                  onChange={handleCodeChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Or paste your authentication code here..."
                  className="font-mono text-center"
                  autoFocus
                  disabled={isSubmitting}
                />
                <Button
                  onClick={handleSubmitCode}
                  className="w-full"
                  disabled={!authCode.trim() || isSubmitting}
                >
                  {isSubmitting ? <IconSpinner className="h-4 w-4" /> : "Continue"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  A new tab has opened for authentication.
                  {savedOauthUrl && (
                    <>
                      {" "}
                      <button
                        onClick={handleOpenFallbackUrl}
                        className="text-primary hover:underline"
                      >
                        Didn't open? Click here
                      </button>
                    </>
                  )}
                </p>
              </div>
            )}

            {/* Error State */}
            {flowState.step === "error" && (
              <div className="space-y-4">
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{flowState.message}</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleConnectClick}
                  className="w-full"
                >
                  Try Again
                </Button>
              </div>
            )}

            {!hideCustomModelSettingsLink && (
              <div className="text-center !mt-2">
                <button
                  type="button"
                  onClick={handleOpenModelsSettings}
                  className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Set a custom model in Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
