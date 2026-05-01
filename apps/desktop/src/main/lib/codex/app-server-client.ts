import { spawn, type ChildProcess } from "node:child_process"
import { createInterface, type Interface as ReadlineInterface } from "node:readline"

type JsonRpcId = number

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type JsonRpcMessage = {
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export type CodexAppServerNotification = {
  method: string
  params: unknown
}

export type CodexAppServerServerRequest = {
  id: JsonRpcId
  method: string
  params: unknown
}

export type CodexAppServerClientOptions = {
  command: string
  args?: string[]
  env?: Record<string, string>
  onNotification?: (notification: CodexAppServerNotification) => void
  onServerRequest?: (
    request: CodexAppServerServerRequest,
  ) => Promise<unknown> | unknown
  onExit?: (error?: Error) => void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

function formatRpcError(error: JsonRpcMessage["error"]): Error {
  const message =
    typeof error?.message === "string" && error.message.length > 0
      ? error.message
      : "Codex app-server request failed"
  const err = new Error(message)
  ;(err as any).code = error?.code
  ;(err as any).data = error?.data
  return err
}

export class CodexAppServerClient {
  private process: ChildProcess | null = null
  private readline: ReadlineInterface | null = null
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()
  private initialized: Promise<void> | null = null
  private closedError: Error | null = null

  constructor(private readonly options: CodexAppServerClientOptions) {}

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return this.initialized
    }

    this.initialized = this.startAndInitialize()
    return this.initialized
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    await this.ensureInitialized()
    if (this.closedError) {
      throw this.closedError
    }

    const id = this.nextId++
    const payload =
      params === undefined ? { method, id } : { method, id, params }

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })

      try {
        this.write(payload)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closedError) return
    const payload = params === undefined ? { method } : { method, params }
    this.write(payload)
  }

  dispose(): void {
    const error = new Error("Codex app-server disposed")
    this.rejectAll(error)
    this.readline?.close()
    this.readline = null
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM")
    }
    this.process = null
    this.closedError = error
    this.initialized = null
  }

  private async startAndInitialize(): Promise<void> {
    this.closedError = null
    this.process = spawn(this.options.command, this.options.args || ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env,
      windowsHide: true,
    })

    this.process.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim()
      if (text) {
        console.warn("[codex app-server]", text)
      }
    })

    this.process.once("error", (error) => {
      this.handleClose(error)
    })

    this.process.once("close", (code, signal) => {
      this.handleClose(
        new Error(
          `Codex app-server exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`,
        ),
      )
    })

    this.readline = createInterface({ input: this.process.stdout! })
    this.readline.on("line", (line) => this.handleLine(line))

    await this.requestWithoutInitialize("initialize", {
      clientInfo: {
        name: "churro-coder",
        title: "Churro Coder",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    this.notify("initialized", {})
  }

  private async requestWithoutInitialize<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closedError) {
      throw this.closedError
    }

    const id = this.nextId++
    const payload =
      params === undefined ? { method, id } : { method, id, params }

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })

      try {
        this.write(payload)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private write(payload: unknown): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) {
      throw this.closedError || new Error("Codex app-server is not running")
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private handleLine(line: string): void {
    if (!line.trim()) return

    let message: JsonRpcMessage
    try {
      message = JSON.parse(line)
    } catch (error) {
      console.warn("[codex app-server] Failed to parse JSON-RPC line", error)
      return
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return

      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) {
        pending.reject(formatRpcError(message.error))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.id !== undefined && message.method) {
      void this.handleServerRequest({
        id: message.id,
        method: message.method,
        params: message.params,
      })
      return
    }

    if (message.method) {
      this.options.onNotification?.({
        method: message.method,
        params: message.params,
      })
    }
  }

  private async handleServerRequest(
    request: CodexAppServerServerRequest,
  ): Promise<void> {
    try {
      const result = await this.options.onServerRequest?.(request)
      this.write({ id: request.id, result: result ?? {} })
    } catch (error) {
      this.write({
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private handleClose(error: Error): void {
    if (this.closedError) return
    this.closedError = error
    this.rejectAll(error)
    this.readline?.close()
    this.readline = null
    this.process = null
    this.initialized = null
    this.options.onExit?.(error)
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
  }
}
