import { vi } from "vitest"

/**
 * Lightweight tRPC client mock factory. Returns a deeply-nested object whose
 * leaves are vitest mocks for the procedures used by the chat orchestrator.
 *
 * Mirrors the surface from the renderer's `src/renderer/lib/trpc.ts` but only
 * stubs the procedures the agent feature touches; extend as service tests
 * grow.
 */
export function createMockTrpc() {
  return {
    claude: {
      chat: {
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      },
    },
    codex: {
      chat: {
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      },
    },
    chats: {
      updateSubChatMode: {
        mutate: vi.fn(async (_input: { subChatId: string; mode: "plan" | "agent"; exitPlan?: boolean }) => undefined),
      },
      createSubChat: {
        mutate: vi.fn(async (_input: { chatId: string; name: string; mode: "plan" | "agent" }) => ({
          id: "test-sub-id",
        })),
      },
      get: {
        query: vi.fn(async () => null),
      },
    },
    files: {
      writePastedText: {
        mutate: vi.fn(async (_input: { subChatId: string; text: string }) => ({
          filePath: "/tmp/pasted.md",
          filename: "pasted.md",
          size: 0,
        })),
      },
    },
  }
}

export type MockTrpcClient = ReturnType<typeof createMockTrpc>
