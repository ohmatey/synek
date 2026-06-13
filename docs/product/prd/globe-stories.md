---
phase: GLOBE-S
title: "Globe Story Mode — tell the story on the map, the timeline skips along"
status: "GS1–GS4 shipped (2026-06-13)"
era: "Story Layer (the pivot)"
updated: 2026-06-12
roadmap: NEXT (after GLOBE v1 + S3; parallel-safe with S3)
owner: Margot (product) · Kael (canvas architecture) · Wren (UX)
links: [globe-lens.md, s3-multi-pov.md, ../roadmap.md, product-strategy.md]
pending-sync: false
---

# GLOBE-S — Globe Story Mode (tell the story on the map)

> **Press play on a story and watch it happen on the globe.** Today the globe lens
> plays *time* — markers light up as the cursor sweeps. The docked story reader plays
> *narrative* — beats step, and the timeline canvas pans to each beat's focus node.
> They run side by side but blind to each other. Globe Story Mode marries them: open a
> story while the globe is up and each beat **rotates and zooms the globe to where it
> happened** and **skips the time cursor to when** — the scrubber jumps beat-to-beat
> instead of crawling linearly. The story becomes a guided flight across the map.

## TLDR

- **Two of the founder's five asks are already shipped — do not rebuild them.**
  Mouse-drag rotation exists (`onGlobePointerDown`, GlobeLens.tsx:232). Click-a-marker
  → the same `NodeDetailPanel` exists (`onMarkerClick` → `setSelectedId`,
  GlobeLens.tsx:296 / TimelineCanvas.tsx:1159). This PRD notes them as done and scopes
  only refinements where they earn it.
- **The headline (GS1):** wire the story reader's per-beat focus into the globe. The
  reader already renders over the globe (TimelineCanvas.tsx:1207) — but its
  `activeBeat`/`beatFocusId` only drive the React-Flow `StoryCamera` (TimelineCanvas.tsx:1114),
  never the globe, which runs its own independent playback clock. GS1 passes the active
  beat into `GlobeLens` so each beat eases rotation + zoom to the focus node's `lat`/`lng`
  and sets `cursorInstant` to its instant. "The timeline skips along" = the scrubber thumb
  jumps to each beat.
- **GS2 — zoom.** `GlobeLens` has no `projection.scale()` state today (fixed at `*0.92`).
  Add a clamped zoom (wheel + pinch + ⌘K/buttons), which GS1's per-beat "zoom to" reuses.
- **GS3 — floating entity cards.** Today only the *selected* marker shows a bare `<text>`
  label (GlobeLens.tsx:368). Add a compact card (type glyph + title) above markers —
  decluttered (zoom-gated / hover / active-only), never "every marker always labeled."
- **GS4 — era band.** Show `period`-type span nodes as a labeled ribbon above the scrubber
  (positioned via the same `makeTimeScale` x-space the canvas uses), plus an optional era
  tint on the globe. This is the "show eras on/above the timeline" ask.
- **The inversion holds.** No new AI, no geocoding. Stories still come from the user's
  Claude via `write_story`; coordinates still come via `apply_patch`. GS is pure
  client-side viewer wiring over data that already exists.

---

## What already ships (verified in code, 2026-06-12)

| Founder ask | Status | Where |
|---|---|---|
| "switch the movement of the globe with mouse" | **SHIPPED** | `onGlobePointerDown` drag-rotates `λ`/`φ` with `DRAG_SENSITIVITY`, clamps pitch to ±90°, sets `userRotatedRef` to suspend auto-center (GlobeLens.tsx:232–246). |
| "clicking an event opens the same entity dialog" | **SHIPPED** | Markers are `<g onClick={handleMarker}>` → `onMarkerClick(id)` → `setSelectedId` → the existing `NodeDetailPanel` docks (GlobeLens.tsx:352–360, TimelineCanvas.tsx:1159,1171). |

The remaining three asks (stories-on-the-globe, zoom, floating cards, era band) are net-new
and are the body of this spec. Refinements to the two shipped items are folded into GS2
(drag + zoom share one gesture surface) where cheap; otherwise they stay as-is.

---

## Problem and opportunity

### Who this is for

The history/learning enthusiast (primary persona, `product-strategy.md`). They asked Claude
to build a timeline, watched it appear, and read a story on a moment. GLOBE v1 gave them a
map that plays *time*. S3 gave them stories with *cast* and *per-beat focus*. But the two
richest playback surfaces in the product — the globe and the story reader — don't know about
each other. A story about Zeno's journey from Cyprus to Athens plays in the docked reader
while, if the globe is open behind it, the globe either sits still or plays its own unrelated
clock. The most cinematic thing the product could do — *narrate a journey across the map* — is
one wire away and not connected.

### Against the strategy

- **B2 ("watch it build is the wow"):** GLOBE v1 was B2 on a second axis (space). Globe Story
  Mode is B2 on the *intersection* — a narrated camera move across the map is the single most
  shareable "screenshot moment" the product can produce. It's the trailer for the whole app.
- **B3 ("stories make it a product"):** a story you *read* is good; a story that *flies you to
  each place as it's told* is a different category of object. This deepens exactly the gap S3
  opened between Synek and "just ask Claude in a chat window."
- **B5 ("verbs drive expansion"):** the era band and floating cards make *where/when gaps*
  legible on the globe surface, inviting the same backfill move GLOBE v1's coverage banner
  established.

**Scope guardrail check:** single-user, local-first Core UX. No cloud, no model, no geocoding,
no new heavy dependency (zoom and cards are SVG transforms over the existing d3-geo lens). The
era ribbon reuses `makeTimeScale`. Clean against the guardrail.

---

## GS1 — Story-driven globe (the headline)

> **Shipped 2026-06-13.** `GlobeLens` takes optional `storyMode`/`storyFocus` props
> derived in `TimelineCanvas`; a per-beat rAF eases rotation + a programmatic zoom
> (`STORY_ZOOM`) to the focus node's coords and skips the cursor to its instant, while
> the reader owns the transport (the globe's own Play/speed hide via `data-story`).
> **Refinement over the prop sketch below:** `storyFocus` carries `instant` even when
> `lat`/`lng` are null, so an off-map beat still skips the cursor while *holding* the
> camera (OQ-S1). All six seed timelines now carry a cross-globe story to exercise it.
> Verified via `bun run verify:seed-demo` + globe e2e (story-on-globe + reduced-motion).
> Only the programmatic-zoom slice GS1 needs shipped — interactive zoom (GS2), floating
> cards (GS3), and the era band (GS4) remain proposed.

### Experience

You're on a Stoicism timeline with coordinates. You open the globe (Timeline | Globe). You
open the "Zeno's road to the Stoa" story — the docked reader appears over the globe, on its
cover. You press **Play**.

- Beat 1 ("Born in Citium, Cyprus"): the globe eases its rotation to Cyprus and zooms in a
  notch; the scrubber thumb **jumps** to 334 BCE; Zeno's marker is haloed; the detail panel
  beside the reader shows Zeno.
- Beat 2 ("Shipwrecked at Athens"): the globe rotates west to Athens, the cursor skips to ~312
  BCE, Athens markers appear, Zeno's marker stays (it happened).
- Beat 3 ("The Painted Porch"): a small zoom-in on Athens; the Stoa marker haloes.

When the story ends (the reader's end panel), the globe eases back out to frame the whole cast
(the story's focus set) and the cursor rests at the last beat. Closing the reader returns the
globe to free exploration (its own play/scrub still works).

This is **the story driving the globe**, the mirror of what already happens on the timeline
canvas (`StoryCamera` follows beats). "The timeline skips along" is literal: the scrubber is a
timeline, and it hops to each beat's instant rather than sweeping.

### The seam (why this is small)

Everything needed already exists and is already lifted to `TimelineCanvas`:

- `activeBeat` (the beat index the reader reports up via `onBeatChange`, TimelineCanvas.tsx:221,1222).
- `beatFocusId` — the node a beat spotlights (`focusNodeId ?? relatedNodeIds[0]`, guarded;
  TimelineCanvas.tsx:496–499). Today it feeds `displayNode` (the panel) and `cameraIds` (the
  React-Flow camera).
- `readingStory` / `reading` — whether a story is playing.

Today `cameraIds` is consumed **only inside the `lensView === 'timeline'` branch** by
`<StoryCamera>` (TimelineCanvas.tsx:1114). When `lensView === 'globe'`, the globe is rendered
in the `else` branch (TimelineCanvas.tsx:1150–1169) and receives none of this — it owns an
independent `cursorInstant`/`rotation`/`playing` clock (GlobeLens.tsx:107–110).

**GS1 is: pass the active beat focus into `GlobeLens` and let it drive the globe's existing
camera + cursor primitives in a "story-driven" mode.**

### Technical design (Kael to confirm)

**New `GlobeLens` props (additive, all optional → free for non-story use):**

```ts
// The node the current story beat is about (its lat/lng + instant drive the
// globe), or null when no story is playing / the reader is on the cover/end panel.
storyFocus?: { id: string; lat: number; lng: number; instant: number } | null
// True while a story reader is open over the globe — suppresses the globe's own
// autoplay-on-press and hands the clock to the story (the reader is the transport).
storyMode?: boolean
```

`TimelineCanvas` already has `focusNode` (the resolved beat-focus `GraphNode`,
TimelineCanvas.tsx:500) and `reading`. Derive `storyFocus` from `focusNode` when it carries
coordinates (fall back to the moment node, then to null), and pass `storyMode={reading}`.

**Inside `GlobeLens`, a `storyFocus` change (effect keyed on `storyFocus?.id`):**
1. Set the target rotation to `[storyFocus.lng, storyFocus.lat]` and let the **existing
   rotation-ease lerp** (already in the rAF loop, GlobeLens.tsx:170–177) carry the globe there
   — but run the ease even when not "playing" (today the ease only runs inside the play loop).
   Factor the ease into a small always-available `useEffect` rAF that runs whenever there's a
   pending rotation/zoom target, so a beat step animates the camera with the reader paused.
2. Set the **zoom target** (GS2) to a closer scale (a "story zoom" constant, e.g. 1.8×) so each
   beat frames its place; ease it the same way. On story end, ease back to fit-all.
3. **Skip the cursor:** `setCursorInstant(storyFocus.instant)` and `xRef.current =
   scale.toX(storyFocus.instant)`. This is the "scrubber skips along" — the thumb is bound to
   `scale.toX(cursorInstant)` (GlobeLens.tsx:321–323), so setting the instant moves it. Markers
   appear/halo off `cursorInstant` already (GlobeLens.tsx:277–289), so the right things light up
   for free.
4. Suppress the globe's own `togglePlay` autoplay while `storyMode` (the reader's Play is the
   transport). The play/pause button on the scrubber can hide or become a "follow story" no-op
   while a story is open; the scrubber stays as a **progress readout** (and manual scrub still
   works — scrubbing while a story plays just detaches, same spirit as `userRotated`).

**State that must survive a beat step / `nodes` prop change:** `storyFocus` drives targets via
refs, not by resetting `cursorInstant` ownership — the rAF ease writes `cursorInstant`. Keep the
"don't reset playback state on data change" rule from GLOBE v1 §6.

**Reduced motion:** under `prefers-reduced-motion`, snap rotation/zoom/cursor to the beat target
instead of easing (no animated globe spin) — consistent with the reader's reduced-motion mode
and the global reset.

**What GS1 does NOT need:** no new query (the globe consumes the same `gnodes` prop), no schema
change, no MCP change, no new analytics table. Two new optional props + a small ease refactor.

**Open question OQ-S1:** when a beat's focus node has **no coordinates**, what should the globe
do? Lean: hold the current rotation/zoom (don't fly to null), keep the cursor skip (time still
advances), and surface nothing jarring. A story that wanders off-map degrades to a time-only
skip for those beats. (Alternative: ease toward the centroid of the story's located cast — more
complex; defer.)

---

## GS2 — Zoom the globe

> **Shipped 2026-06-13.** `GlobeLens` gained a clamped `zoom` (`[1, 6]`, 1 = whole
> sphere): a non-passive `wheel` listener (trackpad pinch via `ctrlKey`, coarser),
> a left-center `+`/`−`/reset control group, and ⌘K "Globe: zoom in/out/reset" wired
> through an imperative `controlsRef` handle the lazy lens registers into. The GS1
> per-beat ease was generalized into **one shared camera ease** (`easeCameraTo` →
> nonce-driven rAF) that all programmatic moves (story beats, +/− , ⌘K) funnel
> through; raw wheel/drag bypass it (immediate, and cancel a running ease). A manual
> zoom flags `userRotatedRef` so an in-flight story-follow won't yank the camera —
> it re-arms on the next beat (the cursor-skip effect clears the flag). Reduced-motion
> snaps. **Recenter affordance** = the reset-zoom control + story-follow re-arming on
> the next beat (no separate rotation-recenter button; free-play rotation re-arms on
> Play). **OQ-S2 resolved:** v1 zooms to **center** (pointer-anchored deferred).
> Verified: typecheck + build + `verify:globe` + globe e2e (a zoom clamp/enable test
> added; GS1 story tests unregressed). Live in-browser confirm owed via local-62.

### Experience

Scroll-wheel / trackpad-pinch over the globe zooms toward the pointer; a small +/− control
(bottom-left of the globe, mirroring React Flow's `Controls`) and ⌘K "Zoom in/out/reset" back
it for keyboard and discoverability. Zoom is clamped (you can't zoom past the sphere filling
the pane, nor out past a sensible minimum). Double-click a marker (optional) zooms to it. GS1's
per-beat "zoom to the place" is the same mechanism driven by the story instead of the pointer.

### Technical design

- Add `zoom` state (a scale multiplier, default 1) to `GlobeLens`. The projection scale becomes
  `(Math.min(viewW, size.h) / 2) * 0.92 * zoom` (GlobeLens.tsx:255). Clamp `zoom ∈ [1, ~6]`
  (1 = whole sphere fits; upper bound a UX call — orthographic stays legible far in).
- **Wheel:** `onWheel` on the SVG, `preventDefault`, `zoom *= exp(-deltaY * k)`, clamp. Zoom
  toward the pointer by nudging rotation a touch toward the un-projected point under the cursor
  (nice-to-have; v1 can zoom toward center for simplicity — Wren to call).
- **Pinch:** trackpad pinch arrives as `wheel` with `ctrlKey` on most browsers — same handler,
  larger `k`. (Touch `gesturestart`/`touchmove` two-finger is out of scope — desktop-targeted
  per the guardrail.)
- **Buttons + ⌘K:** a `globe-zoom` control group; ⌘K NAV actions "Globe: zoom in/out/reset."
- **Ease target:** zoom animates via the same rAF ease as rotation (GS1 shares it) so button
  presses and story zooms glide, while raw wheel can be immediate.
- **Interaction with drag:** drag rotation already sets `userRotatedRef`; a manual zoom should
  set the same "user took over" flag so an in-progress story-follow doesn't yank the camera back
  mid-gesture. Resume story-follow on the next beat (or a "recenter" affordance).

**Analytics:** `globe_zoomed { timeline_id, via: 'wheel'|'button'|'story' }` (optional; low
priority — fold into existing capture seam).

---

## GS3 — Floating entity cards above markers

> **Shipped 2026-06-13.** The lone selected-marker `<text>` is replaced by a
> `<foreignObject>` card layer (type glyph from the canvas/⌘K icon language + title,
> theme-accented, `pointer-events:none` so it never blocks a marker click). Declutter:
> always-on for selected/story-focus/active and the hovered marker; the rest are
> revealed by a greedy screen-space de-overlap (`LABEL_GAP_X/Y`) over markers sorted
> larger/earlier-first. **Zoom-gating falls out for free** — markers reproject as the
> GS2 zoom grows, so a fixed gap admits more cards the further you zoom in. Back-face
> and not-yet-appeared markers are already excluded (they're not in `markers`). The
> PRIMARY card's title keeps the legacy `globe-marker-label` hook so it stays singular
> for tests. **OQ-S3 resolved:** de-overlap is the cap (no hard count). Verified:
> typecheck + build + globe e2e (a cards/axis test added). Live confirm owed via local-62.

### Experience

Each plotted marker can show a small floating label above it — a type glyph (person / org /
place / event / period, matching the canvas node language) + the node's title, on a compact
chip with the timeline-theme accent. The point is the founder's: *"show what they are"* at a
glance without clicking.

The hard part is **clutter** — a 60-node globe with 60 always-on cards is noise and overlaps
into mush. The design is decluttered by default:

- **Always-on:** the selected marker, the active-span markers, and the current story-beat focus
  (GS1) — these are few and meaningful.
- **Hover/focus:** hovering any marker shows its full card (and keyboard-focusing it, for a11y).
- **Zoom-gated reveal:** as you zoom in (GS2), more cards appear (when fewer markers share the
  visible hemisphere, labels are affordable). A simple rule: show a label when the marker has no
  other shown label within N px (greedy de-overlap, cheap at hundreds of nodes), with priority
  selected > active > story-focus > larger `size` > earlier.
- **Back-hemisphere markers** are already culled (GlobeLens.tsx:278); their cards never render.

### Technical design

- Replace the single `selected && <text>` label (GlobeLens.tsx:368–372) with a `<GlobeLabels>`
  layer: compute the visible, eligible marker set (already computed in `markers`,
  GlobeLens.tsx:268–294 — extend the entry with `labelPriority`), run a greedy de-overlap in
  screen space, render the survivors as small `<foreignObject>` chips or SVG `<g>` label groups
  positioned at the marker's `[x,y]` with a leader offset.
  - `<foreignObject>` lets the card be real DOM (CSS theming, the type glyph as an icon, text
    ellipsis) — but has Safari quirks; an SVG `<text>` + `<rect>` chip is the safe fallback.
    Wren/Kael to pick; lean `foreignObject` for parity with the canvas card design, with a plain
    SVG fallback if rendering misbehaves.
- The type glyph reuses the icon mapping the canvas nodes already use (person/org/place/work/
  event/period) — pull from the same source the node cards use so the language matches.
- Hover state is local (`hoveredId`); pointer-enter/leave on the marker `<g>`.
- Keep it on the **markers** layer so it inherits the back-face cull and the appear-over-time
  gate (a not-yet-appeared node has no card).

**Density guard / analytics:** none needed; this is presentation. Verify with a dense seed that
the de-overlap keeps the globe readable.

**OQ-S3:** always-on cards for *every appeared* marker at high zoom, or cap the count even when
they'd fit? Lean: cap by de-overlap only (if they fit without overlapping, show them) — the
zoom-gate makes "fit" the natural throttle.

---

## GS4 — Era / period band

> **Shipped 2026-06-13 — expanded per the founder ("make the play row a timeline
> showing dates, like the slider").** The scrubber's flexible middle became a small
> **dated timeline** (`.globe-timeline` column): (1) an **era ribbon** of `type==='period'`
> spans, greedy-packed into ≤2 rows, `--color-accent-era`-tinted, active-era highlighted
> as the cursor/story moves; (2) the scrub **track now carries year ticks**; (3) a
> **year-label axis** sits below it. Ticks/labels use TimeRuler's "nice step" algorithm
> but positioned in the scrubber's percentage space (`scale.toX(year)/maxX`), so gap
> collapse is honored exactly like the thumb — BCE-aware. The exact-cursor `globe-date`
> readout stays (ticks give context, the label gives the precise instant). **OQ-S4
> resolved:** era = `period` spans. The optional globe corner-chip was skipped (the
> active-segment highlight conveys the current era). Verified: typecheck + build +
> globe e2e (dated-axis + era-ribbon tests added). Live confirm owed via local-62.

### Experience

The founder: *"show era time periods from the timeline on the globe or above the scrolling
timeline."* The clearest home is **a labeled ribbon above the globe's scrubber** — a horizontal
band, segmented and tinted by the timeline's `period`-type span nodes (eras), each segment
labeled ("Hellenistic", "Roman Imperial"), positioned in the same x-space as the scrubber so an
era visually spans the years it covers. As the cursor (or story) moves, the **current era**
highlights. Overlapping eras stack in up to ~2 rows.

Secondary (optional, lighter): an **era tint on the globe** — the active era's accent subtly
washes the sphere or shows as a label corner-chip ("Now: Hellenistic period, 323–31 BCE"),
reusing the `--color-accent-era` token (the era token decoupled from influence purple, per the
node design-language memory).

### Technical design

- **Source:** filter `gnodes` to span nodes that read as eras — `type === 'period'` (and/or a
  subtype/`isEra` heuristic; Kael to pin which nodes count as "era"). Each has `startInstant` +
  `endInstant`.
- **Layout:** the scrubber already lives in x-space via `scale` (GlobeLens.tsx:386–396). Each era
  segment is `left = scale.toX(start)/maxX`, `width = (scale.toX(end)-scale.toX(start))/maxX` —
  identical math to the existing `collapsedRanges` hatch marks (GlobeLens.tsx:387–393), so gap
  collapse is honored for free. Greedy row-assignment for overlaps (≤2 rows; more → "+n").
- **Active era:** highlight segments where `start ≤ cursorInstant ≤ end`. Drives the optional
  globe corner-chip.
- **Color:** each era segment tints with `--color-accent-era` (or a per-era accent if the theme
  carries one). Labels truncate; full name on hover/title.
- **Reuse on the timeline canvas too?** The same era band could later sit above the React-Flow
  `TimeRuler` (TimelineCanvas.tsx:1117) — but that's a separate surface; GS4 v1 scopes the band
  to the **globe scrubber** only (where the ask is most acute — the globe has no lanes to show
  periods as spans the way the canvas does). Canvas era band = a fast-follow if it lands well.

**OQ-S4:** what exactly counts as an "era"? Lean: `type === 'period'` spans. If timelines use
`entity` spans as eras too, widen the filter — but start narrow (`period`) to avoid a noisy band.

---

## In scope (v1)

1. **GS1** — story-driven globe: `storyFocus`/`storyMode` props; per-beat ease of rotation +
   zoom to the focus node's coordinates; cursor skip to the beat's instant (scrubber jumps);
   reader's Play is the transport while a story is open; reduced-motion snaps; off-map beats hold
   camera + still skip time.
2. **GS2** — clamped globe zoom: wheel + trackpad-pinch + +/− control + ⌘K actions; shared rAF
   ease; manual zoom sets the "user took over" flag.
3. **GS3** — floating entity cards above markers: type glyph + title; decluttered (selected /
   active / story-focus / hover always; zoom-gated greedy de-overlap for the rest); back-face and
   not-yet-appeared markers excluded.
4. **GS4** — era band above the globe scrubber: `period` spans laid out in scrubber x-space,
   labeled + tinted, active-era highlight; optional globe corner-chip naming the current era.
5. Refinements folded in where cheap: drag rotation gains a grab/grabbing cursor affordance;
   manual zoom + drag both set the story-follow-suspend flag with a "recenter" affordance.

## Out of scope (v1, deferred)

- **Rebuilding** mouse rotation or click-to-panel — already shipped.
- Great-circle **arc trails** between consecutive story beats on the globe (a "flight path"
  line) — evocative but extra geometry; defer until GS1 proves out.
- **Zoom-toward-pointer** precision (v1 may zoom toward center) — refine later if it feels off.
- **Touch / mobile** pinch-zoom and the mobile layout — desktop-targeted per the guardrail.
- **Era band on the timeline canvas** (above `TimeRuler`) — fast-follow, not v1.
- **Per-era custom accents** from the theme — v1 uses the single `--color-accent-era` token.
- **Auto-narration of the globe without a story** (a "tour" that writes its own beats) — that's
  generation; the inversion forbids it. Stories come from `write_story`.

---

## Phased breakdown (pipeline issues)

Each maps to one Sal issue. Horizon `next`. Depends on GLOBE v1 (shipped) and reuses S3's reader.

| # | Title | What it covers | Depends on |
|---|---|---|---|
| GS2 | **Globe zoom (wheel + pinch + controls + ⌘K) with shared rAF ease** | `zoom` state into the projection scale; clamped wheel/ctrl-wheel handler; +/− control + ⌘K NAV actions; factor the rotation ease into an always-available rAF ease that also drives zoom; manual-zoom sets the user-took-over flag | GLOBE v1 |
| GS1 | **Story-driven globe: beats rotate + zoom + skip the cursor** | `storyFocus`/`storyMode` props on `GlobeLens`; derive from `focusNode`/`reading` in `TimelineCanvas`; per-beat ease to coords + story-zoom; `cursorInstant`/`xRef` skip so the scrubber jumps; suppress globe autoplay in story mode; reduced-motion snap; off-map-beat behavior (OQ-S1) | GS2 (shares the ease + zoom) |
| GS3 | **Floating entity cards above markers (decluttered)** | `<GlobeLabels>` layer replacing the lone selected label; type glyph + title chip; always-on for selected/active/story-focus; hover/focus reveal; zoom-gated greedy screen-space de-overlap; reuse canvas type-icon mapping | GS2 (zoom-gate), GS1 (story-focus priority) |
| GS4 | **Era band above the globe scrubber** | Filter `period` spans; lay out in scrubber x-space (reuse `collapsedRanges` math); labeled + `--color-accent-era`-tinted segments, ≤2 rows; active-era highlight; optional globe corner-chip | GLOBE v1 |

**Sequencing:** **GS2 → GS1 → GS3**, with **GS4 parallel** to all three (it only touches the
scrubber + an era filter, no overlap with the camera work). GS2 ships the zoom primitive and the
shared ease that GS1 leans on; GS1 wires the story; GS3 layers the cards (and wants GS1's
story-focus + GS2's zoom-gate for its priority rules). Realistic shape: a single focused sprint.

---

## Done when (v1)

- [x] With the globe open and a story playing, each beat eases the globe's rotation + zoom to the
      beat's focus-node coordinates and the scrubber thumb **jumps** to that beat's instant; on
      story end the globe eases back to frame the cast. Verified in a live prod-build pass on a
      coordinated, storied timeline (e.g. seeded Stoicism + a `write_story`).
- [x] A beat whose focus node has no coordinates holds the camera and still advances the cursor
      (no jump to null-island, no jarring snap).
- [x] Reduced-motion: beat transitions snap (no animated spin/zoom); the cursor still tracks.
- [x] Wheel/trackpad-pinch zooms the globe (clamped); +/− control and ⌘K zoom in/out/reset work;
      manual zoom or drag suspends story-follow (recenter = reset-zoom control + re-arm on the next
      beat); story-follow resumes on the next beat. (Shipped 2026-06-13.)
- [x] Markers show floating type+title cards: always for selected/active/story-focus, on hover for
      any, and zoom-gated (via de-overlap as the GS2 zoom spreads markers) for the rest. Back-face
      and not-yet-appeared markers show no card. (Shipped 2026-06-13.)
- [x] An era band sits above the scrubber: `period` spans laid out in the same x-space (gap
      collapse honored), labeled + tinted, the current era highlighted as the cursor/story moves.
      Plus the founder's extra: the track now carries year ticks + a year-label axis (the play row
      reads as a dated timeline, not a bare slider). (Shipped 2026-06-13.)
- [x] No schema migration; no MCP contract change; `typecheck` + `build` green; existing
      `verify:globe` + globe e2e still pass; the two already-shipped behaviors (drag-rotate,
      click→panel) are unregressed.

---

## Open questions summary

| ID | Question | Lean |
|---|---|---|
| OQ-S1 | Beat focus node has no coordinates — what does the globe do? | Hold camera, still skip the cursor; don't fly to null. (Centroid-of-cast fallback deferred.) |
| OQ-S2 | Zoom-toward-pointer or zoom-to-center for v1 wheel? | Center for v1 simplicity; pointer-anchored as a refinement (Wren). |
| OQ-S3 | High-zoom cards: show every appeared marker that fits, or cap? | De-overlap only — "fits without overlap" is the natural cap. |
| OQ-S4 | What counts as an "era" for the band? | `type === 'period'` spans; widen only if timelines use `entity` spans as eras. |
| OQ-S5 | While a story plays, keep the globe's own play/pause button or hide it? | Hide/disable it (the reader is the transport); keep manual scrub as a detach gesture. |
