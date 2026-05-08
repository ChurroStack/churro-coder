---
# Machine-readable design tokens. Keep in sync with:
#   - src/renderer/styles/globals.css       (HSL CSS variables)
#   - src/renderer/styles/agents-styles.css (agents-page overrides)
#   - tailwind.config.js                    (token → utility mapping)
#   - src/renderer/components/ui/*.tsx      (component variants)

name: Churro Coder Desktop
description: Local-first Electron + React UI. Frameless window, dockview shell, shadcn/ui primitives on Tailwind v3 with HSL token vars.

colors:
  notation: HSL space-separated triplets, consumed via `hsl(var(--token))`. The `--primary` blue is the only token shared verbatim across light and dark themes.
  light:
    background: 0 0% 100%             # #FFFFFF
    foreground: 240 10% 3.9%          # near-black
    card: 0 0% 100%
    card-foreground: 240 10% 3.9%
    popover: 0 0% 100%
    popover-foreground: 240 10% 3.9%
    primary: 228 100% 50%             # #0034FF — invariant across themes
    primary-foreground: 0 0% 100%
    secondary: 240 4.8% 95.9%
    secondary-foreground: 240 5.9% 10%
    muted: 240 4.8% 95.9%
    muted-foreground: 240 3.8% 46.1%
    accent: 240 4.8% 95.9%
    accent-foreground: 240 5.9% 10%
    destructive: 0 84.2% 60.2%
    destructive-foreground: 0 0% 98%
    border: 240 5.9% 90%
    input: 240 5.9% 90%
    input-background: 240 4.8% 95.9%
    ring: 228 100% 50%                # = primary
    selection: 228 100% 50% / 0.25    # primary @ 25% alpha
    plan-mode: 33 83% 67%             # warm amber band for Plan Mode chrome
    plan-mode-foreground: 0 0% 8%
    tl-background: 0 0% 98%           # timeline / chat surface
  dark:
    background: 240 10% 3.9%
    foreground: 240 4.8% 95.9%
    card: 240 10% 3.9%
    card-foreground: 0 0% 98%
    popover: 0 0% 9%                  # #171717
    popover-foreground: 0 0% 98%
    primary: 228 100% 50%             # unchanged from light
    primary-foreground: 0 0% 100%
    secondary: 240 3.7% 15.9%
    secondary-foreground: 0 0% 98%
    muted: 240 5.9% 10%
    muted-foreground: 240 4.4% 58%
    accent: 240 5.9% 10%
    accent-foreground: 0 0% 98%
    destructive: 0 62.8% 30.6%
    destructive-foreground: 0 0% 98%
    border: 240 3.7% 15.9%
    input: 240 3.7% 15.9%
    input-background: 60 2% 18%       # #30302E — matches Claude input
    ring: 228 100% 50%
    selection: 228 100% 50% / 0.30
    plan-mode: 33 83% 67%
    plan-mode-foreground: 0 0% 8%
    tl-background: 60 2% 18%
  agents-page-overrides:               # set on `[data-agents-page]`, scoped not global
    light:
      muted: 0 0% 94%
      muted-foreground: 0 0% 45%
    dark:
      muted: 0 0% 14%                  # ~#242424
      muted-foreground: 0 0% 55%
  search-highlight:
    inactive: rgb(250 204 21 / 0.35)
    active: rgb(250 204 21 / 0.85)

typography:
  fonts:
    sans: var(--font-geist-sans), system-ui, -apple-system, sans-serif
    mono: var(--font-geist-mono), 'Geist Mono', ui-monospace, monospace
    diff: 'Monaco', 'Menlo', 'Consolas', monospace
  defaults:
    body-weight: 400
    feature-settings: "'rlig' 1, 'calt' 1"
  scale-tokens:                        # text-* utilities used in the codebase
    xs: 12px / 1.4
    sm: 14px / 1.4
    base: 16px
    diff: 12px / 1.5

shapes:
  radius-base: 0.6rem                  # --radius
  tailwind-aliases:
    rounded-sm: calc(var(--radius) - 4px)
    rounded-md: calc(var(--radius) - 2px)
    rounded-lg: var(--radius)
  dockview-radius: 10px                # --dv-border-radius (rails / groupview cards / drop overlay)
  toast-radius: var(--radius)
  scrollbar-radius:
    global: 4px
    agents-page: 3px

layout:
  shell-gap: 6px                       # --shell-gap, gap between rails / split cells / window edge
  sidebar-width: 240px                 # --sidebar-width
  dock-tab-strip-height: 40px          # --dv-tabs-and-actions-container-height
  dock-tab-padding: 0 8px
  dock-tab-margin: 4px                 # symmetric inset around each pill tab
  dock-tab-radius: 6px
  containers:
    chat-readable-width: max-w-5xl
  app-region:
    drag-class: .drag-region (`-webkit-app-region: drag`)
    no-drag-class: .no-drag (`-webkit-app-region: no-drag`)
    drag-strip: dockview tab strip is the window drag handle; trailing actions opt out via no-drag

elevation:
  toast-shadow: 0 2px 6px rgba(0, 0, 0, 0.08)
  terminal-link-popup-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)
  default-button-shadow:
    light: 0 0 0 0.5px rgb(23,23,23), inset 0 0 0 1px rgba(255,255,255,0.14)
    dark: 0 0 0 0.5px rgb(23,23,23), inset 0 0 0 1px rgba(0,0,0,0.14)
  dialog-ring-4:
    light: rgb(229 231 235 / 0.8)      # neutral-200/80
    dark: rgb(38 38 38 / 0.8)          # neutral-800/80

motion:
  durations:
    quick: 100ms
    standard: 120ms
    medium: 150ms
    slow: 200ms
  easings:
    primary: ease-out
  named:
    agents-fade-in: 200ms ease-out
    agents-slide-up: 200ms ease-out (translateY(8px) → 0)
    chroma-slide: 2s ease-out infinite (gradient sweep over text)
    dv-tab-hover: background-color 120ms ease-out
    toast-button-hover: background-color 150ms ease-out, transform 150ms ease-out
    touch-active-scale: scale(0.98), transition transform 100ms ease-out

components:
  primitives:
    location: src/renderer/components/ui
    library: shadcn/ui (Radix + cva)
    canonical-list: accordion, alert-dialog, badge, button, button-group, checkbox, collapsible, command, context-menu, dialog, dropdown-menu, hover-card, input, kbd, label, popover, progress, select, skeleton, split-button, switch, tabs, textarea, tooltip
  button:
    base-class: rounded-md text-sm font-medium
    sizes:
      sm: h-7 px-3
      default: h-7 px-3
      lg: h-10 px-8
      icon: h-7 w-7
    variants:
      default: bg-primary, theme-aware inset shadow, outer black 0.5px ring
      brand: primary gradient (top→bottom), focus-visible:outline-4
      destructive: bg-destructive, soft black/5 shadow
      outline: border-input on bg-background, hover bg-accent
      secondary: bg-secondary with border-input, hover bg-secondary/80
      ghost: transparent, hover bg-accent
      link: text-primary, hover underline
  badge:
    base: rounded-full border px-2 py-[1px]
    variants: default | secondary | destructive | outline
  input:
    base: h-9 rounded-md border-input bg-background px-3 text-sm
    focus: border-primary + ring-[3px] ring-primary/20
  dockview-tabs:
    style: pill — only the active tab fills with --muted; others sit transparent with subtle hover
    radius: 6px (inside a 10px-radius shell card)
  scrollbars:
    global: 8x8px, muted-foreground @ 0.3 thumb
    agents-page: 6x6px, thinner

surfaces:
  agents-page-marker: '[data-agents-page]'  # scopes Geist font + scoped --muted overrides
  cs-themes:
    light: .cs-theme-light
    dark: .cs-theme-dark
  notes:
    - Custom `cs-theme-*` class names are intentional — see globals.css comment block for the dockview style-injection war that prompted them.

accessibility:
  focus-visible:
    buttons-and-roles-on-agents-page: 2px solid hsl(var(--primary)), outline-offset 2px
    inputs: 3px ring of primary @ 0.20 + primary border
  selection: hsl(var(--selection)) background, original text color preserved
  touch:
    tap-highlight: transparent
    hover-on-coarse-pointers: disabled (see agents-styles.css §7) to avoid double-tap traps
  reduced-motion: not yet wired — add `@media (prefers-reduced-motion: reduce)` guards when introducing motion-heavy surfaces.
---

# Churro Coder — Desktop Design System

> **Single source of truth for any new UI in `apps/desktop`.** When you build a new screen, dialog, panel, or component variant, read this file end-to-end first and prefer the tokens, primitives, and patterns defined here over inventing new ones. The YAML front-matter above is the machine-readable token export; the prose below is the rationale and the rules.
>
> Token plumbing lives in [src/renderer/styles/globals.css](src/renderer/styles/globals.css) (canonical HSL vars), [src/renderer/styles/agents-styles.css](src/renderer/styles/agents-styles.css) (scoped overrides for `[data-agents-page]`), and [tailwind.config.js](tailwind.config.js) (Tailwind utility mapping). Component-level primitives live in [src/renderer/components/ui/](src/renderer/components/ui/).

## 1. Overview

Churro Coder is a local-first Electron desktop app. The shell is a **frameless window** with a dockview-managed center panel, two rails (left chat list, right terminal/inspector), and a draggable tab strip standing in for the OS title bar. The visual language is a calm neutral palette pierced by one saturated accent — `#0034FF` electric blue — used for primary CTAs, focus rings, drag-drop overlays, and selection. Density is **compact and information-dense**, modeled after IDE chrome rather than marketing pages: 7 px-tall buttons, 40 px tab strips, 6 px shell gaps, and 12 px monospace diff cells.

The system has two themes (light, dark) toggled via `.dark` on `<html>`. Inside the agents surface (`[data-agents-page]`), a small set of tokens is rescoped for code-block contrast — that's the only place tokens diverge between regions.

## 2. Colors

All colors are **HSL triplets** stored as CSS custom properties and consumed through `hsl(var(--token))` (or its Tailwind alias — `bg-primary`, `text-foreground`, etc.). The color model is intentionally a small fixed palette; we do not emit one-off hex colors in component code.

The palette is built from three tiers:

1. **Surface tier** — `background`, `card`, `popover`, `tl-background`, `input-background`. These define the planes the UI sits on.
2. **Content tier** — `foreground`, `muted-foreground`, plus the `*-foreground` companion of every surface. These are the text and icon colors paired to those surfaces.
3. **Intent tier** — `primary` (blue, action), `destructive` (red, danger), `plan-mode` (amber, "Plan Mode" affordance), `accent` (subtle hover wash), `border` / `input` / `ring` (chrome). Primary is the only color that's identical across light and dark — the blue is brand-locked.

Selection (`--selection`) is `primary @ 25%` (light) / `primary @ 30%` (dark). Search hits use yellow (`rgb(250 204 21)` at `0.35` inactive / `0.85` active). Both are intentionally outside the token grid because they need to feel transient.

**Inside `[data-agents-page]`**, `--muted` and `--muted-foreground` are rescoped (light: `0 0% 94%` / `0 0% 45%`; dark: `0 0% 14%` / `0 0% 55%`) so inline code blocks and chat metadata read correctly against the chat timeline. Use the agents tokens when building anything that lives inside that surface.

## 3. Typography

The app uses **Geist** (sans + mono), loaded as `var(--font-geist-sans)` and `var(--font-geist-mono)`. Geist is applied to the body globally and re-applied inside `[data-agents-page]` and its portaled descendants (Radix portals, dialogs, popovers, sonner toasts) — the explicit re-application is required because portals escape the agents subtree.

Defaults: weight `400`, OpenType features `rlig 1, calt 1` for ligatures and contextual alternates. The diff viewer (`.agent-diff-wrapper`) intentionally falls back to `Monaco, Menlo, Consolas, monospace` at `12px / 1.5` — that is the only place a non-Geist mono is acceptable.

The text scale is Tailwind's defaults (`text-xs` 12 / `text-sm` 14 / `text-base` 16). New surfaces should pick from `text-xs`, `text-sm`, and `text-base`. Larger sizes (`text-lg+`) are reserved for hero / empty-state moments.

## 4. Layout

The window divides into three structural zones, glued together by **dockview**:

- **Outer rails** (left + right): rounded cards inset from the window edge by `--shell-gap` (6 px), sized to the sidebar width token (`--sidebar-width: 240px`).
- **Center cell**: the dockview group view — splittable, tabbed, draggable. Each `.dv-groupview` renders as its own bordered card with `--dv-border-radius: 10px`.
- **Tab strip**: 40 px tall, doubles as the **window drag handle**. Trailing action buttons inside the strip opt out of drag via inline `WebkitAppRegion: 'no-drag'`.

The 6 px shell gap shows up in three places: the wrapper padding around the rails, the dockview sash inter-cell paddings (each sibling pays half), and the inset from the window frame. That symmetry is load-bearing — don't change one without the others.

For chat-style content surfaces, follow the `max-w-5xl` readable-width rule already documented in `AGENTS.md` (Shared UI Decisions). New full-width screens that aren't chat may opt out, but anything narrative or list-based should stay on the same column width as the chat panel.

## 5. Elevation & Depth

The system is mostly **flat**. Three depth devices are used and nothing else:

1. **Hairline borders** — `border-border` (1 px) and `border-border/0.5` for the dockview groupview cards. Borders carry the visual hierarchy.
2. **Soft drop shadows** — only for transient surfaces: toasts (`0 2px 6px rgba(0,0,0,0.08)`) and floating popups like the terminal link tooltip (`0 4px 12px rgba(0,0,0,0.15)`). Cards do **not** get drop shadows.
3. **Inset chrome on the default button** — a 0.5 px black outer ring + 1 px theme-aware inset highlight. This is the only place we use compound box-shadows on a standing element.

Dialogs in `[data-agents-page]` get a 4 px `ring` (neutral-200/80 light, neutral-800/80 dark) instead of a drop shadow — see §8 in `agents-styles.css`. Use the existing `[data-canvas-dialog]` / `.canvas-dialog` selectors rather than a new shadow.

## 6. Shapes

Radius is anchored to `--radius: 0.6rem` (~9.6 px). Tailwind exposes three steps off it:

- `rounded-sm` = `--radius - 4px`
- `rounded-md` = `--radius - 2px`  ← the **default for controls** (buttons, inputs, badges-as-chips)
- `rounded-lg` = `--radius`        ← cards, popovers, dialogs

Outside that scale, two corner radii are intentionally larger to read as a "shell" rather than a "control":

- **Dockview shell cards / drop overlay**: `--dv-border-radius: 10px`. Always use this token, not a hardcoded value, when extending dockview chrome.
- **Pill tabs inside the shell**: `6px`. Smaller than `--radius` so the tab reads as nested inside the card, not as another card.

`rounded-full` is reserved for the chip-style `Badge` and avatar dots.

## 7. Components

All component primitives live under [src/renderer/components/ui/](src/renderer/components/ui/) and follow the shadcn/ui contract: a Radix or HTML root wrapped in `cva` for variants, with `cn(...)` merging external classes last. **Always reach for an existing primitive before authoring a new one** — the inventory above (in the YAML) covers the vast majority of needs.

A few rules that flow from how the existing primitives are wired:

- `Button` defaults to `h-7 px-3 rounded-md text-sm font-medium`. The `lg` size (`h-10 px-8`) is the *only* taller variant; do not invent intermediate heights. Use `variant="brand"` for marketing-style hero CTAs, `default` for in-app primary actions, and `outline` / `ghost` for secondary affordances. `secondary` and `outline` look similar — `outline` is for forms, `secondary` for filter / segmented chips.
- `Input` is `h-9` (taller than buttons by design — text fields need the room) with a `3px` primary-tinted focus ring. Don't override the focus ring; downstream tabs / dialogs depend on it.
- `Badge` is `rounded-full` and tiny (`py-[1px]`). For non-pill labels, use a styled `<span>` or compose with `cn`, not a new badge variant.
- For new selection cards / form surfaces on the new-workspace screen, follow the **Shared UI Decisions** in `AGENTS.md` (use `rounded-md`, not oversized `rounded-2xl`).
- `Skeleton` (`bg-muted` + `animate-pulse`) is the **only** approved loading affordance. Don't introduce spinners except inside Sonner toasts (`.sonner-loading-wrapper`) where they are part of the library.

When you genuinely need a new variant, add it to the existing `cva` block rather than forking the component. If you need a new component, place it in `src/renderer/components/ui/` so it's discoverable by future agents.

## 8. Do's and Don'ts

**Do**

- Read tokens from `hsl(var(--token))` or Tailwind aliases (`bg-primary`, `text-muted-foreground`). The CSS-var indirection is what lets the dark theme work.
- Use `--shell-gap`, `--sidebar-width`, `--dv-border-radius`, and `--radius` instead of hardcoded `6px` / `240px` / `10px` / `0.6rem`.
- Wrap dialog and popover content with the existing primitives (`Dialog`, `Popover`, `DropdownMenu`); they already wire focus traps, escape handling, and the agents-page font re-application.
- Add `style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}` to any interactive control that lives under a drag region (the dockview tab strip, the settings dialog top bar). See `AGENTS.md` → Gotchas for the full list.
- Mark agent-surface roots with `data-agents-page` so the scoped tokens, font, and selection colors apply.
- Prefer `Skeleton` for loading state and `Sonner` toasts for transient feedback.

**Don't**

- Don't emit hex colors in component code. If a color isn't in the token table, add it to `globals.css` first.
- Don't add drop shadows to standing surfaces. Cards are flat; only transient overlays get shadow.
- Don't fork shadcn primitives by copy-pasting into a feature folder; extend the base `cva` instead. Forks rot.
- Don't override the dockview tab CSS outside `globals.css` — the comment block there documents a real specificity war with vendor-injected styles. Add new tokens to the `.cs-theme-*` block, don't reach in from a feature.
- Don't introduce `rounded-2xl` / `rounded-3xl` shells on form surfaces. The system reads as compact; oversized radii break the rhythm.
- Don't add a new font. Geist + the diff fallback are the entire stack.
- Don't introduce hover-only affordances without a `:focus-visible` equivalent — the `[data-agents-page]` focus ring is required for keyboard users and is enforced in agents-styles.css §5.
- Don't run hover effects on coarse pointers — agents-styles.css §7 already disables them; respect the override.

---

*If this document drifts from the code, update this file. The YAML front-matter is intentionally easy to grep — keep keys aligned with the CSS variable names so both stay searchable.*
