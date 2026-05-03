import { vi } from "vitest"

export type ProviderId = "claude-code" | "codex"

export interface MockTransportConfig {
  chatId: string
  subChatId: string
  provider: ProviderId
  cwd?: string
}

export interface MockChatTransport {
  readonly chatId: string
  readonly subChatId: string
  readonly provider: ProviderId
  readonly cwd?: string
  /** Last call recorded by sendMessages */
  lastSendArgs: unknown
  /** Number of times sendMessages was invoked */
  sendCount: number
  /** Spy you can assert against */
  sendMessages: ReturnType<typeof vi.fn>
  /** Marker the factory tests use to verify provider-specific instantiation */
  readonly __kind: "mock-transport"
}

export function createMockTransport(config: MockTransportConfig): MockChatTransport {
  const transport: MockChatTransport = {
    chatId: config.chatId,
    subChatId: config.subChatId,
    provider: config.provider,
    cwd: config.cwd,
    lastSendArgs: null,
    sendCount: 0,
    sendMessages: vi.fn(async (args: unknown) => {
      transport.lastSendArgs = args
      transport.sendCount += 1
    }),
    __kind: "mock-transport" as const,
  }
  return transport
}
