import { Provider as JotaiProvider, useAtomValue, useSetAtom } from 'jotai';
import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect, useMemo, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { AppErrorBoundary } from './components/ui/error-boundary';
import { TooltipProvider } from './components/ui/tooltip';
import { TRPCProvider } from './contexts/TRPCProvider';
import { WindowProvider, getInitialWindowParams } from './contexts/WindowContext';
import { selectedProjectAtom, selectedAgentChatIdAtom } from './features/agents/atoms';
import { useAgentSubChatStore } from './features/agents/stores/sub-chat-store';
import { AgentsLayout } from './features/layout/agents-layout';
import { FeedbackDialog } from './components/dialogs/feedback-dialog';
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  CodexOnboardingPage,
  SelectRepoPage
} from './features/onboarding';
import { identify, initAnalytics, shutdown, useSentryWorkspaceTags } from './lib/analytics';
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  codexOnboardingCompletedAtom
} from './lib/atoms';
import { debugSessionEnabledAtom } from './lib/debug-session';
import { appStore } from './lib/jotai-store';
import { VSCodeThemeProvider } from './lib/themes/theme-provider';
import { trpc, trpcClient } from './lib/trpc';

/**
 * Custom Toaster that adapts to theme
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();

  return <Toaster position="bottom-right" theme={resolvedTheme as 'light' | 'dark' | 'system'} closeButton />;
}

function AnalyticsBindings() {
  useSentryWorkspaceTags();
  const debugSessionEnabled = useAtomValue(debugSessionEnabledAtom);

  useEffect(() => {
    trpcClient.analytics.setDebugSession.mutate({ enabled: debugSessionEnabled }).catch((error) => {
      console.warn('[Analytics] Failed to sync debug-session status:', error);
    });
  }, [debugSessionEnabled]);

  return null;
}

/**
 * Main content router - decides which page to show based on onboarding state
 */
function AppContent() {
  const billingMethod = useAtomValue(billingMethodAtom);
  const setBillingMethod = useSetAtom(billingMethodAtom);
  const anthropicOnboardingCompleted = useAtomValue(anthropicOnboardingCompletedAtom);
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom);
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom);
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom);
  const codexOnboardingCompleted = useAtomValue(codexOnboardingCompletedAtom);
  const selectedProject = useAtomValue(selectedProjectAtom);
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore();

  // Apply initial window params (chatId/subChatId) when opening via "Open in new window"
  useEffect(() => {
    const params = getInitialWindowParams();
    if (params.chatId) {
      console.log('[App] Opening chat from window params:', params.chatId, params.subChatId);
      setSelectedChatId(params.chatId);
      setChatId(params.chatId);
      if (params.subChatId) {
        addToOpenSubChats(params.subChatId);
        setActiveSubChat(params.subChatId);
      }
    }
  }, [setSelectedChatId, setChatId, addToOpenSubChats, setActiveSubChat]);

  // Claim the initially selected chat to prevent duplicate windows.
  // For new windows opened via "Open in new window", the chat is pre-claimed by main process.
  // For restored windows (persisted localStorage), we need to claim here.
  // Read atom directly from store to avoid stale closure with empty deps.
  useEffect(() => {
    if (!window.desktopApi?.claimChat) return;
    const currentChatId = appStore.get(selectedAgentChatIdAtom);
    if (!currentChatId) return;
    window.desktopApi.claimChat(currentChatId).then((result) => {
      if (!result.ok) {
        // Another window already has this chat — clear our selection
        setSelectedChatId(null);
      }
    });
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface churro-coder MCP bootstrap failures (e.g. Codex CLI rejected
  // --bearer-token-env-var) — agent's read_plan tool won't work for Codex
  // until resolved, so we tell the user instead of failing silently.
  const churroMcpStatusToastShown = useRef(false);
  const { data: churroMcpStatus } = trpc.codex.getChurroCoderMcpStatus.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    staleTime: Infinity
  });
  useEffect(() => {
    if (churroMcpStatusToastShown.current) return;
    if (churroMcpStatus?.state === 'failed') {
      churroMcpStatusToastShown.current = true;
      toast.error('Codex MCP setup failed', {
        description: `The read_plan tool will not be available for Codex agents. ${churroMcpStatus.error}`,
        duration: 10_000
      });
    }
  }, [churroMcpStatus]);

  // Check if user has existing CLI config (API key or proxy)
  // Based on PR #29 by @sa4hnd
  const { data: cliConfig, isLoading: isLoadingCliConfig } = trpc.claudeCode.hasExistingCliConfig.useQuery();

  // Migration: If user already completed Anthropic onboarding but has no billing method set,
  // automatically set it to "claude-subscription" (legacy users before billing method was added)
  useEffect(() => {
    if (!billingMethod && anthropicOnboardingCompleted) {
      setBillingMethod('claude-subscription');
    }
  }, [billingMethod, anthropicOnboardingCompleted, setBillingMethod]);

  // Auto-skip onboarding if user has existing CLI config (API key or proxy)
  // This allows users with ANTHROPIC_API_KEY to use the app without OAuth
  useEffect(() => {
    if (cliConfig?.hasConfig && !billingMethod) {
      console.log('[App] Detected existing CLI config, auto-completing onboarding');
      setBillingMethod('api-key');
      setApiKeyOnboardingCompleted(true);
    }
  }, [cliConfig?.hasConfig, billingMethod, setBillingMethod, setApiKeyOnboardingCompleted]);

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } = trpc.projects.list.useQuery();

  // Validated project - only valid if exists in DB
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null;
    // While loading, trust localStorage value to prevent flicker
    if (isLoadingProjects) return selectedProject;
    // After loading, validate against DB
    if (!Array.isArray(projects)) return null;
    const exists = projects.some((p) => p.id === selectedProject.id);
    return exists ? selectedProject : null;
  }, [selectedProject, projects, isLoadingProjects]);

  // Determine which page to show:
  // 1. No billing method selected -> BillingMethodPage
  // 2. Claude subscription selected but not completed -> AnthropicOnboardingPage
  // 3. Codex selected but not completed -> CodexOnboardingPage
  // 4. API key or custom model selected but not completed -> ApiKeyOnboardingPage
  // 5. No valid project selected -> SelectRepoPage
  // 6. Otherwise -> AgentsLayout
  if (!billingMethod) {
    return <BillingMethodPage />;
  }

  if (billingMethod === 'claude-subscription' && !anthropicOnboardingCompleted) {
    return <AnthropicOnboardingPage />;
  }

  if ((billingMethod === 'codex-subscription' || billingMethod === 'codex-api-key') && !codexOnboardingCompleted) {
    return <CodexOnboardingPage />;
  }

  if ((billingMethod === 'api-key' || billingMethod === 'custom-model') && !apiKeyOnboardingCompleted) {
    return <ApiKeyOnboardingPage />;
  }

  if (!validatedProject && !isLoadingProjects) {
    return <SelectRepoPage />;
  }

  return <AgentsLayout />;
}

export function App() {
  // Initialize analytics on mount
  useEffect(() => {
    initAnalytics();

    // Sync analytics opt-out status to main process
    const syncOptOutStatus = async () => {
      try {
        const optOut = localStorage.getItem('preferences:analytics-opt-out') === 'true';
        await window.desktopApi?.setAnalyticsOptOut(optOut);
      } catch (error) {
        console.warn('[Analytics] Failed to sync opt-out status:', error);
      }
    };
    syncOptOutStatus();

    // Identify user if already authenticated
    const identifyUser = async () => {
      try {
        const user = await window.desktopApi?.getUser();
        if (user?.id) {
          identify(user.id, { email: user.email, name: user.name });
        }
      } catch (error) {
        console.warn('[Analytics] Failed to identify user:', error);
      }
    };
    identifyUser();

    // On window unload, sweep open sub-chats — any empty ones (no messages)
    // are auto-deleted. This complements the on-tab-close cleanup so closing a
    // window with empty tabs still cleans them up.
    const handleBeforeUnload = () => {
      try {
        const openIds = useAgentSubChatStore.getState().openSubChatIds;
        if (openIds.length === 0) return;
        // Fire-and-forget; main process IPC will queue the request.
        trpcClient.chats.deleteEmptySubChatsByIds.mutate({ ids: openIds }).catch(() => {});
      } catch {
        // Swallow — this is best-effort cleanup.
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      shutdown();
    };
  }, []);

  return (
    <AppErrorBoundary>
      <WindowProvider>
        <JotaiProvider store={appStore}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <VSCodeThemeProvider>
              <TooltipProvider delayDuration={100}>
                <TRPCProvider>
                  <AnalyticsBindings />
                  <div data-agents-page className="h-screen w-screen bg-background text-foreground overflow-hidden">
                    <AppContent />
                  </div>
                  <FeedbackDialog />
                  <ThemedToaster />
                </TRPCProvider>
              </TooltipProvider>
            </VSCodeThemeProvider>
          </ThemeProvider>
        </JotaiProvider>
      </WindowProvider>
    </AppErrorBoundary>
  );
}
