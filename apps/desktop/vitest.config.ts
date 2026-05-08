import { defineConfig } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/renderer/features/agents/lib/model-switching.ts",
        "src/renderer/features/agents/lib/models.ts",
        "src/renderer/features/agents/machines/chat-mode-machine.ts",
        "src/renderer/features/agents/machines/plan-approval-machine.ts",
        "src/renderer/features/agents/machines/transport-lifecycle.ts",
        "src/renderer/features/agents/services/plan-approval-service.ts",
        "src/renderer/features/agents/services/mode-switch-service.ts",
        "src/renderer/features/agents/services/chat-send-service.ts",
        "src/renderer/features/agents/services/transport-factory.ts",
        "src/renderer/features/agents/hooks/use-chat-view-state.ts",
        "src/renderer/features/agents/hooks/use-chat-controller.ts",
        "src/renderer/features/agents/hooks/use-mode-switch-deps.ts",
        "src/renderer/features/agents/hooks/use-transport-factory-deps.ts",
        "src/renderer/features/agents/hooks/use-approve-plan-deps.ts",
        "src/renderer/features/agents/lib/chat-instance-helpers.ts",
        "src/renderer/features/agents/lib/implement-plan-parts.ts",
        "src/renderer/features/agents/components/message-group.tsx",
        "src/renderer/features/agents/components/scroll-to-bottom-button.tsx",
        "src/renderer/features/agents/components/split-pane-inline-close.tsx",
        "src/renderer/features/agents/utils/workflow-state.ts",
        "src/renderer/features/agents/utils/pr-message.ts",
        "src/renderer/features/agents/utils/git-activity.ts",
        "src/renderer/features/agents/utils/auto-rename.ts",
        "src/renderer/features/agents/utils/paste-text.ts",
        "src/renderer/features/agents/search/chat-search-utils.ts",
        "src/renderer/features/kanban/lib/derive-status.ts",
        "src/shared/provider-from-model.ts",
        "src/shared/codex-tool-normalizer.ts",
        "src/main/lib/sandbox/policy.ts",
        "src/main/lib/prompts/prompt-service.ts",
        "src/prompts/index.ts",
      ],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
    },
  },
})
