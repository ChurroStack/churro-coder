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
        "src/renderer/features/agents/utils/workflow-state.ts",
        "src/renderer/features/agents/utils/pr-message.ts",
        "src/renderer/features/agents/utils/git-activity.ts",
        "src/renderer/features/agents/utils/auto-rename.ts",
        "src/renderer/features/agents/utils/paste-text.ts",
        "src/renderer/features/agents/search/chat-search-utils.ts",
        "src/renderer/features/kanban/lib/derive-status.ts",
        "src/shared/provider-from-model.ts",
        "src/shared/codex-tool-normalizer.ts",
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
