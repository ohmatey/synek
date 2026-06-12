---
phase: VERBS-T2
title: "The alive canvas — gap invitations & empty-state verbs"
status: "proposed (2026-06-12) — build-ready; build gated on Tier 1 signal OR the demo (B2)"
era: "Story Layer (the pivot)"
updated: 2026-06-12
roadmap: NEXT.5 Tier 2 (extends next5-verb-system.md)
owner: Margot (product) · Wren (UX) · Kael (canvas architecture)
links: [next5-verb-system.md, ../roadmap.md, product-strategy.md, canvas-command-palette.md]
---

# VERBS Tier 2 — The alive canvas (gap invitations)

> **The map shows its own holes and offers to fill them.** Where a timeline jumps centuries with nothing in between, a faint dashed "ghost card" appears *in that empty stretch* — "≈380 years empty here · fill this?" Tap it and your Claude gets a ready-made prompt to populate exactly that span. Empty lanes and bare eras get the same treatment. The canvas stops being a static record and becomes something that visibly *wants to grow* — and that single gesture is the hero beat of the launch demo.

## TLDR — for anyone, including the person who asked "what are ghost cards and dead zones?"

- **Dead zone** = a stretch of the timeline's left-to-right time axis with **no nodes in it** — a big empty gap between two dated things. Example: a Stoicism timeline that has Zeno (≈300 BCE) and then nothing until Marcus Aurelius (≈170 CE) has a ~470-year *dead zone* in the middle. The app already detects these (server-side, for Claude); this feature surfaces them *visually, to the user*.
- **Ghost card** = a faint, **dashed-outline placeholder** drawn *inside* a dead zone (or on an empty lane). It is **not a real node** — it's an *invitation*. It reads like "≈470 years empty here — fill this?" and, when clicked, hands you a copy-prompt that tells Claude to add real nodes in that exact date range. Solid card = something that exists; dashed ghost = a hole the map is offering to fill.
- **Why it's the demo centerpiece:** it makes the product's whole thesis ("a canvas that grows itself") legible in *one wordless gesture* — a hole appears, you fill it, the hole closes. That's the moment we build the 60-second launch recording around and **link from the landing page**.
- **Build-ready, but gated:** this PRD is complete enough to build. The *build* is gated on either Tier 1 verb copy-rates (the registry's discipline) **or** the demo need (bet B2) — and the demo is the likely trigger, which is a deliberate, recorded override of "let copy-rates decide."

## Plain-language primer (read this before the architecture)

**What is a "dead zone," precisely?** The canvas lays nodes out left→right by date (`instantToX` / the shared `TimeScale`). Take every node's date, sort them, and look at the gaps between neighbours. A gap that's **large relative to the whole timeline** (today: more than **15% of the total span**) is a dead zone — a visibly empty stretch of axis. This is already computed in `src/lib/mcp/layout-report.ts` (the `axis.deadZones` the `get_layout_report` MCP tool returns to Claude). The math is pure — it only needs node dates, which the canvas already has loaded — so the *client* can compute the exact same dead zones with no server call.

**What is a "ghost card," precisely?** A new, faint, dashed React Flow node rendered *at* a dead zone (positioned with the same `scale.toX()` every real node uses). It looks deliberately unlike a real node (dashed border, muted, a "+" affordance) so no one mistakes it for content. It carries a label ("≈470 years · 300 BCE–170 CE") and a call to action ("Fill this gap"). Clicking it opens the **same `PromptDialog`** every verb already uses, pre-filled with a prompt that says "add the significant people/events between these two dates." The user copies it into Claude; Claude calls `apply_patch`; the new nodes stream in (live SSE is already shipped); the gap closes.

**The one-sentence mental model:** *Tier 1 verbs answer "what can I do to this node?" — Tier 2 verbs answer "what's missing from this map, and will it help me fill it?"*

## Why this, why now

1. **It's the differentiator.** Every competitor can render a diagram. A diagram that **points at its own gaps and offers to close them** is a product with a point of view. The verb-system PRD calls this "the highest-delight idea; the one to build the demo around."
2. **The intelligence already exists — we're only *surfacing* it.** `get_layout_report` computes dead zones, sparse lanes, and bare eras today; the canvas just never *showed* them to the user. This is a presentation layer over existing analysis, not new analysis.
3. **It closes the loop with shipped infrastructure.** Live SSE (NOW.3) means a filled gap animates in *while you watch* — exactly the "watch it build" magic the North Star sells. Gap invitations are the user-initiated trigger for that magic.
4. **The demo (bet B2) needs a hero beat.** The 60-second recording needs one visceral, self-explanatory moment. "A 470-year hole appears, gets tapped, fills in live" is that beat — better than narrating a feature list.

**Gating, stated honestly.** The verb registry's discipline is "ship Tier 1, read copy-rates, build Tier 2 in copy-rate order — don't guess." This PRD is a *design*, which doesn't violate that. But the founder may pull gap invitations forward **for the demo**, ahead of copy-rate signal. That's a legitimate strategic override (B2 > the copy-rate queue), recorded here so it's a decision, not an accident.

## The experience

- On any timeline with a real dead zone, a **dashed ghost card** sits in the empty stretch, vertically near the top of the lanes. It's quiet — low contrast, no fill — so a dense, complete timeline shows *none* and a sparse one shows its holes.
- The ghost reads: a span label (**"≈470 years"**), the bracketing dates (**"300 BCE → 170 CE"**), and a **"Fill this gap"** affordance with a "+".
- A faint **dashed bracket** spans the full width of the gap (fromX→toX) so the extent is unmistakable — the card is centered within it.
- **Click** → the shared `PromptDialog` opens with a pre-filled, copyable prompt: *"…add the significant people, events, and works between 300 BCE and 170 CE that belong on this timeline…"* plus the usual add-context field ("e.g. focus on the Roman Stoics").
- Copy → paste into Claude → `apply_patch` → the new nodes **animate in live** (existing SSE + arrival animation) and the ghost **disappears** because the gap is no longer >15% of span. The hole closes itself.
- **Empty lanes** (a swimlane the timeline declared but barely populated) and **bare eras** (a period node with few/no nodes inside it) get the same dashed-invitation treatment in their own region — same primitive, different target.

## The demo centerpiece (and the landing-page link)

**The hero beat.** In the 60-second North Star recording (Claude left, Synek right), after the initial Stoicism timeline builds, the camera rests on a visible **470-year ghost gap**. The user clicks it, pastes the prompt, and the gap **fills in live** — Roman Stoics cascading into the empty centuries. No narration needed: the map asked, the user answered, the map grew. This is the single most legible expression of the product thesis.

**Landing-page deliverable (in scope for this PRD).** The signed-out landing page (`src/components/home/Landing.tsx`, with `HeroPreview` / `LiveTimeline`) must **feature and link the demo**:
- A section near the hero — *"Watch the canvas fill its own gaps"* — with the 60-second recording (or an autoplaying muted loop of the fill moment) and a link to the full demo.
- The existing `HeroPreview`/`LiveTimeline` animated mock should, if cheap, show a ghost card filling as part of its loop — so the landing page *demonstrates* the differentiator, not just describes it.
- The demo recording artifact itself is tracked as **local-61** (North Star). This PRD adds the landing-page surface for it; the recording is its prerequisite.

## Goals

- Render dead zones, empty lanes, and bare eras as **dashed ghost invitations** on the canvas — quiet when the map is full, present when it's sparse.
- Clicking an invitation opens the shared `PromptDialog` with a target-scoped fill prompt (gap date-range / lane / era), instrumented like every verb.
- **One source of truth for "what's a gap":** the client recomputes dead zones from the already-loaded graph using the *same rule* as `layout-report.ts` (extract it to a shared pure module — no drift between what Claude sees and what the user sees).
- A filled gap **closes itself** (re-derived from data; no manual dismiss) and animates in via the shipped SSE path.
- The landing page features + links the demo built around this.

## Non-goals (explicitly deferred)

- **In-app execution.** Ghost cards produce a **copy-prompt** (the inversion). The `PromptDialog` swap-seam becomes one-click "Run" only when hosted.
- **Auto-filling gaps.** Synek never fills a gap on its own — that's the deferred Living-Timelines agent (LATER.2). Gap invitations are *user-initiated*.
- **New gap *analysis*.** We reuse the existing 15%-of-span rule. Tuning the threshold, ML-ranked "importance" of a gap, or per-lane gap detection beyond the simple cases are out.
- **Tier 3/4 verbs** (Add sources, Fix this, Tidy layout, multi-select, right-click menu, edge verbs) — separate.
- **Dismissing/snoozing an invitation.** If the map says it's a gap, it's a gap until filled; no per-user hidden state in the Core.

## How it works (architecture)

A **client-only** presentation layer over data already loaded + the existing PromptDialog machinery. No schema, no RPC, no MCP contract change.

### 1. Dead-zone detection — shared rule, client recompute

Extract the gap rule from `layout-report.ts` into a pure module, e.g. `src/lib/domain/dead-zones.ts`:

```ts
export type DeadZone = { fromInstant: number; toInstant: number; years: number }
// Same rule as layout-report.ts:74–87 — a gap > THRESHOLD of the total span.
export function findDeadZones(instants: number[], threshold = 0.15): DeadZone[]
```

`layout-report.ts` imports it (so the MCP tool and the canvas can never disagree on what a gap is). The canvas calls it with the instants it already has (`gnodes` flat-mapped over `startInstant`/`endInstant`) — **zero fetch, zero DB**. (`buildLayoutReport` itself stays server-side because it also reads stories/citations from the DB; only the pure gap rule is shared.)

### 2. Ghost cards as a React Flow node type

- `nodeTypes` (module-level in `TimelineCanvas`, currently `{ event, entity, period, concept }`) gains **`gap`** → a new `GapInvitationNode` component (`src/components/canvas/nodes/GapInvitationNode.tsx`): dashed border, muted, span label + dates + "Fill this gap" + icon.
- In the `rfNodes` build (the `useMemo` around `TimelineCanvas:531`), after real nodes are positioned, compute dead zones and push one ghost node per zone:
  - **x** = `scale.toX(midInstant)` (midpoint of the gap) — same scale every real node uses, so it sits correctly under pan/zoom.
  - **width** = `scale.toX(toInstant) - scale.toX(fromInstant)` for the dashed bracket; the card itself is fixed-width, centered.
  - **y** = a reserved band near `LANE_TOP` (above/!overlapping the period lane) so ghosts never collide with content; they are **excluded from `layoutLaneY` packing**.
  - `selectable: false`, `draggable: false`, `data: { deadZone, onFill }`.

### 3. Click → the shared PromptDialog

- A new builder `buildFillGapPrompt({ timelineId, fromDate, toDate, years })` (sibling in `node-verb-prompts.ts`) → an `apply_patch` prompt scoped to that date range.
- The ghost's `onFill` builds a `PromptSpec` (a new `fillGapSpec` in `verbs.ts`, *not* node-scoped — gap/lane/era-scoped) and opens the same `PromptDialog` the canvas already hosts. Analytics: the shipped `verb_prompt_copied` event, `verb_id: 'fill-gap'` (+ `years`, `surface: 'canvas_gap'`) — so its copy-rate sits in the same B5 query as every other verb.

### 4. Collapse-gaps interaction (the one real gotcha)

`makeTimeScale(collapseGaps: true)` already **squeezes** big empty spans to `COLLAPSED_PX` and returns `collapsedRanges` (the squeezed x-spans). So in collapse mode the dead zone is *already* visually compressed:

- **Linear mode (collapseGaps off):** render the dashed ghost card in the open empty space (the common case).
- **Collapse mode (collapseGaps on):** don't draw a wide ghost into a squeezed gap — instead make the **existing collapsed-range break marker the clickable fill affordance** (the squeezed gap *is* the invitation). Same `fillGapSpec`, attached to the marker.

This keeps the two features coherent instead of fighting.

### 5. Empty-lane & bare-era variants (same primitive)

- **Empty / sparse lane:** `layout-report` already computes `lanes.fragments` (lanes with ≤2 nodes). Reuse that rule client-side; render a dashed "Add to {lane}" ghost at the lane's empty end. Builder: `buildExtendLanePrompt` (`add_node` + `lane`).
- **Bare era:** `layout-report.eras[].nodesWithin` already counts a period's contents. A period with few nodes inside renders a "Populate {era}" affordance on/near the period node. Builder: `buildPopulateEraPrompt` (`add_node`, optionally `write_story` for an overview). These share `GapInvitationNode`'s look via a `variant` prop.

## The three Tier 2 verbs

| Verb | Trigger (from existing analysis) | Affordance | MCP tool | Build priority |
|---|---|---|---|---|
| **Gap invitations** | `axis.deadZones` (>15% span) | dashed ghost card in the empty stretch | `add_node` | **First — the demo centerpiece** |
| **Populate / extend era** | `eras[].nodesWithin` low | affordance on the period node | `add_node` (+ opt. `write_story`) | Second |
| **Add a rival track** | `lanes.fragments` (≤2 nodes) | dashed "add to lane" at the lane's end | `add_node` + `lane` | Third |

All three are the **same primitive** — a dashed invitation rendered from existing layout analysis, opening the shared `PromptDialog`. Gap invitations is build-ready in full below; the other two are variants once the `GapInvitationNode` + `fillGapSpec` pattern exists.

## Key decisions

| Question | Decision | Why |
|---|---|---|
| Where does "is this a gap?" live? | **One pure module (`dead-zones.ts`) imported by both `layout-report.ts` and the canvas.** | The user must see the *same* gaps Claude sees; two copies of a 15% rule would drift. |
| Recompute on client or fetch? | **Recompute client-side from the loaded graph.** | The rule needs only node dates, already in memory. A fetch would be slower and pointless (mirrors NAV's client-only stance). |
| Ghost = React Flow node or overlay? | **A `gap` node type, excluded from layout packing + selection.** | Reuses `scale.toX`, pan/zoom, and the render pipeline for free; an overlay would re-implement positioning. |
| What about collapse-gaps mode? | **Ghost card in linear mode; the collapsed-range marker becomes the affordance in collapse mode.** | The two features both act on big gaps; unify them instead of drawing a ghost into a squeezed span. |
| Can a user dismiss a gap? | **No — gaps are derived from data and close when filled.** | No per-user hidden state in the Core; a "gap" is an objective fact about the map, not a notification. |
| Execute now or copy? | **Copy-prompt; `PromptDialog` is the swap point.** | The inversion; hosted "Run" later, callers unchanged. |
| Build all of Tier 2 at once? | **Gap invitations first (demo); era + rival-track follow as variants.** | Ships the centerpiece fastest; the other two are cheap once the primitive exists. |
| Build now or wait for copy-rates? | **Design now; build when Tier 1 signal *or* the demo (B2) calls — demo likely wins.** | Recorded override of the copy-rate queue for a strategic reason. |

## Touched files

- `src/lib/domain/dead-zones.ts` (new — shared gap rule); `src/lib/mcp/layout-report.ts` (import it, drop the inline copy).
- `src/components/canvas/nodes/GapInvitationNode.tsx` (new — dashed invitation, `variant`: gap / lane / era).
- `src/components/canvas/TimelineCanvas.tsx` (`nodeTypes` += `gap`; push ghost nodes in the `rfNodes` memo; host the fill `PromptDialog` if not already; collapsed-marker affordance).
- `src/lib/node-verb-prompts.ts` (+ `buildFillGapPrompt`, `buildExtendLanePrompt`, `buildPopulateEraPrompt`); `src/lib/verbs.ts` (+ `fillGapSpec` etc., gap/lane/era-scoped — sit alongside `NODE_VERBS`).
- `src/components/home/Landing.tsx` (+ demo section/link); optionally `HeroPreview.tsx` / `LiveTimeline.tsx` (ghost-fill in the loop).
- Analytics: reuse `verb_prompt_copied` (no union change).

## Done when

- [ ] A timeline with a real dead zone shows a dashed ghost card in the empty stretch, labelled with the span + bracketing dates; a dense timeline shows none.
- [ ] Dead zones are computed by the shared `dead-zones.ts` rule — `layout-report.ts` and the canvas import the *same* function (verified: identical zones for a fixture graph).
- [ ] Clicking a ghost opens the shared `PromptDialog` with a date-range-scoped fill prompt + add-context field; copy fires `verb_prompt_copied` (`verb_id:'fill-gap'`).
- [ ] After Claude fills the span (or in a seeded test), the ghost disappears because the gap is no longer >15% of span — no manual dismiss.
- [ ] Ghosts are non-selectable, non-draggable, excluded from lane packing, and don't collide with real nodes; correct under pan/zoom.
- [ ] Collapse-gaps mode: no wide ghost drawn into a squeezed span; the collapsed-range marker is the fill affordance instead.
- [ ] Empty-lane and bare-era variants render from `lanes.fragments` / `eras[].nodesWithin` and open their respective prompts.
- [ ] Landing page features + links the demo; (if done) `HeroPreview` loop shows a ghost filling.
- [ ] No schema / RPC / MCP change; no new fetch. `typecheck` + `build` green; live in-browser pass (prod build) confirms ghost render + fill.

## Open questions

- **Threshold reuse vs demo tuning** — 15% of span is the existing rule; does the demo want a slightly more eager threshold so the Stoicism seed reliably shows one hero gap? (Lean: keep 15%, ensure the seed has a real gap rather than tuning the rule.)
- **Ghost vertical placement** — a single reserved band at top, or one ghost per affected lane? (Lean: one top band for axis dead zones; lane/era variants render in their own region.)
- **How many ghosts at once** — cap to the top N gaps (like `layout-report`'s `MAX_DEAD_ZONES = 4`) to keep the canvas calm? (Lean: yes, cap at ~3–4, biggest first.)
- **Landing demo: recording vs live mock** — ship the linked 60-second recording first, upgrade `HeroPreview` to show a live ghost-fill later? (Lean: yes — recording is the gate, live mock is a follow-up.)

## Dependencies

None at the data layer. Client-only; reuses the loaded graph, `scale.toX` (`useTimelineScale.ts`), the shipped SSE arrival animation (NOW.3), and `PromptDialog`/`PromptSpec`/`verb_prompt_copied`. Shares the gap rule with `layout-report.ts`. **Prerequisite for the landing-page surface:** the demo recording (**local-61**, North Star). Extends `next5-verb-system.md` (this is its Tier 2).
