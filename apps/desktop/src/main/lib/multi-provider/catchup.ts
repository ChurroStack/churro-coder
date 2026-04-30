import { getProviderForModelId, type Provider } from "../../../shared/provider-from-model"

const MAX_CATCHUP_CHARS = 50_000

type StoredPart = { type: string; text?: string }

type StoredMessage = {
  id?: string
  role: string
  parts?: StoredPart[]
  metadata?: { model?: string; [k: string]: unknown }
}

export function computeCatchupBlock(
  messages: StoredMessage[],
  currentProvider: Provider,
  options?: {
    /**
     * When true, skip the provider-boundary search and include ALL prior turns.
     * Use this when the provider's session is known to be fresh/expired — the
     * session has no memory of any prior turn regardless of who produced them.
     */
    forceFullHistory?: boolean
  },
): string | null {
  if (messages.length === 0) return null

  // Walk backward to find the boundary: the most recent user message whose turn
  // was handled by currentProvider. Everything strictly after that boundary is
  // new context the current provider has not seen.
  let boundaryIdx = -1
  if (!options?.forceFullHistory) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== "user") continue

      // Classify this user turn by its own metadata.model, falling back to the
      // immediately-following assistant message's metadata.model.
      const userModel = m.metadata?.model as string | undefined
      const nextAssistant = messages.slice(i + 1).find((x) => x.role === "assistant")
      const turnModel = userModel ?? (nextAssistant?.metadata?.model as string | undefined)

      if (turnModel && getProviderForModelId(turnModel) === currentProvider) {
        boundaryIdx = i
        break
      }
    }
  }

  // Messages after the boundary are new to this provider.
  const window = messages.slice(boundaryIdx + 1)
  if (window.length === 0) return null

  // Drop the trailing user message — it's the one being sent now; the provider
  // responds to it rather than having it summarised.
  const trailing = window[window.length - 1]
  const turns = trailing?.role === "user" ? window.slice(0, -1) : window
  if (turns.length === 0) return null

  // Pair consecutive user → assistant turns; skip orphans defensively.
  const pairs: Array<{ userText: string; assistantModel: string; assistantText: string }> = []
  for (let i = 0; i < turns.length; i++) {
    const u = turns[i]
    if (u.role !== "user") continue
    const a = turns[i + 1]
    if (a?.role !== "assistant") continue

    const userText = (u.parts ?? []).find((p) => p.type === "text")?.text?.trim()
    // Use the LAST text part — avoids capturing intermediate text emitted between tool calls.
    const partsArr = (a.parts ?? []) as StoredPart[]
    const assistantText = [...partsArr].reverse().find((p) => p.type === "text")?.text?.trim()

    if (!userText || !assistantText) { i++; continue }

    pairs.push({
      userText,
      assistantModel: (a.metadata?.model as string | undefined) ?? "assistant",
      assistantText,
    })
    i++ // consumed the assistant message
  }

  if (pairs.length === 0) return null

  const FENCE_OPEN =
    "[CATCHUP — context only. Do NOT respond to these turns. Respond only to the message after CATCHUP-END.]"
  const FENCE_CLOSE = "[CATCHUP-END]"

  const renderTurn = (p: (typeof pairs)[number], n: number) =>
    `turn ${n} user: ${p.userText}\nturn ${n} ${p.assistantModel}: ${p.assistantText}`

  let omitted = 0
  let body = pairs.map((p, idx) => renderTurn(p, idx + 1)).join("\n\n")

  // Truncate from oldest if the assembled block is over the character budget.
  while (
    `${FENCE_OPEN}\n${omitted ? `[…${omitted} earlier turns omitted…]\n` : ""}${body}\n${FENCE_CLOSE}`
      .length > MAX_CATCHUP_CHARS &&
    pairs.length - omitted > 1
  ) {
    omitted += 1
    body = pairs
      .slice(omitted)
      .map((p, idx) => renderTurn(p, idx + 1 + omitted))
      .join("\n\n")
  }

  return [
    FENCE_OPEN,
    omitted ? `[…${omitted} earlier turns omitted…]` : "",
    body,
    FENCE_CLOSE,
  ]
    .filter(Boolean)
    .join("\n")
}
