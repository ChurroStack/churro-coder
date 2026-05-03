# Cross-provider plan-approval crash (Codex GPT-5.5 → Claude Sonnet)

**Date:** 2026-05-03
**Branch:** `medieval-dingo-67910e`
**Severity:** UI freeze + crash on plan approval (renderer lost)
**Files touched:**
- `apps/desktop/src/renderer/features/agents/main/chat-input-area.tsx` (real fix)
- `apps/desktop/scripts/patch-radix-slot.mjs` + `patches/@radix-ui+react-slot@1.2.4.patch` (defensive infrastructure)
- `apps/desktop/node_modules/@radix-ui/react-slot/**` (patched via postinstall)

---

## Symptom

Clicking **Approve** in the plan view after a Codex GPT-5.5 plan crashed the renderer with:

```
Maximum update depth exceeded. This can happen when a component
repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
React limits the number of nested updates to prevent infinite loops.
```

Stack frames pointed at `setRef → composeRefs → dispatchSetState` (deep inside `@radix-ui/react-compose-refs`), wrapped by `at button (<anonymous>)`.

User-visible secondary signal: the model selector in the chat input flickered between **GPT-5.5** and **Sonnet** at ~30–60 Hz before the crash boundary fired.

### Reproduction (this is the discriminator — write down the exact matrix when triaging)

| First turn | Approve switches to | Crash? |
|---|---|---|
| Codex GPT-5.5 (plan mode) | Claude (cross-provider) | **Yes** |
| Claude Opus 4.7 (plan mode) | Claude (same-provider) | No |
| Claude Opus 4.7 (plan mode) | Codex (cross-provider) | No |
| Codex GPT-5.5 (plan mode) | Codex GPT-5.4 (same-provider) | No |

The asymmetry is the load-bearing clue: only Codex→Claude triggers it. Any "infinite loop in React" investigation that *can't explain why the other three rows pass* is on the wrong track.

---

## Root cause

`apps/desktop/src/renderer/features/agents/main/chat-input-area.tsx`, lines 497–517 before the fix:

```tsx
const [selectedModel, setSelectedModel] = useState(
  () => availableModels.models.find((m) => m.id === selectedSubChatModelId)
        || availableModels.models[0],
)

// Effect A: atom → state
useEffect(() => {
  const model = availableModels.models.find((m) => m.id === selectedSubChatModelId)
  if (model && model.id !== selectedModel.id) {
    setSelectedModel(model)
  }
}, [availableModels.models, selectedModel.id, selectedSubChatModelId])

// Effect B: state → atom
useEffect(() => {
  if (provider !== "claude-code") return
  if (!selectedModel?.id) return
  setSelectedSubChatModelId(selectedModel.id)
}, [provider, selectedModel?.id, setSelectedSubChatModelId])
```

Two effects bidirectionally synced `selectedSubChatModelId` (jotai atom, per-subchat) and `selectedModel` (local React state). Normally they're no-ops because both stores already agree.

But on plan approval, `applyModeDefaultModel(subChatId, "agent")` writes the *new* default Claude model (e.g. `"sonnet"`) to the atom **without** touching local state. Local state is still whatever it was initialized to from the previous atom value (e.g. `"opus"`).

The result is that A and B disagree about the truth, and instead of converging, they swap:

- **Render N:** atom = `"sonnet"`, state = `"opus"`. A schedules `setSelectedModel(SONNET)`. B schedules `setSelectedSubChatModelId("opus")`. Both writes target *different* stores so React's batching can't collapse them.
- **Render N+1:** atom = `"opus"`, state = `"sonnet"`. Same effects run, now in the opposite direction. A schedules `setSelectedModel(OPUS)`. B schedules `setSelectedSubChatModelId("sonnet")`.
- **Render N+2:** identical to render N. Loop.

50 nested updates later, React aborts.

### Why only this direction reproduces

| Direction | Effect B fires? | Atom-vs-state mismatch on switch? |
|---|---|---|
| Codex → Claude | yes (`provider === "claude-code"` after switch) | **yes** — atom set to default agent Claude model, state still on previous Claude default |
| Claude → Codex | no (`provider === "codex"`, B early-returns) | n/a |
| Same-provider Codex→Codex | no (B early-returns the entire session) | n/a |
| Same-provider Claude→Claude | yes | only if user's plan-mode default Claude model differs from agent-mode default Claude model — most users keep these the same |

So this bug had been latent in the same-provider Claude→Claude path too, but was masked by users typically configuring identical plan/agent defaults. Cross-provider Codex→Claude reliably triggers it because the Claude atom is essentially guaranteed to have an arbitrary "leftover" value when entering this code path for the first time.

### Why the crash stack pointed at Radix UI's `composeRefs`

The renderer has 80+ `<TooltipTrigger asChild>` usages. `@radix-ui/react-slot@1.2.4` (used by `react-tooltip`, `react-dialog`, etc.) calls `composeRefs(forwardedRef, childrenRef)` directly during render inside `SlotClone`, producing a **new ref function on every render**. Under React 19's new ref-cleanup semantics, a changed ref callback fires `prevRef(null)` then `newRef(node)` during the commit phase. When `react-tooltip` puts `setTrigger` (a `useState` setter) into the ref chain, those calls become real `setState` invocations.

Normally these batch into a single render and cancel out. But during the chat-input model-oscillation cascade, the *entire* renderer was re-rendering at saturation; the cleanup/setup pairs stopped batching and started compounding. The error boundary surfaced the React 19 / Slot interaction first because that's where the 50-update guard tripped, even though the *driver* was the chat-input-area state oscillation 1k LOC away.

This is a recurring debugging pitfall worth internalizing: **the component named in the "Maximum update depth" stack trace is rarely the bug — it's just the unluckiest victim of a re-render storm originating elsewhere.**

---

## Fix

### Real fix — `chat-input-area.tsx`

`selectedModel` is now derived from the atom via `useMemo`, eliminating Effect A entirely:

```tsx
const selectedModel = useMemo(
  () => availableModels.models.find((m) => m.id === selectedSubChatModelId)
        || availableModels.models[0],
  [availableModels.models, selectedSubChatModelId],
)

// Effect B retains its "materialize on mount" purpose with an idempotency guard.
useEffect(() => {
  if (provider !== "claude-code") return
  if (!selectedModel?.id) return
  if (selectedModel.id === selectedSubChatModelId) return  // <- breaks the cycle
  setSelectedSubChatModelId(selectedModel.id)
}, [provider, selectedModel?.id, selectedSubChatModelId, setSelectedSubChatModelId])
```

The atom is now the single source of truth. Picking a model in the dropdown writes only the atom; the derivation handles the visible state on the next render.

### Defensive fix — `@radix-ui/react-slot` patch

Independent from the bug above, we also patched the underlying React 19 incompatibility in `Slot` so future re-render storms can't escalate to a renderer crash. `scripts/patch-radix-slot.mjs` runs from `postinstall` and rewrites every nested copy of `react-slot` (there are 9 — `react-tooltip`, `react-dialog`, `react-popover`, `react-menu`, `react-select`, `react-alert-dialog`, `react-collection`, `react-primitive`, plus the top-level package) to wrap the composed ref with `React.useCallback`, matching how `useComposedRefs` already does it.

Without this, the *next* unrelated state-oscillation bug anywhere in the codebase would crash the renderer the same way.

---

## Triage heuristics for "Maximum update depth exceeded" reports

When this error reappears, check in this order:

1. **Asymmetric reproduction** — does it happen in some configurations but not others? The configuration that *doesn't* reproduce often tells you which code path is involved. Build a matrix before you read code.
2. **Look for paired `useState` + bidirectional `useEffect` syncs.** The shape `useEffect(() => setLocal(atom), [atom, local])` paired with `useEffect(() => setAtom(local), [local, atom])` is a known footgun. If both sides can produce different values, they oscillate.
3. **Don't trust the React stack trace's "occurred in `<X>`" line.** A re-render storm in component Y can crash component X if X is the first to hit the 50-update guard. Treat the stack as a "where it surfaced" hint, not a "where it lives" verdict.
4. **`composeRefs` / `setRef` in the stack trace ≠ the bug is in Radix UI.** It usually means *some* component is re-rendering at saturation; the Radix ref instability is the resonant frequency that crashes first. Find the saturation source first.
5. **Watch the UI for visual oscillation** (selector flickering, panel opening/closing, etc.). The user can often see the state ping-pong before the crash boundary fires. That visible signal points directly at the offending state pair.
6. **Search for `useState` whose initializer depends on a jotai atom.** That's usually the start of a sync-pair. Prefer `useMemo` (derived) unless the local copy genuinely needs to diverge from the atom.

## Tests

There is no regression test for this yet. A unit test that mounts `ChatInputArea` with `selectedSubChatModelId` mismatched against `availableModels` and asserts no infinite re-render (e.g. via a render-counter ref) would be the right shape, but `ChatInputArea` is heavy to mount in isolation — most of its hooks pull from jotai atoms and tRPC. Filed as a follow-up.

## Related code paths to audit

The same anti-pattern (paired bidirectional syncs between local state and a jotai atom) may exist elsewhere. Worth grepping for `useEffect.*setSelected.*useEffect.*setSelected` shape patterns. Specific neighbours that survived this incident but are structurally similar:

- `chat-input-area.tsx:581` — Codex model materialization (writes to atom but reads `selectedCodexModel` which is *already* derived via `useMemo`, so no oscillation possible)
- `chat-input-area.tsx:629` — Claude thinking level materialization (similar structure to the fixed Claude model effect; worth re-reading to confirm it can't oscillate)

If a future bug presents with this same fingerprint (cross-provider transition + visible UI oscillation + setRef stack), check those two effects first.
