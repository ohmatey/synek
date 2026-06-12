---
phase: VERBS
title: "Expansion affordances — the verb system"
status: "proposed (2026-06-12) — Tier 1 active; PRD owed per roadmap NEXT.5"
era: "Story Layer (the pivot)"
updated: 2026-06-12
roadmap: NEXT.5 (generalizes NAV's action registry · S3.4 is verb #1)
owner: Margot (product) · Wren (UX)
links: [canvas-command-palette.md, s3-multi-pov.md, ../roadmap.md, product-strategy.md]
---

# VERBS — Expansion affordances (the verb system)

> **Every object you look at offers its obvious next move.** A person node says *Talk to me*. A thin era says *Populate me*. An uncited claim says *Add a source*. The canvas stops being a thing you read and becomes a thing you grow — and each move is a copyable prompt your Claude runs, so the inversion holds. This is the systematic version of the two actions NAV stranded in ⌘K, brought to the surface you actually dwell on: the node panel.

## Why this, why now

NAV (`canvas-command-palette.md`) shipped exactly two action affordances — *Improve this timeline* and *Talk to {entity}* — and both are reachable **only** through ⌘K. The node detail panel, the surface a user actually rests on while reading a moment, has **no way to expand what it's showing**. That is the literal gap the founder named: *Talk-to exists in the palette but not on the person panel.*

Three things make now the right time:

1. **The machinery is already built and proven.** `PromptSpec → PromptDialog → copy` shipped with NAV; `buildTalkToPrompt` / `buildImproveTimelinePrompt` exist; `PromptSpec.analytics` fires a PostHog event on copy (`PromptDialog.tsx:136`). A new verb is *one builder + one button* — no new infrastructure.
2. **The canvas already computes its own gaps.** `get_layout_report` surfaces axis dead zones, sparse lanes, and uncited nodes; `apply_patch` `warnings` surface broken images / dead links. The "what's missing" intelligence exists server-side — this work *surfaces it as user-facing invitations* rather than computing anything new.
3. **It validates bet B5** (`product-strategy.md`) — *the verb system drives expansion*. Instrumented from day one, copy-rates self-prioritize Tier 2/3, so we stop guessing which verbs matter and let signal decide.

This is the highest love-per-effort item on the NEXT board and **parallelizable with S2** (artifact grounding): Tier 1 touches `NodeDetailPanel.tsx` in a different region (an action row *above* the read content) than S2.4's artifact cards (*under* beats).

## The primitive

Every verb is the same shape:

```
object (node / era / lane / warning)  +  intent  →  PromptSpec  →  MCP tool
```

One `PromptSpec` builder per verb — a sibling of `buildTalkToPrompt` — reused across every surface the verb appears on. Adding a verb = write one builder, register where it shows. The `PromptDialog` is the single render + copy + instrument point.

## Two families — keep them distinct in the UI

- **Interact (explore)** — conversational, **no graph change**. Playing with the map (*Talk to Caesar*). Optionally tailed with "…and if you learn something, add it," letting play spill into growth.
- **Expand (mutate)** — the prompt instructs Claude to call `apply_patch` / `write_story`. Growing the map (*Find who influenced Caesar*).

Do not collapse the two into a generic "Ask AI." *Talk to* (play) and *Expand around this* (grow) are different gestures and must read differently — distinct grouping, distinct verb language.

## Intent → capability map

Each intent ties to the MCP tool it drives. The Source/verify + Restructure intents are already **computed** server-side (`warnings`, `get_layout_report`) — this work surfaces them.

| Intent | Family | What the verb asks Claude to do | MCP tool |
|---|---|---|---|
| Deepen | expand | tighten summary, sharpen dates/precision, add a portrait, cited claims | `update_node` |
| Branch / connect | expand | pull in linked people/orgs/events not yet on canvas; wire edges | `add_node` + `add_edge` |
| Narrate | expand | turn a moment into beats (cast, images, focus tour) | `write_story` |
| Voice / interact | interact | first-person roleplay of an entity | none (opt. `write_story`) |
| Contextualize | expand | add concurrent events in the field/region as a parallel lane | `add_node` + `lane` |
| Source / verify | expand | back uncited claims, replace dead images/links, upgrade `sourceType` | `update_node` |
| Restructure | expand | merge duplicate lanes, collapse dead zones, populate an empty era | `set_timeline_view`, `add_node`, `update_node.lane` |

## The verb catalogue

Priority = love ÷ effort. Tier 1 all reuse the shipped machinery — one builder + one button each.

**Tier 1 — node-panel action row (this slice; ship together):**

| Verb | Object / shown when | Family | MCP |
|---|---|---|---|
| **Talk to {name}** | entity (esp. person) — *S3.4* | interact | — |
| **Expand around this** | any node | expand | `add_node` + `add_edge` |
| **Improve this {type}** | any node | expand | `update_node` |
| **Write a story here** | any node (promote from the buried Story section) | expand | `write_story` |
| **What else was happening?** | event / period | expand | `add_node` + `lane` |

**Tier 2 — the "alive canvas" layer (signature; higher effort; defer until Tier 1 proves engagement):**

| Verb | Object / surface | MCP |
|---|---|---|
| **Gap invitations** | axis dead zones rendered as dashed ghost-cards | `add_node` |
| **Populate / extend era** | period panel (*populate · era before/after · overview story*) | `add_node`, `write_story` |
| **Add a rival track** | empty / sparse lane | `add_node` + `lane` |

**Tier 3 — refine / trust (state-gated):**

| Verb | Object / surface | MCP |
|---|---|---|
| **Add sources** | shown only on uncited nodes (badge → panel) | `update_node` |
| **Fix this** | broken-image / dead-link warning badge | `update_node` |
| **Tidy layout** | timeline-level (⌘K + display popover) | `set_timeline_view` + `update_node` |

**Tier 4 — bigger bets (defer until Tier 1 proves engagement):** multi-select **Connect these** / **Story spanning these**; node/canvas **right-click context menu** (the eventual home for the full library); edge-click **Explain this link** / branch-between-A→B.

## Where they live — one seam, three surfaces, state-aware

1. **Node-panel action row (primary, this slice).** A horizontal strip of 3–4 verb-buttons under the title/dateline in `NodeDetailPanel`, **before** the read content — **type- and state-gated**: a person shows *Talk to · Expand · Improve*; an era shows *Populate · adjacent-era · overview*; an uncited node surfaces *Add sources*. The state-gating is the anti-clutter mechanism: never 8 buttons, always the 3 *this* node wants.
2. **Canvas gap / empty-states (the differentiator, Tier 2).** Dead zones + empty lanes from `get_layout_report` render as **dashed ghost invitations**, not solid cards — the map showing its own holes and offering to fill them. Highest-delight idea; the one to build the demo around.
3. **⌘K as the power-user mirror.** Every verb is also a command scoped to the selected node — NAV's registry just grows. Palette = keyboard path; panel + gaps = discoverable paths.

Card **hover** gets at most *one* subtle affordance that opens the same menu — no per-card toolbar; preserve the calm canvas.

## Goals

- Surface the right 3–4 verbs on every node panel, gated by node type and state, with zero clutter.
- Each verb is one `PromptSpec` builder reused across panel + ⌘K (+ later gaps), rendered by the shared `PromptDialog`.
- Every verb instrumented on copy via `PromptSpec.analytics` so copy-rates prioritize later tiers.
- Talk-to (verb #1, S3.4) lands on the person panel — closing the named gap.
- Forward-compatible: when hosted, `PromptDialog`'s copy button becomes one-click **Run** with no caller changes.

## Non-goals (explicitly deferred)

- **In-app execution.** Verbs produce a **copyable prompt** (the inversion — the user's Claude runs it). `PromptDialog` is the deliberate swap-point for a future hosted "Run"; not built now.
- **Tier 2–4.** Gap invitations, era population, rival tracks, sources/fix/tidy, multi-select, right-click menu, edge verbs — all later, gated on Tier 1 engagement. This slice is the panel action row only.
- **A new schema, RPC, or MCP contract.** Verbs ride existing tools (`apply_patch`, `write_story`, `update_node`, `set_timeline_view`). No DB change.
- **Generated illustrations** (N.4.5b) as a verb target — the *Deepen* verb may *ask* Claude to source a portrait, but the BYO-key generation path stays deferred.

## How it works (architecture)

A **pure client** feature riding the shipped prompt machinery — no schema, no server RPC, no Patch path, no MCP contract change.

- **The verb registry.** A module-level list of verb descriptors: `{ id, label(node), family, showWhen(node, layoutState), makeSpec(node, ctx) }`. `showWhen` is the type/state gate (e.g. `node.type === 'entity'` for Talk-to; `!hasCitations(node)` for Add-sources). `makeSpec` returns a `PromptSpec` (`{ title, description, params[], prompt, analytics }`).
- **Builders.** One per verb in `src/lib/*-prompt.ts`, siblings of `buildTalkToPrompt` / `buildImproveTimelinePrompt`. Each returns the prompt string; the registry wraps it into a `PromptSpec` with an `analytics.event` so copy fires a PostHog `ClientEvent` (the seam at `PromptDialog.tsx:136`).
- **Panel action row.** A new `NodeVerbBar` component rendered in `NodeDetailPanel` under the dateline, before read content. It filters the registry by `showWhen` for the current node, caps at 3–4, and on click opens the shared `PromptDialog` (reusing NAV's sequencing — open the dialog after any prior modal animates out).
- **State signal for gating.** Type comes from the node; "uncited" / "broken image" state comes from data already on the node (`metadata.citations`, `images`) — no new fetch. (Layout-report-derived gates like dead-zones are Tier 2.)
- **⌘K parity.** The same registry feeds NAV's action group scoped to the selected node — the palette stops hardcoding Improve/Talk-to and reads the registry instead.

**Touched files (Tier 1):** `src/lib/verbs.ts` (new — the registry), `src/lib/expand-prompt.ts` + `src/lib/whats-happening-prompt.ts` (new builders; *Improve*, *Talk-to*, *Write-story* reuse existing builders), `src/components/canvas/NodeVerbBar.tsx` (new), `src/components/canvas/NodeDetailPanel.tsx` (mount the bar; promote the buried Story section into *Write a story here*), `src/components/canvas/CommandPalette.tsx` (read the registry instead of hardcoded actions). Reuses `PromptDialog.tsx`, `PromptSpec`, `composePrompt`, `capture`. **No dependency added.**

## Key decisions

| Question | Decision | Why |
|---|---|---|
| Generic "Ask AI" vs distinct verbs? | **Distinct verbs, two families.** | *Talk to* (play) and *Expand* (grow) are different gestures; one button erases the distinction that makes the canvas feel alive. |
| How to avoid button clutter? | **Type- + state-gated `showWhen`, cap 3–4.** | The anti-clutter mechanism *is* the gating — always the verbs *this* node wants, never the full catalogue. |
| Registry vs per-surface hardcoding? | **One module-level registry; surfaces read it.** | Panel, ⌘K, (later) gaps all render the same verbs; NAV already hardcodes two — this de-duplicates and makes "add a verb" one place. |
| Where does the row live in the panel? | **Above read content, under the dateline.** | It's the *first* move offered; also keeps it clear of S2.4's artifact cards (which render under beats) so the two can land in parallel. |
| Execute now or copy? | **Copy-only; `PromptDialog` is the swap point.** | The inversion: the user's Claude runs it. Hosted "Run" is one swap, callers untouched. |
| How do we prioritize Tier 2/3? | **Instrument every Tier-1 verb on copy; let rates decide.** | `PromptSpec.analytics` is wired (PostHog). Building Tier 2 on a guess wastes the most effort-heavy tier. |
| Promote the Story section to a verb? | **Yes — *Write a story here* in the row.** | Story creation is buried in the panel today; it's the canonical Narrate verb and belongs with its siblings. |
| Gap invitations in this slice? | **No — Tier 2.** | Highest delight but highest effort (canvas render, not a button); ship after Tier 1 proves people copy verbs at all. |

## Sequencing & instrumentation (the discipline)

1. **Ship Talk-to on the person panel first** (S3.4, verb #1) — the smallest proof; the builder already exists.
2. **Fill out the Tier-1 row** (Expand · Improve · Write-story · What-else) — ~1–2 days, all reused machinery.
3. **Instrument every verb** via `PromptSpec.analytics` (fires on copy).
4. **Read copy-rates, then build Tier 2/3** in copy-rate order — don't guess.

## Forward-compatible with hosting

Every verb is a copy-prompt **today**; when Synek goes hosted, `PromptDialog`'s swap-seam turns each into one-click **Run** (see `roadmap.md` → *Hosting horizon*; bet B7 in `product-strategy.md`). The verb library built now **is** the future hosted action menu — built entirely as local-first Core UX, no scope-guardrail violation.

## Done when (Tier 1)

- [ ] A type/state-gated action row renders under the dateline in `NodeDetailPanel`, before read content, capped at 3–4 verbs.
- [ ] A **person** shows *Talk to · Expand around this · Improve this*; an **event/period** shows *Write a story here · What else was happening · Improve this*; an **uncited** node surfaces *Add sources* (Tier 3 gate, if cheap) or omits it.
- [ ] Each verb opens the shared `PromptDialog` with title + description + params + copyable prompt + add-context field.
- [ ] **Talk to {name}** appears on the person panel (the named gap), reusing `buildTalkToPrompt`.
- [ ] Every verb fires a distinct `PromptSpec.analytics` event on copy (verified in PostHog or the capture seam).
- [ ] The ⌘K action group reads the same registry (no more hardcoded Improve/Talk-to).
- [ ] *Write a story here* replaces / promotes the buried Story section.
- [ ] No schema, RPC, Patch, or MCP change; no new fetch. `typecheck` + `build` green.
- [ ] Live in-browser pass (prod build): row renders per node type, a verb copies a prompt with context appended.

## Open questions

- **Verb cap when many qualify** — 3, 4, or an overflow "More…"? (Lean: hard cap 4, overflow to ⌘K.)
- **Hover affordance shape** — a single "+" / sparkle that opens the menu, or the first verb inline? (Lean: one subtle opener; preserve the calm canvas.)
- **Add-sources gate** — ship the Tier-3 *Add sources* gate inside Tier 1 (it's a cheap `!hasCitations` check) or hold it? (Lean: include if it's truly one line.)
- **Interact vs Expand visual separation** — a divider, a color, or just order? (Wren to spec; must not read as one generic action.)

## Dependencies

None at the data layer. Client-only; reuses `PromptDialog` / `PromptSpec` / `composePrompt` / `capture` (`PromptDialog.tsx`), the prompt builders (`talk-to-prompt.ts`, `timeline-prompt.ts`), and the graph already loaded by `TimelineCanvas`. **Parallel-safe with S2** (different `NodeDetailPanel` region). Forward-links: S3.4 (`s3-multi-pov.md`) is verb #1; Tier 2 *Add sources* / *Fix this* surface S2's `warnings` + `get_layout_report` once those land.
