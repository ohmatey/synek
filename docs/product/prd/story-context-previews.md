---
phase: STORY-CTX
title: "Story context previews — the other axis, right now"
status: "proposed · refined 2026-06-13"
era: "Story Layer (the pivot)"
updated: 2026-06-13
roadmap: NEXT (after GLOBE v1 + GS1; parallel-safe with GS2–GS4)
owner: Margot (product) · Kael (canvas architecture) · Wren (UX)
links: [globe-lens.md, globe-stories.md, ../roadmap.md, product-strategy.md]
pending-sync: false
---

# STORY-CTX — Story context previews (the other axis, right now)

> **Every beat knows when and where it happened. The reader shows you whichever axis you can't already see.** On the timeline canvas (you see WHEN) a compact mini-globe pinpoints the WHERE. On the globe lens (you see WHERE) a small time-strip marks the WHEN. One preview, complementary, always present — no lens-switching required to hold both axes in mind at once.

## TLDR

- **The gap:** reading a story in Timeline view gives you no WHERE signal; reading in Globe view gives you no WHEN signal. Both halves of the spatiotemporal context exist in the data; neither surface hands the other one across.
- **The fix:** a single, compact, auto-switching context preview widget inside the story reader — it shows the missing axis depending on which lens is active. One thing, two states, always correct.
- **Zero schema work.** `GraphNode` already carries `lat`/`lng`/`geoScope` AND `startInstant`/`endInstant`/`precision`. `StoryReader` already receives `nodeById`. The only new wire is passing `lensView` into `StoryReader`.
- **Graceful degradation for all three placeless states.** Missing coords → caption from `GEO_SCOPE_LABELS`; unset → a quiet backfill nudge using `globeBackfillSpec`. No broken UI, no awkward silences.
- **Phase 1: complementary preview only (display).** Phase 2 (optional): tapping the preview switches lens, pre-focused on the beat's subject node — a "portal" between lenses.

---

## Refinement resolutions (2026-06-13)

A refine pass (folding in Wren's UX pass) settled the open placement/motion/phasing questions. **These supersede the leans in the draft below and in the open-questions table.**

- **Multi-reference (redesign 2026-06-13).** A beat references *many* nodes (`{focusNodeId} ∪ relatedNodeIds`), each with its own place and instant — so the previews plot the **whole referenced set**, not one subject: multiple pins on the peek globe and multiple markers on the strip, **focus highlighted**, the rest muted. The resting row summarises ("Athens **+2 places**"); the strip labels the beat's **time period** — the span across its references — on the right. Single-reference beats degrade to the one-pin / one-marker case.
- **Placement — a slim 40px context row at the foot of the beat stage that peeks.** Both previews rest in this row (below the narrative, above the prev/next footer): a 24px globe glyph + place label in Timeline view, the time-strip + date in Globe view — so the complementary axis is **always present as text** at a constant 40px, with no per-beat reflow. In Timeline view, hovering (desktop) or tapping (touch) the row **rises the full 140px globe as a popover** over the lower beat text — rich on demand, zero layout cost, dismissed on mouse-leave / outside tap; the popover also hosts the "open globe here" portal. A persistent ~150px band and a corner overlay were both rejected (too much height / image collisions). Beats only — never the cover or end panel. *(resolves OQ1)*
- **Mini-globe — a 140px legibility floor**, static, re-centering between beats with a ~150ms **opacity fade** (not an animated spin; snap under reduced motion). Below ~300px reader width, drop the globe and keep the label alone. *(resolves OQ3)*
- **Time-strip — a linear scale over the story's cast span**, not `makeTimeScale` gap-collapse (its break-hatching is meaningless at strip width). Faint cast ticks + a highlighted marker/span; drop the ticks above ~15 cast nodes.
- **Phase 2 portal is NOT gated on GS1.** It ships with **snap-to-target**: `MiniGlobe` already computes the rotation (`coordsToRotation`), passed to `GlobeLens` as a `focusRotation` prop, so the globe opens *on the tapped pin* — not a jarring default. The globe→timeline direction already works today. GS1 later upgrades the snap to an eased camera + per-beat following — an enhancement, not a prerequisite. *(resolves OQ5)*
- **Two required SC1 tasks** beyond the display work: (1) the GlobeLens inset fix so the globe insets by `detail + story` while reading (`TimelineCanvas.tsx:1201`) — ship-blocking for Globe-view reading; (2) extract the shared `coordsToRotation(lat,lng) => [-lng,-lat]` helper now, so GS1 reuses it.
- **Verified:** `scripts/seed.ts` is already coordinated (107 lat/lng pairs — Athens, Rome, Rhodes, Thebes), so the seeded Stoicism timeline lands in the **located** state and demos the mini-globe out of the box. The Phase-1 validation metric won't just be measuring degradation.

Still open (low-risk implementation calls, confirm in the browser pass): OQ2 (chunk strategy), OQ4 (strip-vs-scrubber visual noise).

---

## Problem and opportunity

### Who this is for

The history/learning enthusiast (primary persona, `product-strategy.md`). Their loop: ask Claude → watch the canvas build → wander it → read stories → come back and deepen it. When a story plays, they're fully absorbed — each beat carries a time, a place, a cast. But the lens they happen to be in gives them only half the picture.

On the **timeline canvas**: they see Zeno born in Cyprus "334 BCE" precisely — but where is Cyprus relative to Athens where he taught? The spatial arc that made Hellenistic philosophy what it was is invisible. They'd have to stop reading, switch to the globe, find the node.

On the **globe lens**: they're watching nodes light up at coordinates — but when a story beat says "and here the influence crossed to Rome," the temporal dimension collapses. The scrubber tells them the cursor is somewhere in the first century CE, but there's no at-a-glance signal tying this specific beat to the broader timeline of Stoic history.

Both gaps share the same structure: **one axis is fully visible (the active lens); the other axis is dark (you'd have to leave to see it)**. The story reader is the one surface where both should be legible simultaneously — because stories are spatiotemporal objects, not just sequences of text.

### Against the strategy

**B3 ("stories make it a product"):** a story that only tells you half of where and when it's set is less compelling than it could be. Context previews close the last gap in the story reader's spatiotemporal coverage — without adding a third lens or requiring the user to manage two windows.

**B2 ("watch it build is the wow"):** the mini-globe preview in timeline view is a "screenshot moment" — a compact, beautiful satellite of the main globe experience embedded directly in the reading flow. It makes the story reader feel like a premium, spatially-aware artifact.

**B5 ("the verb system drives expansion"):** the unset degradation state (quiet backfill nudge) continues the verb-system principle that every gap in the data should visibly invite resolution. A node with no coordinates surfaces that gap at exactly the right moment (when a beat focuses it) rather than requiring a full layout-report review.

**Scope guardrail check:** single-user, local-first Core UX. No cloud, no model, no geocoding, no new MCP tools, no schema migration. The data is already there; this is viewer wiring. Clean.

---

## The experience narrative

You've built a Stoicism timeline with coordinates seeded. You open a story on "Zeno's road to the Stoa" and press Play.

**In Timeline view:**

The reader docks to the right. Beat 1 ("Born in Citium, Cyprus") appears. At the foot of the reader, a slim context row shows the place; hover or tap it and a small static globe thumbnail peeks up — orthographic, the same d3-geo projection as the globe lens, reusing the lazy-loaded `GlobeLens` chunk. Cyprus glows. A compact label reads "Citium, Cyprus." No spinning, no playback — just the place, right now, right here.

Beat 2 ("Shipwrecked at Athens"): the thumbnail eases to center on Athens. The globe shifts. You didn't leave the story; you didn't need to.

Beat 5 ("Marcus Aurelius in Rome"): a new thumbnail — Rome glows. You know exactly where you are in the ancient world without switching lenses.

*A beat about the concept of the "dichotomy of control"* — a node with `geoScope: 'global'`. The thumbnail disappears; a label appears: "Worldwide — no single place." That's the right answer.

**In Globe view (you already switched before starting the story):**

The story reader opens over the globe. Beat 1 — the globe already rotated to Cyprus (GS1, the headline feature of globe-stories.md). In that same foot row, a slim **time-strip** rests: a miniature horizontal axis, the full temporal extent of this story as a narrow band, with a small cursor tick marking 334 BCE. Zeno's node instant is marked. You see WHEN.

Beat 4 ("Chrysippus leads the school, ~230 BCE"): the cursor tick jumps left along the strip. You track the story's progression through time without needing to read the scrubber on the globe or exit to the timeline.

The time-strip is complementary — you're watching WHERE on the globe; the strip hands you WHEN.

---

## What the previews are and are not

**Mini-globe (Timeline view → shows WHERE):**

- A compact, static orthographic globe thumbnail, **140px** square — the legibility floor (below it the landmasses read as mush). It is **not** persistent chrome: at rest the foot row shows a 24px globe glyph + the primary place and a `+N places` count (~40px); on hover/tap the 140px globe **peeks up as a popover** showing **all** the beat's located pins (focus highlighted), and hosts the portal. The resting row never reflows. A persistent ~150px band (too tall) and a corner overlay (image collisions) were both rejected. Below ~300px reader width, keep the label only.
- Rendered by the same `GlobeLens` projection, but **static** — no scrubber, no playback, no rAF. Framed to the beat's referenced located nodes — rotated to their centroid via the `coordsToRotation` helper (extracted here, reused by GS1); the focus pin is accented + labelled, the rest muted. It **fades** (~150ms opacity) to the new framing between beats (snap under reduced motion).
- The lazy-loaded `GlobeLens` chunk is already on the page if the globe lens was opened; if not, it loads on first story beat that has coordinates (the 30–40kB gzip cost is deferred to first use, not first story play).
- **Not a mini-GlobeLens component** — the full GlobeLens has state, rAF loops, scrubbers, zoom. The thumbnail is a thin, stateless presentational component `GlobeThumb` (or a minimal subset) that accepts an **array** of `{lat, lng, focus}` pins and renders a static sphere framed to them. No rAF, no event listeners except the Phase 2 tap.

**Time-strip (Globe view → shows WHEN):**

- A slim strip living in the **resting 40px foot row** (the same row the globe glyph rests in, in Timeline view). Shows the story's cast span with a **marker per referenced node** (focus highlighted) and the beat's **time period on the right** (the span across its references); tapping it is the portal back to the timeline. No peek needed — the strip is already legible at row height.
- Each referenced node gets a marker at its `startInstant` (a span bar when `endInstant` is set); the right-aligned label is the beat's **period** — `formatInstantRange` when the references span time, `formatInstant` when there's one — from `src/lib/domain/dates.ts` (BCE-aware).
- Scale: a **simple linear map over the story's cast span** (min cast `startInstant` → max cast `endInstant ?? startInstant`) — **not** `makeTimeScale`'s gap-collapse, whose break-hatching is meaningless at strip width. Faint tick per cast node for context; drop the ticks above ~15 nodes.
- **No playback controls**. The globe's scrubber is the transport. This strip is a read-out.

**One or the other, never both.** The `lensView` prop gates which preview renders. In timeline view: mini-globe, no strip. In globe view: strip, no mini-globe. The globe view already shows WHERE (the globe is the WHERE canvas); the timeline view already shows WHEN (the timeline axis is the WHEN canvas). The preview fills only the gap.

---

## Data flow (the actual wire)

The beat's **referenced set** is `{focusNodeId} ∪ relatedNodeIds`, resolved through `nodeById` (already a `StoryReader` prop). Each member carries `lat`/`lng`/`geoScope`/`startInstant`/`endInstant`/`precision` (already on `GraphNode`). Located members (both `lat` + `lng`) become globe **pins**; every member becomes a strip **marker**; `focusNodeId` is the highlighted one (and still drives the canvas camera + detail panel, as `TimelineCanvas.tsx:540–543` does today). Cap a very busy beat at ~6 pins (focus + nearest) with a "+k more" note.

**The one new wire:** `lensView: 'timeline' | 'globe'` passed from `TimelineCanvas` into `StoryReader` as a new prop. `TimelineCanvas` already owns `lensView` state (line 485); `StoryReader` is already rendered in `TimelineCanvas`'s JSX (lines 1251–1271). This is a one-line prop addition.

Everything else is derived inside `StoryReader` from props it already has.

---

## Degradation states (all three, handled)

`GraphNode` can be in one of three location states. With **multiple references per beat**, apply this per node: located members are pinned + counted; placeless/unset members simply aren't (the `+N places` count reflects only located places). A beat whose references are **all** unlocated falls back to the focus node's state below:

| Node location state | Mini-globe (Timeline view) | Time-strip (Globe view) |
|---|---|---|
| **Located** (`lat`/`lng` present) | Renders the thumbnail, globe centered on coords, marker glowing. | Renders the strip with the beat's instant marked. |
| **Placeless** (`geoScope` set, no coords) | Thumbnail hidden; a compact label replaces it: `GEO_SCOPE_LABELS[geoScope]` — e.g. "Worldwide — no single place." Same display-only, no globe render. | Renders the strip unchanged — time data is unaffected by placeless status. |
| **Unset** (no coords, no `geoScope` — the default for many nodes) | Thumbnail hidden; a quiet muted label: "No place set." A single small backfill-nudge icon opens `globeBackfillSpec` for this node (the same prompt machinery already used in the globe banner + node panel). The nudge is subtle — it does not interrupt reading. | Renders the strip unchanged (same as above). |

The "unset" nudge is the verb-system principle applied at story-reading time: the right moment to invite a coordinate is exactly when the absence is noticed. The key word is **quiet** — it must not break the reading flow or draw the eye strongly enough to compete with the story text. A muted "no place set" and a small icon; nothing more.

---

## Phase 1 — Display only (the core bet)

Ship: mini-globe thumbnail and time-strip as display-only widgets in the `StoryReader` panel, gated on `lensView`.

This is the complete v1 scope. Acceptance criteria:

- [ ] `StoryReader` receives a `lensView: 'timeline' | 'globe'` prop from `TimelineCanvas`.
- [ ] In timeline view: the foot row shows the primary place + a `+N places` count; on peek a static globe renders **all** the beat's located pins (focus highlighted), framed to their centroid. No rAF loop, no playback controls.
- [ ] In timeline view: placeless nodes show `GEO_SCOPE_LABELS[geoScope]` text; unset nodes show "No place set" + a quiet backfill nudge.
- [ ] In globe view: a slim time-strip renders the cast span with a **marker per referenced node** (focus highlighted) and the beat's period on the right (`formatInstant` / `formatInstantRange`).
- [ ] In globe view: placeless / unset nodes render the strip normally (location state does not affect time display).
- [ ] On the cover and end panel (`activeBeat === -1`), neither preview renders (no beat subject — nothing to locate or mark in time).
- [ ] The `GlobeThumb` stateless component is inside the lazy `GlobeLens` chunk (or a sub-import of it) so it does not inflate the main bundle.
- [ ] No schema migration; no MCP contract change; `typecheck` + `build` green.

## Phase 2 — Portal tap (fast-follow, NOT gated on GS1)

Tapping the mini-globe thumbnail or the time-strip switches lenses, pre-focused on the beat's subject node:
- Tapping the mini-globe from Timeline view → `setLensView('globe')` + the globe eases to center on the subject node's coords (leveraging GS1/GS2's camera primitives if available; else just switching and letting the globe settle).
- Tapping the time-strip from Globe view → `setLensView('timeline')` + the `StoryCamera` centers on the subject node (already how `cameraIds` works in `TimelineCanvas.tsx:549`).

**Why this is Phase 2:** the display-only Phase 1 already delivers the full "full contextual information" goal at zero interactivity cost. The portal tap is a delight layer — evocative, useful — but it adds lens-switching state management complexity and requires GS1 (story-driven globe, currently in globe-stories.md's scope) for a great experience on the globe→timeline direction. Ship Phase 1 alone; the Phase 2 tap is a natural fast-follow once GS1 lands.

**Phase 2 acceptance criteria (not a v1 gate):**

- [ ] Tapping the mini-globe from Timeline view switches to Globe lens, reader remains open, globe eases to the beat subject's coords (or snaps if no ease available yet).
- [ ] Tapping the time-strip from Globe view switches to Timeline lens, reader remains open, canvas centers on the beat's subject node.
- [ ] Lensview switch via the portal does not close the reader.
- [ ] Reduced motion: transitions snap (no animated globe spin) consistent with GS1 reduced-motion rules.

---

## Analytics

Existing events that already inform story health: `story_started`, `story_completed`, `story_prompt_copied`. Globe health: `globe_lens_opened`, `globe_lens_closed`, `globe_playback_started`, `globe_scrubbed`, `globe_marker_clicked`.

**Proposed new events:**

| Event | Properties | Why |
|---|---|---|
| `story_context_preview_shown` | `{ timeline_id, story_id, beat_index, preview_type: 'globe_thumb' \| 'time_strip', location_state: 'located' \| 'placeless' \| 'unset' }` | What fraction of story beats have a locatable subject? How often does the unset degradation path fire? Guides backfill prompt priority and whether unset is common enough to warrant a more prominent nudge. |
| `story_context_preview_clicked` | `{ timeline_id, story_id, beat_index, preview_type, destination_lens: 'globe' \| 'timeline' }` | Phase 2 only: measures portal engagement. How often do readers actually switch lenses mid-story? Validates whether Phase 2 was worth shipping. |
| `story_context_backfill_opened` | `{ timeline_id, node_id }` | When the "no place set" nudge is tapped. Measures whether the in-story backfill entry point is used at all; if it fires at low rates it should be removed to reduce clutter. |

`story_context_preview_shown` is the Phase 1 validation signal. If it fires consistently (most beats in most stories have a subject node) and the `location_state` distribution shows high `located` rate, the feature is working as designed. If `location_state` is mostly `unset` across sessions, that's a coordinate-adoption problem (backfill loop not closing) that belongs in the globe metrics, not a problem with this feature.

**The metric that validates Phase 1:** `story_context_preview_shown` fires on ≥70% of beat views for timelines that have ≥30% coordinate coverage (the same coverage gate as the globe lens). Below that threshold, the feature degrades gracefully (unset state), but the core experience — "mini-globe shows WHERE" — is available to any user who has engaged with the globe lens backfill loop.

---

## Relationship to globe-stories (GS1) and ordering

This PRD is **not** an addendum to globe-stories.md. It is a new, independent PRD for three reasons:

1. **It spans both lenses, not just the globe.** The mini-globe preview delivers value in timeline view independently of whether GS1 has shipped. A user who never opens the globe lens still benefits from seeing WHERE in the story reader.
2. **The implementation does not depend on GS1.** GS1 wires the story reader's beat focus into the globe's camera; this PRD wires a stateless thumbnail preview into the reader's display layer. They share one data source (`focusNode`) but are otherwise orthogonal. Phase 1 ships without GS1.
3. **The story-driven globe (GS1) is already fully specified.** Adding these previews there would swell a targeted spec; a separate PRD keeps both readable and independently shippable.

**Ordering recommendation:**
- Phase 1 of this PRD is parallel-safe with GS1. It requires only GLOBE v1 (shipped) for the lazy chunk reuse.
- Phase 2 (portal tap) should wait for GS1 on the globe side — the globe-to-timeline portal is functional without GS1, but the timeline-to-globe portal is much better when the globe can ease to the beat's coords (GS1's camera primitive). But Phase 2 is **not** *gated* on GS1 — it ships with snap-to-target (the globe opens on the tapped pin via `focusRotation`); GS1 later upgrades that snap to an eased camera (resolved 2026-06-13).
- Both PRDs are independent enough that the same sprint could carry GS4 (era band) + this PRD's Phase 1 in parallel with GS1 + GS2.

**Explicit GS1 cross-reference:** GS1 (`globe-stories.md`) wires `storyFocus` into the globe's rotation/zoom/cursor. This PRD's time-strip (Globe view preview) operates as a **readout** of that same focus data, rendered inside the reader rather than driving the globe. They are complementary: GS1 makes the globe follow the story; this PRD makes the reader surface what the globe is showing.

---

## Lovable gate check

This feature is unambiguously Core UX:

- Single-user, local-first — no cloud, no auth change, no MCP contract change.
- Serves the history/learning enthusiast's core loop (building and reading stories).
- Zero schema migration; zero new dependencies; primarily a viewer wiring change.
- Fits the "most lovable product before any thought of money" mandate: it makes existing stories feel more complete and spatially grounded without adding any complexity the user manages.
- Does not touch any of the deferred categories: no cloud, no billing, no teams, no hosted models, no scheduled jobs.

The feature earns its place by deepening B3 (stories make it a product) and supporting B2 (screenshot moments), at very low engineering cost.

---

## Open questions

| ID | Question | Lean |
|---|---|---|
| OQ1 | Mini-globe size + position in the reader. | **Resolved → peek row.** A slim 40px resting row (globe glyph + label); the 140px globe peeks up as a hover/tap popover that also hosts the portal. See Refinement resolutions. |
| OQ2 | `GlobeThumb` as a sub-module of the existing lazy `GlobeLens` chunk vs. a separate lazy chunk? | Sub-module of the same chunk — avoids a second dynamic import and the lazy boundary is already drawn at the globe lens. If the chunk is not yet loaded (user has not opened the globe), it loads on first beat with coordinates: the ~60–75kB gzip cost is a one-time load accepted only when a located node is encountered. |
| OQ3 | Should the `GlobeThumb` rotate to center automatically on every beat change (a subtle ease, ~500ms), or snap? | Ease — it mirrors the globe-story camera behavior (GS1) and makes the beat transitions feel alive without being distracting. Snap under reduced motion. Wren to weigh in. |
| OQ4 | Is the time-strip (Globe view) redundant with the existing globe scrubber? | Not redundant — the scrubber shows the full timeline's temporal extent and the current play cursor; the strip shows only the story's temporal span with the current beat's specific instant marked. They are different in scale and context. But if Wren finds the strip visually noisy alongside the globe's scrubber, a per-beat date label (single line, no strip) is the fallback. |
| OQ5 | Phase 2 gate: wait for GS1, or ship Phase 2 before GS1 with a simpler snap-to implementation? | Wait for GS1. The snap-to implementation works (just `setLensView` + `setSelectedId`), but the story-to-globe portal is meaningful only when the globe eases to the beat's location (GS1). A jarring snap devalues the portal experience. Phase 2 is a delight feature — ship it right. |

---

## Phased breakdown (pipeline issues)

| # | Title | What it covers | Depends on |
|---|---|---|---|
| SC1 | **Story context previews — Phase 1 (display)** | `lensView` prop on `StoryReader`; `GlobeThumb` stateless component (sub-module of the lazy GlobeLens chunk); time-strip component; degradation for placeless/unset states; in-story backfill nudge via `globeBackfillSpec`; `story_context_preview_shown` + `story_context_backfill_opened` events; **the required GlobeLens inset fix** (`rightInset` = detail+story while reading, `TimelineCanvas.tsx:1201`); the shared **`coordsToRotation`** helper | GLOBE v1 (lazy chunk; shipped) |
| SC2 | **Story context previews — Phase 2 (portal tap)** | Tap handlers on mini-globe + time-strip to switch lens; `story_context_preview_clicked` analytics event | SC1 only — GS1 later upgrades snap→ease |

**Sequencing:** SC1 is the ship. SC2 is a fast-follow once GS1 lands. No dependency between them beyond SC1 must precede SC2.

---

## Done when (Phase 1)

- [ ] Reading a story in Timeline view: beats show the primary place + `+N places`; the peek renders all located pins (focus highlighted); all-placeless references show `GEO_SCOPE_LABELS` copy; all-unset show "No place set" with a subtle backfill nudge.
- [ ] Reading a story in Globe view: all beats show a slim time-strip with a marker per referenced node (focus highlighted) and the beat's period on the right.
- [ ] Cover and end panel: no preview rendered (no beat subject).
- [ ] The `GlobeThumb` is in the lazy globe chunk (not the main bundle); `typecheck` + `build` green.
- [ ] `story_context_preview_shown` fires per beat view with the correct `preview_type` and `location_state`.
- [ ] `story_context_backfill_opened` fires when the "No place set" nudge is tapped.
- [ ] No schema migration; no MCP contract change; verified in a prod-build browser pass with the seeded Stoicism timeline (already coordinated — 107 lat/lng pairs in `scripts/seed.ts`).

---

## Change log

| Date | Who | Change |
|---|---|---|
| 2026-06-13 | Margot | Initial proposed PRD. |
| 2026-06-13 | Refine pass | Resolved OQ1/OQ3/OQ5: bottom context band (140px globe / slim strip), per-beat fade, **SC2 snap-to-target — not GS1-gated**. Folded in Wren's UX pass (required inset fix + shared `coordsToRotation`). Verified seed is coordinated. |
| 2026-06-13 | Redesign | Multi-reference: previews plot the beat's whole referenced set (`{focusNodeId} ∪ relatedNodeIds`) — multi-pin globe + multi-marker strip, focus highlighted; resting row `primary +N places`; strip labels the beat's period on the right. |
