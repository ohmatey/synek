---
phase: GLOBE
title: "Globe lens — watch history happen on the map"
status: "proposed (2026-06-12)"
era: "Story Layer (the pivot)"
updated: 2026-06-12
roadmap: NEXT (after NEXT.5 Tier 1; parallel-safe with S2)
owner: Margot (product) · Kael (canvas architecture) · Wren (UX)
links: [next5-verb-system.md, next5-tier2-alive-canvas.md, ../roadmap.md, product-strategy.md]
pending-sync: false
---

# GLOBE — Globe lens (watch history happen on the map)

> **The map animates.** Open the globe lens and press play: a spinning orthographic projection — styled to your timeline's theme — lights up as time sweeps forward. Nodes appear at their coordinates when their moment arrives. Spans (periods, entities) hold their glow while they're active. Watch the Stoics spread across the ancient world. Watch the Space Race leap between continents. The timeline you built becomes a film you watch.

## TLDR

- **The problem:** the canvas's `location` field is display-only text today — geographic meaning is stored but never rendered. A history enthusiast can't *see* where things happened, only read it.
- **The hero moment:** press play on the globe, watch nodes light up at their coordinates in chronological order, spans glowing while active. It's the "watch it build" magic of B2, this time in space rather than just time.
- **The data contract:** add optional `lat`/`lng` to node metadata; the MCP client (Claude) supplies coordinates when writing nodes — same inversion as images. `get_layout_report` flags uncoordinated nodes so the client can backfill in one `apply_patch`.
- **The renderer:** d3-geo orthographic projection, canvas/SVG, ~30kB — no WebGL, no three.js, no new heavy dependencies. Styled to the per-timeline theme accents already living on `.canvas-root`.
- **v1 is read-only.** Markers, spans, click-to-open the existing `NodeDetailPanel`. No editing from the globe surface.
- **Always-visible switcher; coverage gates the payoff.** The Timeline | Globe switcher is always shown. With coordinates, clicking Globe opens the lens (a banner explains the gap below threshold); with none, it opens the backfill setup dialog instead of an empty globe.

---

## Problem and opportunity

### Who this is for

**The primary persona: the history/learning enthusiast.** Their loop is: ask Claude → watch the canvas build → wander it → read stories → come back and deepen it (product-strategy.md → Personas). They research topics for the love of it — Stoicism, the Space Race, a war, a movement. The canvas gives them *when* beautifully; it gives them *where* only as a text label in the detail panel.

A person building a Stoicism timeline can see that Zeno was born in Cyprus and taught in Athens. That geographic arc — Hellenistic philosophy radiating from Athens, absorbing influence from Phoenicia and Egypt — is invisible on the timeline canvas. It's data; it isn't geography.

**The secondary beneficiary:** the globe lens will accelerate `location` adoption across all timelines, strengthening B4 (artifact grounding's moat) and the overall richness of the corpus. Coordinates are metadata worth having for many reasons beyond the lens.

### The opportunity against the strategy

Bet **B2** ("watch it build is the wow") established that the live side-by-side demo creates instant want. The globe lens is B2 applied to a *second axis*: not just time but space. It makes the canvas do emotional work the existing horizontal strip cannot — a rotating globe with lit nodes is immediately more evocative than boxes on a line, and it's a shareable "screenshot moment" the timeline canvas rarely produces.

Bet **B3** ("stories make it a product") argues narrative is why people return. The globe lens is a *different kind of story* — a cinematic play-through of where things happened. It doesn't replace written stories; it precedes them, drawing the eye toward nodes before the reader taps in.

Bet **B5** ("the verb system drives expansion") establishes the principle: every surface should offer the obvious next move. The globe will surface the "`location` without coordinates" gap and invite Claude to fill it — a structural gap invitation in the same spirit as dead-zone cards (VERBS-T2).

**Scope guardrail check:** this is single-user, local-first Core UX. No cloud API, no geocoding service, no keys, no multi-tenant concern. The coordinates come from the user's MCP client — the same inversion as images. Hosting-aware: the same globe component works unchanged behind a hosted canvas.

---

## The experience narrative

You've built a Stoicism timeline. Twenty-three nodes. Portraits, eras, edges. A segmented switcher sits top-center in the bar: **Timeline | Globe**. You click Globe (or press ⌘K and type "globe") and the lens replaces the canvas pane — same bar, same dock, new view.

The globe shows the ancient Mediterranean. Faint sphere geometry, a canvas wash derived from the timeline's `theme.colors`. Seven nodes have coordinates. Sixteen show a faint "not yet located" label in a coverage banner at the bottom.

You press play.

The time cursor sweeps left to right. Cyprus lights up — Zeno, 334 BCE. Athens, two years later, as the Stoa Poikilē gets its marker. The scrubber shows BCE dates counting toward zero. Chrysippus arrives in Soli, then Athens. The Roman Stoics — Seneca in Córdoba, Epictetus in Hierapolis, Marcus Aurelius in Rome — pop into their seats in the first and second century CE. Period spans glow and hold: the Hellenistic era as a warm field, the Roman Imperial period as its successor.

You pause at 150 CE. The globe holds its position. You click Marcus Aurelius's marker. The `NodeDetailPanel` opens in its usual dock — the same panel as the timeline canvas, the same edit, story, and verb affordances. The globe is the lens; the panel is the reader; the verb system is the action layer. Nothing is new except the view.

You press play again. The ghost — a dim "≈21 unlocated nodes" banner — remains until Claude fills them in. You copy the backfill prompt. In one `apply_patch`, sixteen nodes gain coordinates. The globe fills in live (SSE stream delivers the patch; the globe re-derives coordinates and re-renders).

---

## Data contract — coordinates on nodes (Scope Item 1)

The `location` field on `NodeMetadata` is currently a **plain display string** (`"Golgotha, Jerusalem"`, per schema.ts:50–51 and domain/types.ts:99–101). The schema comment explicitly anticipates a map lens interpreting it later. That time is now.

**The addition:** two optional numeric fields alongside `location`:

```
NodeMetadata.lat?: number   // decimal degrees, negative = South
NodeMetadata.lng?: number   // decimal degrees, negative = West
```

The display string `location` is unchanged — still display-only, still shown in the detail panel's dateline. `lat`/`lng` are **additive** metadata the globe reads; every existing node that omits them continues to work exactly as before.

**Who supplies coordinates:** the MCP client (Claude). Same inversion as images. The user's Claude calls `apply_patch` with `update_node` ops setting `lat`/`lng`; Synek stores and renders them. No geocoding API, no new key, no network call from the app. When Claude writes a node with a `location`, it can also supply `lat`/`lng` in the same patch.

**Validation:** `lat` must be in `[-90, 90]`; `lng` in `[-180, 180]`. The MCP server validates and returns an error on out-of-range values. `apply_patch` `warnings` will include coordinate outliers (values that land in ocean or implausible given the `location` string, if Claude can catch them — noted as a best-effort warning, not a hard block).

**No migration required.** `NodeMetadata` is stored as a JSON column; new keys are backward-compatible. No Drizzle migration for the coordinates themselves (they live inside the existing `metadata` JSON). A schema comment update is the only schema-layer change.

**MCP contract:** `add_node` and `update_node` ops in `apply_patch` accept `lat`/`lng` as optional top-level fields (alongside `location`, `lane`, `images`, `citations`). Kael to pin the exact ops shape in the Technical design section.

### Follow-on (shipped 2026-06-12): placeless semantics — `geoScope`

The two-state contract (located / not-located) hid a third truth: some nodes **cannot** be pinned. With only two states, a deliberate skip is indistinguishable from "not yet backfilled" — the next agent reading the coverage report re-attempts the same unpinnable nodes (and is nudged toward guessing), and the globe silently drops story-bearing nodes (a worldwide era, a movement with no single site).

**The addition:** `NodeMetadata.geoScope?: 'global' | 'diffuse' | 'unknown'` — additive JSON key, no migration, **mutually exclusive with `lat`/`lng`** (setting one clears the other; an op carrying both keeps the coords and warns). `global` = happened everywhere; `diffuse` = several real sites, no honest single anchor; `unknown` = the place is lost to history.

- **Convergence:** the layout report's `coordinates` section and `globe-coverage.ts` count three buckets (located / placeless / unset); coverage is computed over *placeable* nodes, and only unset nodes are backfill targets — a backfill pass converges to 100% instead of re-litigating forever.
- **Narration:** placeless nodes get a caption channel on the globe (title + `location` string or the scope's standard label) while "active" during playback; the detail panel's dateline explains the absence ("Worldwide — no single place" / "Location unknown") instead of rendering nothing.
- **Authoring:** the backfill prompt asks for a **verdict** per node — pin it or mark it, never guess; the MCP server instructions and `apply_patch` op hints carry the same rule.

---

## Coverage gate and empty/sparse states (Scope Item 2)

A globe with three dots is sad. More importantly, it misrepresents the timeline — it looks like a map of *where things happened* when it's really a map of *which nodes the user got coordinates for.*

**The gate:**

- **Sufficient coverage (show the lens):** ≥ N nodes have coordinates AND those nodes represent ≥ M% of the timeline's nodes. Proposed values: N = 5, M = 30%. Kael/Wren to adjust at implementation. The threshold should ensure a first-time globe view is rewarding, not embarrassing.
- **Below threshold (degraded entry):** the globe lens entry point (⌘K verb, top-center view switcher) is **visible but prominently explains the gap**: "5 of your 23 nodes have map coordinates. Add more to get a fuller picture." A "How to add coordinates" tooltip copies the backfill prompt. The globe still opens — you can still play the 5 coordinated nodes — but the low-coverage state is honest and actionable.
- **Zero coordinates:** the view switcher is **still rendered** (always-visible — the Globe segment is a permanent fixture of the app bar, so the lens is discoverable from the first timeline). The Globe segment's tooltip reads "No map coordinates yet — set up the globe view." Clicking it **switches into the globe**, which shows a **cinematic empty state** — the globe rises from the bottom edge like a planet over a horizon and slowly turns, with a short explanation and a primary **"Create a globe"** action floating above it that opens the backfill `PromptDialog` (the same "Set up the globe view" prompt as ⌘K), nudging the user to ask their MCP client to add coordinates. When the first coordinate lands, the globe **glides up to its centered position** (the markers appear as it settles). _(Design changed 2026-06-12: the switcher was originally hidden at zero coverage; then a no-coordinates click opened a dialog directly; it now always switches into the globe, whose empty-state "Create a globe" action opens the setup prompt — the empty state is the entry point, not an interrupting dialog.)_ The globe also remains discoverable via the node detail panel's `location` field affordance ("Add to globe").

**The backfill prompt (Scope Item 2a):** `get_layout_report` gains a new section: `"uncoordinated": { count: N, sample: [{ id, title, location }] }` — how many nodes have a `location` string but no `lat`/`lng`. The canvas coverage banner in the globe lens reads from this count. A copyable backfill prompt ("Update the following N nodes with lat/lng coordinates: [node titles]…") is generated client-side from the list — same `PromptDialog` machinery as all verbs.

---

## Playback UX (Scope Item 3)

### Play / pause / scrubber

- A **timeline bar** runs across the bottom of the globe panel (or top — Wren to pin): a horizontal scrubber showing the full temporal extent of the timeline (from the earliest node's `startInstant` to the latest `endInstant` or `startInstant`).
- A **play/pause button** left of the scrubber. Default state: paused at the timeline's start. Keyboard: Space bar while the lens is focused.
- **Drag the scrubber** to jump to any point in time; nodes appear/disappear in real-time as you scrub.
- The scrubber shows **real dates** (formatted using the node `precision` conventions already in `src/lib/domain/dates.ts`) — not wall-clock seconds. BCE dates are displayed with the "BCE" suffix; years are the default unit for historical timelines.

### Non-linear time (Scope Item 3a)

Historical timelines have huge dead zones. A Stoicism timeline that spans 600 years may have 80% of its nodes in a 200-year window. Playing wall-clock-linearly makes the dense region flash by and the sparse region crawl.

**The approach:** playback advances through **event-relative time** — the play speed is calibrated so the perceived density of the sweep is roughly uniform, not the calendar density. Concretely: divide the total timeline span into equal *play-time buckets*, but size each bucket by the number of nodes it contains (more nodes → slower sweep through that era; fewer nodes → faster). The scrubber always shows real calendar dates; the *speed at which the play cursor advances through calendar time* varies.

This is the same philosophical move as `collapseGaps` on the main canvas (compress dead zones), applied to playback speed rather than x-position.

**Speed control:** a simple 3-speed toggle (1×, 2×, 4×) or a continuous speed slider. Default: 1×. Kael to decide based on the rendering complexity of smooth speed changes.

### Nodes appearing over time

- **Events** (point-in-time nodes, `endInstant = null`): appear as a dot/marker when the play cursor crosses their `startInstant`. They remain visible for the rest of the playthrough — they happened; they stay on the map.
- **Periods and entities with a span** (`endInstant` set): appear when the cursor crosses `startInstant`, **glow** (stronger opacity or a soft pulse) while active, and **dim but persist** (not disappear) after `endInstant`. This matches intuition: the Roman Empire ended, but it still *happened* — it should remain visible on the map.
- **Year-precision dates**: a node dated "300 BCE" (year precision) appears when the play cursor crosses the year boundary. No subannual jitter.
- **BCE dates**: the playback axis handles negative epoch-ms values correctly (the domain time model already supports this — `instantToX` operates on epoch-ms directly). BCE to CE transition is just another tick on the axis; no special casing needed.

### Span rendering

- During playback, a span node's marker pulses or glows to distinguish "active now" from "happened, finished."
- In scrub/paused mode, a span can show a faint arc or bracket on the scrubber bar indicating its active range — so you can see at a glance which periods overlap with a given moment.
- Kael to decide on arc vs bracket vs opacity-only for v1 based on SVG/canvas complexity.

---

## Renderer (Scope Item 4)

**d3-geo orthographic projection** (canvas/SVG, not three.js/globe.gl). Rationale:

- ~30kB vs ~150kB+ for three.js / globe.gl; no WebGL dependency
- Full CSS/SVG styling control — picks up per-timeline theme accents living on `.canvas-root` as CSS custom properties
- Matches the Linear/Notion design language the canvas already uses — no skeuomorphic 3D sheen
- d3-geo is the standard for declarative, projection-correct cartographic rendering in React

**Implementation approach:**

- A new route-level component `GlobeLens.tsx` in `src/components/canvas/`, **client-only** behind `<ClientOnly>` (same guard as React Flow)
- Uses `d3-geo` for the orthographic projection; `d3-selection` or direct SVG/Canvas API for rendering the sphere, graticule, and country outlines
- Country/landmass geometry from a lightweight TopoJSON file (`world-110m` is ~100kB; `world-50m` is larger — v1 uses 110m for bundle discipline; Kael to confirm)
- Nodes rendered as SVG circles positioned via `projection([lng, lat])`; size scaled by node `size` field
- Colors: node markers inherit the timeline theme's `accentPrimary` (from `.canvas-root` CSS variables); active spans use `accentEra`; inactive spans drop to 30% opacity
- The globe rotates on `play` — the projection's rotation parameter (`λ`, `φ`) animates via `requestAnimationFrame`, centering the view on the "active" region of the map as the time cursor advances (or holds the user's last manual rotation if they've touched it)

**What is NOT in scope for v1:**

- Three.js, WebGL, globe.gl — deferred permanently unless performance evidence demands it
- Flat-map (Mercator or other) projection toggle — deferred; orthographic is the right default for a globe-as-emotional-object; a flat map is a different lens with different affordances
- Flourishes: atmospheric glow, animated particle trails, zoom-to-country — deferred
- Arc overlays between connected nodes (edges on the globe) — deferred; adds visual complexity before v1 proves out

---

## Entry and exit (Scope Item 5)

### Entry

Three surfaces, in order of discoverability:

1. **Top-center view switcher** (primary): a segmented control ("Timeline | Globe") floating top-center in the `.top-bar`, between the AppBar identity chips (left) and the canvas toolbar (right). This is the canonical lens toggle — one click switches views, the active segment shows where you are. **Always rendered** (a permanent fixture, for owner and public viewer alike), independent of coverage. Clicking **Globe** **always switches into the lens**: with ≥1 located node it plots the markers (the in-globe coverage banner nudges when below threshold, "5 of 23 nodes located — add more for a fuller picture"); with **zero** located nodes the globe shows its empty state whose primary "Create a globe" action opens the setup prompt. _(Design changed 2026-06-12 from the original "hidden at zero coverage" gate, then from a dialog-on-click, to this always-switch + empty-state model.)_
2. **⌘K command palette**: a "Switch to globe view" command in the NAV registry, always available — it switches into the globe (which shows the empty state + "Create a globe" action when the timeline has no coordinates).
3. **Node detail panel**: when a node has a `location` string but no `lat`/`lng`, a small "Add to globe →" affordance in the location row of the dateline opens the backfill prompt for that single node.

### Exit

- The **view switcher** returns to the timeline (click "Timeline"). Keyboard: Escape also exits the globe back to the timeline view.
- The lens is a **view mode**, not a route change. No URL change on lens switch (URL stays `/timelines/:id`). Lens state (open/closed) is ephemeral, not persisted to `viewSettings` in v1.
- When the `NodeDetailPanel` is open in the globe lens (after clicking a marker), closing the panel does not close the globe.

### Layout

**Decided: Replace** (owner-confirmed 2026-06-12; rationale in Technical design §3). The globe is a full lens, not a side panel — split was rejected because it contends with the right-dock panel system (`NodeDetailPanel`/`StoryReader` resizable widths + camera centering). The timeline is recovered instantly via the top-center view switcher; the `NodeDetailPanel` docks in its usual slot inside the globe view. Considered and rejected for v1: split (dock contention), full-screen modal (orphans the dock and the bar chrome).

---

## Analytics (Scope Item 6)

PostHog is wired for both client and MCP-server events (client: `src/lib/posthog/client.ts`; MCP: `src/lib/posthog/server.ts`). Proposed events:

**Client-side (canvas events):**

| Event | Properties | Why |
|---|---|---|
| `globe_lens_opened` | `{ timeline_id, node_count, coordinated_count, coverage_pct }` | Funnel entry; baseline for lens adoption |
| `globe_playback_started` | `{ timeline_id, speed }` | Play is the hero action; measure reach |
| `globe_scrubbed` | `{ timeline_id }` | Manual scrub = engaged exploration |
| `globe_marker_clicked` | `{ timeline_id, node_id, node_type }` | Which node types people click through to the detail panel |
| `globe_lens_closed` | `{ timeline_id, session_duration_ms, played: boolean }` | How long people dwell; did they play at all |
| `globe_backfill_prompt_copied` | `{ timeline_id, uncoordinated_count }` | Do users actually add coordinates after the backfill prompt |

**Implicit success signal (no new event needed):**

- `mcp_tool_called` on `apply_patch` with `update_node` ops that include `lat`/`lng` = coordinate adoption rate. Already fired by the existing PostHog MCP wrapper.

**The metric that validates the lens:** a user opens the globe lens more than once in a session (return engagement), or returns to a timeline they've opened the globe on before. This is observable via `globe_lens_opened` + `distinct_id` + session timestamps.

---

## Success metrics

The globe lens earns its keep if:

1. **Coordinate adoption:** within 4 weeks of shipping, ≥30% of active timelines (those with ≥1 session post-ship) have ≥5 coordinated nodes. Measurement: `mcp_tool_called` with `lat`/`lng` in `update_node` ops.
2. **Lens engagement:** of users who open the globe, ≥50% press play (not just open + close). Measurement: `globe_playback_started` / `globe_lens_opened`.
3. **Retention signal:** users who open the globe return to the same timeline at a higher rate than those who don't. Measurement: cohort comparison via PostHog (requires a session with `globe_lens_opened` vs without, on the same `timeline_id`).
4. **Backfill loop closes:** of users who see the low-coverage state and copy the backfill prompt (`globe_backfill_prompt_copied`), ≥40% follow it with a `mcp_tool_called` on `apply_patch`. Measurement: event sequence within the session.

If metrics 1 and 2 don't fire within 6 weeks of ship, revisit the coverage gate threshold and the discovery path before investing in v2.

---

## Risks and open questions

**R1 — Bundle size.** d3-geo + TopoJSON world geometry adds ~100–130kB to the client bundle (d3-geo ~30kB + world-110m ~100kB). This is client-only (behind `<ClientOnly>`) so it doesn't affect SSR. Dynamic import (`() => import('./GlobeLens')`) on first open keeps it out of the initial paint. Kael to verify this doesn't breach the existing bundle budget.

**R2 — Coordinate quality.** The MCP client supplies coordinates; Claude can hallucinate or be imprecise. Ancient locations (Zeno's Cyprus, BCE Mesopotamia) require historical geography knowledge. `apply_patch` warnings should flag coordinates that are obviously in the ocean for a `location` string that looks like a city — but this is best-effort. v1 should document "MCP client-supplied; not geocoding-verified" in the UX to set expectations.

**R3 — Coverage cold-start.** New timelines will have zero coordinates. The always-visible Globe segment then routes into the backfill setup dialog rather than an empty globe (it never shows a misleading near-empty map). The friction of adding coordinates to every node is real — it requires a dedicated `apply_patch` call (or inline on creation). If coordinate adoption is slow (metric 1 misses), the lever is improving the backfill prompt UX, not loosening the coverage gate. Do not lower the gate to make the lens look fuller than it is.

**R4 — BCE date rendering on the scrubber.** The scrubber must display BCE dates legibly — the existing `formatInstant` in `src/lib/domain/dates.ts` already handles this, but the scrubber's tick-label density at historical scales may need tuning. Kael to verify.

**R5 — Non-linear playback complexity.** Event-relative time bucketing is conceptually simple but requires deciding the bucket-sizing algorithm. If the implementation becomes complex, v1 can ship linear playback first and add non-linear as a fast follow. Linear is usable; it just makes dense eras fast. Record this as a known v1 simplification if taken.

**R6 — Layout decision (split/replace/modal). RESOLVED: Replace, driven by a top-center view switcher.** The globe replaces the canvas pane (Technical design §3 — split would contend with the right-dock panel system); a "Timeline | Globe" segmented control floats top-center in the `.top-bar` as the canonical toggle (owner decision, 2026-06-12). Side-by-side split remains a possible v2 if evidence demands it.

**Open questions:**

- OQ1: Should the globe lens be accessible from the home screen's timeline list (as a "preview globe" of a coordinated timeline), or only from inside the canvas? (Lean: canvas-only for v1.)
- OQ2: Should `create_timeline` accept node-level `lat`/`lng` in its `nodes` param (if a `nodes` shortcut is ever added), or is the `apply_patch` path sufficient for all coordinate setting? (Lean: `apply_patch` only; don't complicate `create_timeline`.)
- OQ3: Should the globe rotate to auto-center on the current time cursor's active nodes during playback, or hold a user-set rotation? (Lean: auto-center during play, override on manual rotation, resume auto-center on play resume.)
- OQ4: Does the lens survive a live SSE patch arrival? The globe must re-derive coordinates from the updated graph without a full remount. (This is the same "merge incoming nodes" pattern as `useTimelineStream`; Kael to confirm the approach.)

---

## Technical design (Kael)

> Verified against the codebase 2026-06-12. File/line citations are to the tree at that point. Confidence stated inline on judgment calls.

### 0. The one thing that changes the product (read this first)

**The Stoicism seed has zero coordinates AND zero `location` strings.** I grepped `scripts/seed.ts`: `grep -c "location:"` returns `0` across the whole file — all six seeded timelines (`stoicism`, `observability`, `deep-learning`, `space-race`, `roman-republic`, `figures`), 34 nodes in Stoicism alone, carry **no** `location` and therefore no `lat`/`lng`. This resolves **OQ5** bluntly: the coverage gate evaluated against the shipped seed is **0% — every seeded timeline lands in the zero-coordinate state.**

Consequence for scope: the globe is invisible on a fresh install until the user's Claude backfills coordinates. That is acceptable *only if* G1 (the data contract + backfill affordance) lands first and the backfill loop is frictionless. It also means the demo/marketing "watch the Stoics spread" moment requires seeding coordinates. **I recommend a small scope addition (G1a, below): add `location` + `lat`/`lng` to the Stoicism seed** (the 9 people + the Porch + the 3 events have well-known places) so the lens has something to render out of the box and the success metrics have a baseline. Without it, metric 1 (coordinate adoption) starts from a literal zero and the lens cannot be demoed without manual setup. Flagging to Margot: this is the single most important finding in the pass.

### 1. Data contract — `lat`/`lng` on `NodeMetadata`

**Shape: flat fields, not a nested object.** Add to `NodeMetadata` (schema.ts:40-52):

```ts
// Where this happened, as coordinates the globe lens plots. Optional, additive,
// MCP-client-supplied (no geocoding). Decimal degrees: lat negative = South,
// lng negative = West. The display string `location` is unchanged and orthogonal.
lat?: number
lng?: number
```

Flat `lat`/`lng` over `coordinates: { lat, lng }` for three reasons grounded in the existing code: (a) every other metadata field is flat (`lane`, `location`, `size`, `color`) — a nested object breaks the merge pattern in `ops.ts:163-220` which spreads keys individually; (b) the `ops.ts` `update_node` metadata merge (`...prior, ...(op.x ? {x} : {})`) is trivial to extend for two scalars, awkward for a sub-object that must itself be merge-vs-replace; (c) `lng` not `lon`/`long` — match `react-flow` and d3 convention (`projection([lng, lat])`), and avoid the `lon`/`long` ambiguity. Confidence: high.

**It is metadata in the JSON column → no migration.** `nodes.metadata` is `text({ mode: 'json' })` (schema.ts:119) typed as `NodeMetadata`. New optional keys are backward-compatible; existing rows deserialize unchanged. Verified: the same pattern was used to add `location` and `lane` without migrations. The only schema-layer change is the type + comment. **No `db:generate`/`db:migrate` needed.** Confidence: high.

**The Patch inverse handles it for free.** Confirmed by reading `patches.ts:257-265`: `updateNode` snapshots `before.metadata` (the entire prior metadata object) and stores `after.metadata` (the entire merged object). `ops.ts:200-220` merges `lat`/`lng` into a full `merged` metadata blob written as `np.metadata`. `invertOp` (patches.ts:195) swaps `before`/`after`, so undo restores the whole prior metadata — coordinates included. **Zero coordinate-specific undo code.** This is the same property images/lane/location already rely on. Confidence: high.

**Flow to the client (three edits — this is the actual G1 surface area):**
1. `NodeMetadata` in `src/lib/db/schema.ts` — add `lat?`/`lng?` (storage + type).
2. `GraphNode` in `src/lib/domain/types.ts` — add `lat: number | null; lng: number | null` (the client DTO; client-reachable module, no schema import — keep it that way).
3. The serializer at `src/lib/server/graph.ts:49` — add `lat: n.metadata?.lat ?? null, lng: n.metadata?.lng ?? null` alongside the existing `location:` line. **This is the one easy-to-miss edit**: the DTO is hand-mapped field-by-field, not spread, so a new field that isn't added here silently never reaches the canvas. (Same applies to `query_timeline`/`get_node` rows in `server.ts:305,348` if we want coordinates readable by the MCP client — add them there too so Claude can see which nodes it has already located without pulling the full graph.)

**MCP ops contract (`src/lib/mcp/ops.ts`):** add to both the `add_node` and `update_node` branches of `opSchema` (ops.ts:88-144):

```ts
lat: z.number().min(-90).max(90).optional()
  .describe('Latitude in decimal degrees (−90..90, negative = South). Plotted on the globe lens. ' +
            'Supply alongside `location` when you know where this happened; city-level precision is plenty.'),
lng: z.number().min(-180).max(180).optional()
  .describe('Longitude in decimal degrees (−180..180, negative = West). Pair with `lat`.'),
```

Zod `.min/.max` is the validation — out-of-range values fail the op's parse and surface as an `isError` MCP result (the established failure mode, per memory note on theme zod failures), **not** a silent clamp. Then extend the metadata assembly: in `add_node` (ops.ts:163-172) add `...(op.lat != null ? { lat: op.lat } : {})` and the same for `lng`; in `update_node` (ops.ts:201-220) add to the merge guard and merge body, with the clear convention matching `lane`/`location`: pass `lat: null` is not how zod-optional works, so to **clear** coordinates the client passes nothing (no clear path needed for v1 — coordinates are additive and a wrong one is fixed by overwriting). Note: `lat`/`lng` are a **pair** — guard the metadata write so a lone `lat` without `lng` (or vice versa) is dropped or warned (see §2). Confidence: high.

**Precision note:** city-level (≈2 decimal places, ~1km) is the target and is more than enough for an orthographic globe where a country is tens of pixels. We store whatever float the client sends; no rounding. The hint text says "city-level is plenty" to keep Claude from agonizing over decimals.

### 2. `get_layout_report` `uncoordinated` section + the warning question

**Where it goes:** `buildLayoutReport` in `src/lib/mcp/layout-report.ts`. The natural seam is right after the `nodeIndex` build (layout-report.ts:138-151), as a new top-level key in the returned object (layout-report.ts:153-180). Shape — matching the PRD and the existing compact style:

```ts
// nodes with a location string but no coordinates → the backfill target
const located = nodes.filter((n) => n.metadata?.lat != null && n.metadata?.lng != null)
const uncoordinated = nodes.filter((n) => n.metadata?.lat == null || n.metadata?.lng == null)
// ...
coordinates: {
  total: nodes.length,
  located: located.length,
  coveragePct: nodes.length ? Math.round((located.length / nodes.length) * 100) : 0,
  // The backfill target: nodes that ALREADY have a place string but no coords are
  // the cheapest wins (Claude knows the place; just needs to geo-resolve it).
  hasLocationNoCoords: uncoordinated.filter((n) => n.metadata?.location).length,
  sample: uncoordinated.slice(0, 12).map((n) => ({ id: n.id, title: n.title, location: n.metadata?.location ?? null })),
}
```

I renamed the PRD's `uncoordinated` → a `coordinates` block carrying both coverage (so the client/canvas reads the gate number from one place) and the backfill sample. Same advisory, more useful. The canvas coverage banner and gate read `located`/`coveragePct`; the backfill prompt reads `sample`. Confidence: high.

**Should `apply_patch` warn when a node has `location` but no `lat`/`lng`? — No, with a narrow exception.** Reasoning on warning fatigue: `warnings.ts` already returns up to 12 warnings (warnings.ts:26) and the building client is told to act on them. If every node with a `location` string and no coordinates produced a warning, a normal build (where Claude sets `location` for texture but coordinates are a *separate, later* concern) would flood the channel — every Stoic philosopher would warn. That trains the client to ignore warnings, which poisons the genuinely-broken-image signal. **Coordinate coverage is a whole-timeline property, and `get_layout_report` is exactly the whole-timeline review surface — that is where the nudge belongs, fired once, with a count, when the client explicitly asks for a layout review.** The server prompt (server.ts:149) already tells the client to call `get_layout_report` and act on it after a build.

The **narrow exception** that *does* belong in `apply_patch` `warnings`: a **lone coordinate** — a node in this batch that got a `lat` but no `lng` (or vice versa), or a value that parsed but is implausible (lat/lng both 0 = "null island", a classic geocoding failure). Those are *errors in the data the client just wrote*, batch-scoped, and rare — exactly the per-patch signal `warnings.ts` is for. Add a small `coordinateWarnings(ops)` to `warnings.ts` alongside `imageWarnings`/`citationWarnings` (warnings.ts:132-176 pattern), wired into `collectPatchWarnings` (warnings.ts:246-262). Do **not** add an ocean/landmass check in v1 — it requires the TopoJSON landmass on the server (a Node-side bundle cost) and is explicitly "best-effort" in the PRD; defer it. Confidence: high on the split; the ocean check is the only thing I'm deferring against the PRD's R2/Scope-Item-3 wishlist, and I'm calling that a correct deferral, not a gap.

### 3. Component architecture & layout decision

**Layout: Replace (full lens), not split, not modal. Confidence: high.** Rationale grounded in the existing dock system:
- The canvas already owns a **right-docked panel stack** — `NodeDetailPanel` + `StoryReader`, with user-resizable widths (`--detail-panel-w`/`--story-reader-w` CSS vars set on `.canvas-root`, TimelineCanvas:953-955) and a `StoryCamera` that re-centers the visible canvas *left of the dock* (TimelineCanvas:122-137). A **split** layout would put the globe in contention with that dock for horizontal space and force a second camera-vs-dock measurement system. That's the "screen door on a submarine" option — it works, but it fights the architecture.
- **Replace** lets the globe own the full canvas pane while the *same* `NodeDetailPanel` docks in its *existing* slot on marker click — the PRD's stated intent ("the panel is the reader; nothing is new except the view"). The dock CSS vars, the resize handles, and `StoryCamera`'s left-of-dock centering all keep working because the globe, like React Flow, just needs to render in the area left of the dock. The globe reads the same `--detail-panel-w` to know its right inset.
- **Mount point:** `GlobeLens` is a **sibling of `<ReactFlow>` inside the same `.canvas-root` div** (TimelineCanvas:1029), conditionally rendered: `lensView === 'globe' ? <GlobeLens/> : <ReactFlow/>`. Not a route change (PRD §Exit confirms URL stays `/timelines/:id`). Wrap it in `<ClientOnly>` exactly like React Flow (CLAUDE.md canvas convention — SSR touches `window`; d3-geo + a `<canvas>`/SVG measuring `clientWidth` will break SSR). A `useState<'canvas' | 'globe'>('canvas')` in `TimelineCanvas` is the lens toggle; ephemeral, not persisted to `viewSettings` (PRD §Exit).

**Data source — reuse the exact same query, zero new fetch.** The graph is loaded once via `useQuery({ queryKey: ['graph', timelineId] })` (TimelineCanvas:271-272). `GlobeLens` receives `nodes: GraphNode[]` as a prop from the already-resolved `gnodes` — it does **not** open its own query. This is what makes SSE hot-update free (§6): the globe re-renders whenever `['graph', timelineId]` refetches, same as the canvas. The globe filters `gnodes` to `n.lat != null && n.lng != null` itself. Confidence: high.

**Entry/exit wiring:**
- **View switcher (primary):** a `ViewSwitcher` segmented control ("Timeline | Globe") rendered top-center in the `.top-bar` (TimelineCanvas:963-1018). The bar is currently a two-ended flex row (`AppBar` left, `canvas-toolbar` right) — center the switcher with absolute positioning (`left-1/2 -translate-x-1/2`) inside the relatively-positioned bar so it stays truly centered regardless of the chip widths on either side; style it as a `floatChip` group (the established chrome idiom, `chrome.ts`). Radix/shadcn shape: a `radiogroup` (`aria-label="Canvas view"`) of two radio segments. **Always rendered** (not coverage-gated); the Globe segment defers to an `onSwitchToGlobe` callback from `TimelineCanvas` rather than calling `setLensView('globe')` directly — that callback switches when `coverage.hasAny`, else opens the `globeBackfillSpec` `PromptDialog`. Coverage state goes in the Globe item's tooltip — read `coveragePct`/`hasAny` from the in-memory graph (compute client-side; don't round-trip `get_layout_report` for a tooltip). Note the public-viewer case: the switcher shows for any viewer (it's read-only navigation, not an owner mutation), same as the canvas itself.
- **⌘K (`verbs.ts` registry):** add a **timeline-level verb**, not a `NODE_VERBS` entry (the globe is graph-scoped, like `improveTimelineSpec`/`themeTimelineSpec` at verbs.ts:197-230). But note: existing timeline-level "verbs" all produce a `PromptSpec` (a copy-prompt). The "switch to globe" action is a **local view command, not a prompt** — it doesn't hand Claude anything. So it does **not** fit the `Verb`/`PromptSpec` shape cleanly. Two sub-cases:
  - *Switch to globe* (≥1 coordinated node): a plain `CommandPalette` action item (an `onSelect` that calls `setLensView('globe')`), registered in the NAV section of `CommandPalette`, **not** in `verbs.ts`. Keep `verbs.ts` for prompt-producing verbs only — don't leak a view-toggle into the prompt registry. Confidence: high.
  - *Set up globe view* (zero coordinated nodes): **this one IS a prompt** (the backfill prompt) and *does* belong as a verb-shaped `PromptSpec` (a new `buildGlobeBackfillPrompt` in `src/lib/node-verb-prompts.ts` + a `globeBackfillSpec` in `verbs.ts`). It reads the `coordinates.sample` from `get_layout_report` or, cheaper, the client-computed uncoordinated list. This is the structural-gap-invitation move the PRD wants (B5 parallel to dead-zone cards).
- **Exit:** the view switcher's "Timeline" segment → `setLensView('canvas')`; Escape key bound while the lens is focused does the same. Marker-click opens `NodeDetailPanel` (sets `selectedId`, the existing state) — closing the panel does **not** change `lensView` (PRD §Exit). Confidence: high.

```
TimelineCanvas (owns lensView state, the ['graph'] query, selectedId, dock widths)
├─ top-bar
│  ├─ AppBar (identity chips, left — unchanged)
│  ├─ ViewSwitcher (top-center, absolute-centered floatChip ToggleGroup: Timeline | Globe;
│  │               rendered only when ≥1 coordinated node; coverage tooltip)
│  └─ canvas-toolbar (right)
│     ├─ CommandPalette (+ "Switch to globe" NAV action; "Set up globe" backfill PromptSpec when 0 coords)
│     └─ CanvasSettings / HistoryControls / StoriesMenu …
├─ {lensView === 'canvas' ? <ReactFlow/> : <ClientOnly><GlobeLens nodes={gnodes} onMarkerClick={setSelectedId} .../></ClientOnly>}
└─ right dock: NodeDetailPanel (unchanged) + StoryReader

GlobeLens (client-only)
├─ <GlobeCanvas>        d3-geo orthographic, country mesh, markers (the renderer)
├─ <Scrubber>           play/pause, drag-scrub, speed toggle, BCE-aware tick labels
├─ <CoverageBanner>     "N of M located" + backfill affordance when below gate
└─ rotation + time-cursor state (rAF loop lives here)
```

### 4. Playback engine

**Time-cursor model.** A single `cursorInstant: number` (epoch-ms, the same domain instant the whole app uses). The timeline's playable extent is `[minInstant, maxInstant]` where `min = Math.min(...startInstants)` and `max = Math.max(...(endInstant ?? startInstant))` over coordinated nodes (reuse the instant-collection pattern from layout-report.ts:77-80). A node is "appeared" when `cursorInstant >= startInstant`; a span is "active" when `startInstant <= cursorInstant <= endInstant`, "past" when `cursorInstant > endInstant` (PRD §Nodes appearing — events stay, spans dim-but-persist). Confidence: high.

**BCE + year precision — confirmed no edge cases.** Instants are already integers, negative = BCE (schema.ts:113-115). `cursorInstant` arithmetic is plain integer math; the BCE→CE boundary is just crossing zero — no special case, exactly as the PRD asserts and as `instantToX` (useTimelineScale.ts:103) already proves in production. Year-precision nodes appear when the cursor crosses their `startInstant` (which `parseDate` already snapped to the year boundary); no sub-annual jitter because the stored instant *is* the boundary. The scrubber labels reuse `formatInstant(instant, precision)` from `src/lib/domain/dates.ts` (already BCE-aware — confirmed it's the same fn `layout-report.ts:22` and `warnings.ts` use). Confidence: high.

**Non-linear playback — reuse `makeTimeScale`, don't write a new bucketer.** This is the key reuse find. `makeTimeScale(instants, pxPerDay, collapseGaps)` in `src/components/canvas/useTimelineScale.ts:150-206` *already* builds a monotonic, piecewise-linear instant↔x mapping that compresses dead zones (the `collapseGaps` mechanic, useTimelineScale.ts:162-177). **Playback advances linearly in `x`-space, not instant-space.** Concretely:
- Build `const scale = makeTimeScale(coordinatedInstants, pxPerDay, /*collapseGaps*/ true)`.
- The play cursor advances `x` at a constant px/second; `cursorInstant = scale.toInstant(x)`. Because `toInstant` is slower (more instant per px) across collapsed dead zones and faster through dense clusters, the *perceived* sweep is density-uniform — dense eras get more wall-clock time, dead zones blow past. This is **the same transform the canvas uses, applied to the time axis of playback** — which is precisely the "same philosophical move as `collapseGaps`" the PRD describes (§Non-linear time), except we get it by literal code reuse instead of a new bucketing algorithm.
- The scrubber's x-extent is `[0, scale.toX(maxInstant)]`; the scrubber thumb position is `scale.toX(cursorInstant)`; dragging maps `scale.toInstant(dragX)`. The collapsed-range break markers (`scale.collapsedRanges`, useTimelineScale.ts:176) can render as hatch marks on the scrubber so the user *sees* where time was compressed — a nice free affordance.

This **dissolves OQ6 and R5**: non-linear is *not* >2 days of scope because we reuse `makeTimeScale` wholesale rather than authoring a bucketer. Ship non-linear in v1. The only knob is `pxPerDay` for the scale — use the timeline's saved `viewSettings.pxPerDay` so the globe's time-compression matches the canvas the user already tuned (read it from the same `viewSettings` the query already returns). Confidence: high. (Linear remains a trivial fallback — `collapseGaps: false` — if a specific timeline misbehaves, but I don't expect to need it.)

**rAF loop / pause / scrub / speed.** Standard `requestAnimationFrame` loop in `GlobeLens` (client-only, fine): on each frame, `x += pxPerSec * speed * dtSeconds`, clamp to extent, `setCursorInstant(scale.toInstant(x))`, stop at `x >= maxX`. Pause cancels the rAF. Scrub sets `x` directly (and pauses). **Speed: 3-way toggle (1×/2×/4×), not a continuous slider** — discrete multipliers on `pxPerSec` are trivial and avoid mid-animation easing math; the PRD left this to me (§Speed control). Confidence: high. Respect `prefers-reduced-motion` (the codebase has a global reduced-motion reset per the a11y memory) — under reduced motion, default to paused and let the user scrub.

**Span scrubber rendering — opacity-only for v1.** The PRD offers arc/bracket/opacity (§Span rendering). Opacity-only on the marker (active = full, past = ~30%, future = hidden) is the v1 call — arcs/brackets on the scrubber are extra SVG geometry that earns its place only once the lens proves engagement. The `collapsedRanges` hatch marks (above) are the one scrubber decoration worth shipping. Confidence: medium-high (a UX call Wren may want to weigh in on, but I'd hold the line on opacity-only for v1 cost).

### 5. Rendering plan — d3-geo orthographic

**SVG, not Canvas 2D. Confidence: high.** Node counts are 100s, not 1000s (Stoicism = 34; a large timeline = low hundreds). SVG wins decisively at this scale:
- **Hit-testing for free.** Marker click → `NodeDetailPanel` needs per-marker click targets. SVG `<circle onClick>` gives this natively with React event delegation. Canvas requires manual hit-testing (re-project every marker on click, or maintain a quadtree) — pure cost for no benefit at 100s of nodes.
- **Theming for free.** The whole point (PRD §Renderer) is markers inheriting `.canvas-root` CSS custom properties (`--color-accent-primary`, `--color-accent-era`). SVG elements take `fill: var(--color-accent-primary)` directly; Canvas can't read CSS vars without JS plumbing (`getComputedStyle` per repaint). This is the same reason the canvas node cards are DOM/CSS, not Canvas — consistency with the Linear/Notion design language the PRD calls for.
- The sphere, graticule, and country mesh are static-ish per rotation frame; redrawing a few hundred `<path>`/`<circle>` elements per rAF tick is fine in React 19 with keyed elements. If rotation ever stutters on a huge timeline, the country mesh (not the markers) is the cost — and that's the *one* thing to consider moving to a `<canvas>` backdrop layer behind the SVG markers as a fast-follow. v1: all SVG.

**Projection setup.** `d3-geo`'s `geoOrthographic()` with `.fitExtent` to the pane size (minus the right dock inset), `.rotate([-λ, -φ])` for camera. Country outlines: `topojson.feature(world, world.objects.countries)`, rendered via `geoPath(projection)` to SVG `d` strings. Graticule via `geoGraticule10()`. Markers: `projection([lng, lat])` → `[x, y]`; **cull back-face markers** — a point is on the far side of the globe when `geoDistance([lng,lat], projectionCenter) > π/2`; hide those (or fade) so nodes behind the globe don't bleed through. (Standard orthographic gotcha; d3 `geoPath` clips the country mesh automatically but raw `projection()` for point markers does not — must check manually.)

**Rotation (resolves OQ3): auto-center on the active node during playback, override on manual drag, resume auto-center on play. Confidence: high** — this is the PRD's own lean and it's right. Implementation: during play, ease `projection.rotate` toward `[-activeLng, -activeMidLat]` where the active node is the most-recently-appeared coordinated node (or centroid of nodes appearing in the current frame window). A manual drag (pointer events rotating λ/φ) sets a `userRotated` flag that suspends auto-center until the next play press. Ease with a simple lerp per frame, not a d3 transition (the rAF loop already owns the frame clock — don't fight it with `d3.transition`).

**TopoJSON sourcing — `world-atlas` npm package, `countries-110m.json`, dynamically imported. Confidence: high.** Use the `world-atlas` package (the canonical Natural Earth TopoJSON, maintained by the d3 author) and import `world-atlas/countries-110m.json` — `110m` resolution, ~100kB raw / ~30-40kB over the wire gzipped. Vendor via npm (not a copied file) so it's versioned and tree-shake-friendly. **Bundle it inside the dynamic `GlobeLens` chunk** so it's fetched only on first lens open. Do not use `50m` (larger, no benefit at globe scale where a country is tens of px).

**Bundle budget (resolves R1). Confidence: high — within budget.** The added weight: `d3-geo` (~25kB min) + `topojson-client` (~7kB min) + `countries-110m.json` (~100kB raw, ~30-40kB gzipped). Total ≈ **60-75kB gzipped, in a lazily-loaded chunk that never touches initial paint or SSR.** Because `GlobeLens` is dynamically imported (`const GlobeLens = lazy(() => import('./GlobeLens'))`) and gated behind `<ClientOnly>`, none of this is in the SSR bundle or the first canvas render — it loads when the user clicks the globe button, after the timeline is already interactive. This does not breach any meaningful budget; React Flow (`@xyflow/react`, already a dependency) is itself far heavier and also client-only. The lazy boundary is the discipline; the raw kB is a rounding error against what's already shipped. **No budget concern.**

### 6. SSE / live updates (resolves OQ4): incremental re-derive, free. Confidence: high.

Because `GlobeLens` consumes the **same `['graph', timelineId]` query result** that `useTimelineStream` already refetches on SSE patch arrival (TimelineCanvas:269-275), a live `apply_patch` that adds coordinates flows to the globe with **no globe-specific code**: the query refetches → `gnodes` updates → `GlobeLens` re-renders with new markers. No full remount (the component instance is stable across the data change), no separate subscription, no merge logic. This is exactly the "same pattern as `useTimelineStream`" the PRD asks for — and it's free precisely *because* of the §3 decision to pass `gnodes` as a prop rather than have the globe fetch its own data.

The one care-point: **don't reset playback state on data change.** `cursorInstant`, `playing`, `userRotated`, and the rAF loop live in `GlobeLens` local state and must survive a `nodes` prop change. New nodes simply appear/don't-appear based on the current `cursorInstant` like any other. The time-extent (`minInstant`/`maxInstant`) and the `makeTimeScale` instance recompute via `useMemo([nodes])` — a new node can extend the extent mid-play; clamp `cursorInstant` into the new range if needed (it almost never shrinks). That's the whole SSE story. Confidence: high.

### 7. Dependencies

**Add (exact):**
- `d3-geo` (`^3.1.1`) — projection + `geoPath` + `geoGraticule10` + `geoDistance`. ~25kB.
- `topojson-client` (`^3.1.0`) — `topojson.feature()` to turn the atlas into GeoJSON. ~7kB.
- `world-atlas` (`^2.0.2`) — the `countries-110m.json` Natural Earth TopoJSON data package.
- `@types/d3-geo`, `@types/topojson-client` (devDeps) — TS types.

Pull *only* `d3-geo`, not the `d3` umbrella — the umbrella drags in 30+ submodules. The rAF loop is hand-written (no `d3-timer`/`d3-transition` needed). Pointer-drag rotation is hand-written (no `d3-drag` needed). Confidence: high.

**Do NOT add:** `three`, `globe.gl`, `react-globe.gl`, WebGL anything (PRD §What is NOT in scope — orthographic SVG is the call); the `d3` umbrella; `d3-geo-projection` (extended projections — we only need orthographic); any geocoding/`node-geocoder`/Nominatim client (coordinates are MCP-supplied, full stop — adding one would breach the scope guardrail in CLAUDE.md).

### 8. Phasing review — G1-G7

The build order is mostly right. Three changes:

- **Add G1a — "Seed coordinates for Stoicism (+ Space Race, Roman Republic)."** Per §0, the seed has zero coordinates and the lens is invisible/un-demoable out of the box. Add `location` + `lat`/`lng` to the seed's geo-locatable nodes. Small (a data edit in `scripts/seed.ts`), depends on G1, and it's what makes the success metrics have a non-zero baseline and the marketing moment real. **Without this, G2-G7 ship a feature nobody can see until they manually backfill.** Highest-leverage addition in the pass. (Flag to Margot — this is a scope nudge, not just sequencing.)

- **G1 is correctly independent and should ship first and alone** (PRD already says this). It's a pure contract change: schema type + 3-place DTO flow + ops zod + `get_layout_report` `coordinates` section + the lone-coordinate warning. No UI. The MCP client can start supplying coordinates immediately. Confirm the `query_timeline`/`get_node` row additions (server.ts:305,348) are *in G1* so Claude can read back what it's located. **Re-scope note: G1 should explicitly include the `coordinates` section of `get_layout_report` AND the backfill prompt builder** (`buildGlobeBackfillPrompt`) — the prompt is data-layer-adjacent and lets the backfill loop work *before* the globe renders (a coordinated timeline can be built ahead of G2).

- **G3 absorbs the non-linear bucketer at no extra cost** (§4 — reuse `makeTimeScale`), so OQ6's "ship linear, add non-linear later" hedge is unnecessary. G3 ships non-linear directly. Drop the linear-fallback caveat from G3's scope (keep `collapseGaps:false` available as a one-line escape hatch, but don't plan around it).

**Parallelization:** G1 (+G1a) ships alone immediately. After G2 (the static globe), **G3 (playback), G4 (gate/entry/backfill), and G5 (click-to-panel) are genuinely parallel** — playback, the toolbar/⌘K/coverage wiring, and the marker click handler touch different surfaces of `GlobeLens` and `TimelineCanvas` with minimal overlap. G6 (SSE) is **near-zero work** given §6 (it's "pass `gnodes` as a prop and don't reset playback state on prop change") — fold it into G2/G3 rather than a standalone issue, or keep it as a thin verification issue. G7 (analytics) is last and independent. Realistic shape: **G1+G1a → (G2) → {G3 ∥ G4 ∥ G5, with G6 folded in} → G7.** A focused single sprint for G2-G7 is achievable as the PRD suggests. Confidence: high.

### Scope flags raised to product

1. **Seed has zero coordinates (§0/G1a)** — the lens is empty on a fresh install and un-demoable without manual backfill. Strongly recommend seeding Stoicism coordinates. *This is the one finding that should change the PRD.*
2. **The ocean/landmass coordinate-plausibility check (R2)** is deferred from v1 — it needs server-side TopoJSON and is "best-effort" by the PRD's own framing. The lone-coordinate + null-island warnings (§2) cover the cheap, high-value cases.
3. **A view-toggle is not a prompt-verb (§3)** — "switch to globe" is a `CommandPalette` NAV action, not a `verbs.ts` entry; only "set up globe" (the backfill prompt) is verb-shaped. Keeps the prompt registry clean.

---

## In scope / out of scope

### In scope (v1)

1. `lat`/`lng` on `NodeMetadata` — additive JSON fields, backward-compatible; MCP client supplies them via `apply_patch`
2. `get_layout_report` `coordinates` section (coverage count/pct + sample of nodes with `location` but no `lat`/`lng` — shape pinned in Technical design §2)
2a. Seed coordinates: add `location` + `lat`/`lng` to the geo-locatable nodes of the Stoicism (+ Space Race, Roman Republic) seeds, so the lens is demoable out of the box (Technical design §0 — the seed currently has zero)
3. `apply_patch` validation for `lat`/`lng` bounds; `warnings` for lone-coordinate pairs and null-island (0,0) — the ocean/landmass plausibility check is deferred (needs server-side TopoJSON; see Technical design §2)
4. d3-geo orthographic globe component (`GlobeLens.tsx`), client-only behind `<ClientOnly>`
5. Playback: play/pause, scrubber, non-linear event-relative speed (ships in v1 — `makeTimeScale` reuse, see Technical design §4; linear is a one-line escape hatch, not a planned fallback), 3-speed toggle
6. Node markers: events appear and stay; spans appear, glow active, dim after `endInstant`
7. BCE date support on the scrubber (reuse `formatInstant` from `src/lib/domain/dates.ts`)
8. Click marker → open `NodeDetailPanel` in its existing dock
9. Coverage gate: threshold check, low-coverage banner with backfill prompt; at zero coverage the always-visible switcher routes the Globe click into the backfill setup dialog
10. Backfill prompt via `PromptDialog` (existing machinery); `globe_backfill_prompt_copied` analytics event
11. Entry via the top-center view switcher (Timeline | Globe segmented control in the `.top-bar`) + ⌘K command; exit via the switcher + Escape
12. Theme integration: globe marker colors derived from `.canvas-root` CSS variables (existing theme system)
13. PostHog analytics events (6 client events listed above)
14. `apply_patch` acknowledgment of `lat`/`lng` in `warnings` (coordinate outlier flag)

### Explicitly out of scope (v1, deferred)

- **Flat-map projection toggle** — a Mercator or equirectangular alternative lens. Different affordances; defer until globe proves engagement.
- **Editing from the globe** — the globe is read-only. Node positions on the globe are not draggable; no "move this node to a new location" from the globe surface. The `NodeDetailPanel` (which opens on click) already supports editing via its existing edit-mode toggle.
- **Edge arcs on the globe** — drawing relationship edges as great-circle arcs between connected nodes. Adds visual complexity before the lens proves out.
- **Multi-site pins for `geoScope: 'diffuse'` nodes** (backlog: `local-104`) — an optional `sites: [{lat, lng, label}]` array so "The Axial Age" renders as four linked pins lighting up together (Greece · India · China · Judea) instead of a caption. The most truthful render for parallel phenomena; deferred until the placeless caption channel proves out.
- **Arc flourishes, atmosphere, glow effects** — skeuomorphic 3D, atmospheric gradient, satellite imagery. Out of scope with the Linear/Notion design language.
- **Sharing / embedding the globe** — a link that opens just the globe lens, or an embed iframe. Public sharing is in the deferred D.3 bucket (roadmap.md).
- **Globe as an editing surface** — placing new nodes by clicking the globe. This is a future "add a node by location" interaction; out of scope with the v1 read-only lens.
- **Mobile layout** — single-user local-first Core; the app is desktop-targeted; mobile is not in scope.
- **Geocoding integration** — no server-side geocoding, no third-party API, no keys. Coordinates are always user/MCP-supplied.

---

## Phased breakdown (pipeline issues)

Issues map to one Sal issue each. Horizons: all items are `next` (after NEXT.5 Tier 1 ships).

| # | Title | What it covers | Depends on |
|---|---|---|---|
| G1 | **Data contract: lat/lng on NodeMetadata + apply_patch validation** | Add `lat`/`lng` to `NodeMetadata` type (schema.ts comment, domain/types.ts), DTO flow (server/graph.ts serializer + query_timeline/get_node rows), MCP ops validation (bounds check, lone-coordinate + null-island `warnings`), `get_layout_report` `coordinates` section, `buildGlobeBackfillPrompt` | — |
| G1a | **Seed coordinates (Stoicism + Space Race + Roman Republic)** | Add `location` + `lat`/`lng` to geo-locatable seed nodes so the lens renders out of the box and metrics have a baseline (Technical design §0) | G1 |
| G2 | **Globe lens component (d3-geo, markers, theme integration)** | `GlobeLens.tsx` (client-only), d3-geo orthographic, country outlines, node markers, theme colors from `.canvas-root` CSS vars, non-interactive static view | G1 |
| G3 | **Playback: scrubber, play/pause, event-relative time** | Scrubber component, play/pause, speed toggle, node appear/dim logic for events and spans, BCE rendering, non-linear bucketing (or linear v1 simplification) | G2 |
| G4 | **Coverage gate + view switcher + backfill prompt** | Coverage threshold check, top-center `ViewSwitcher` segmented control (present/degraded-tooltip/hidden states), ⌘K command, backfill prompt via `PromptDialog`, `NodeDetailPanel` location-row affordance | G2, G3 |
| G5 | **Click-to-panel: marker → NodeDetailPanel** | Click handler on globe markers opens existing `NodeDetailPanel` in its dock; panel close does not close the globe | G2, G3 |
| G6 | **SSE hot-update verification in the globe lens** | Thin verification issue (near-zero build work per Technical design §6 — the globe consumes the same `['graph']` query as the canvas): confirm live `apply_patch` arrivals re-render markers without remount and playback state survives the data change | G2, G4, G5 |
| G7 | **PostHog analytics** | Wire all 6 client events (`globe_lens_opened`, `globe_playback_started`, `globe_scrubbed`, `globe_marker_clicked`, `globe_lens_closed`, `globe_backfill_prompt_copied`) | G4, G5 |

**Sequencing note:** G1 (+G1a) ships independently — a data contract change with no UI; the MCP client can immediately start supplying `lat`/`lng` before the globe renders them. After G2, G3/G4/G5 are parallel (different surfaces of `GlobeLens`/`TimelineCanvas`); G6 is a thin verification; G7 is last. Shape: **G1+G1a → G2 → {G3 ∥ G4 ∥ G5} → G6 → G7** (Technical design §8).

---

## Done when (v1)

- [ ] `apply_patch` accepts `lat`/`lng` on `add_node`/`update_node` ops; bounds-validates; `warnings` includes coordinate outliers.
- [ ] `get_layout_report` returns an `uncoordinated` section: count of nodes with `location` but no `lat`/`lng`, plus a sample (title + id) for the backfill prompt.
- [ ] Globe lens renders for any timeline with ≥5 coordinated nodes: orthographic projection, styled to the timeline's theme accents, country outlines from lightweight TopoJSON.
- [ ] Play/pause advances the time cursor; nodes appear at `startInstant`; spans glow while active, dim after `endInstant`; scrubber shows real (BCE-aware) dates.
- [ ] Coverage gate is enforced: below threshold the switcher shows with a coverage tooltip and the globe carries the backfill banner; zero coordinates hides the view switcher entirely.
- [ ] Clicking a marker opens the existing `NodeDetailPanel` in its dock. Panel edit mode works unchanged.
- [ ] Globe lens entry via the top-center view switcher and ⌘K command. Exit via the switcher and Escape.
- [ ] Live SSE patch arrivals update the globe without a full remount.
- [ ] All 6 PostHog analytics events fire correctly (verified against the capture seam).
- [ ] No schema migration required (metadata JSON column, backward-compatible); `typecheck` + `build` green; live in-browser pass (prod build) confirms globe renders, plays through, and panel opens.

---

## Open questions summary

| ID | Question | Lean | Kael resolution |
|---|---|---|---|
| OQ1 | Globe accessible from home screen? | Canvas-only for v1 | **Confirmed canvas-only.** Home-list "preview globe" would need its own data fetch + a second mount of the client-only bundle on a non-canvas route; no payoff for v1. |
| OQ2 | `create_timeline` accept `lat`/`lng` in a future nodes param? | `apply_patch`-only | **Confirmed `apply_patch`-only.** `create_timeline` has no `nodes` shortcut today; all node writes already route through `apply_patch`/`ops.ts`. Don't fork a second coordinate-setting path. |
| OQ3 | Globe rotation: auto-center on active nodes or hold user position? | Auto-center during play; override on manual touch; resume on play | **Confirmed the lean** (§5). Ease `projection.rotate` toward the active node per rAF frame; a manual drag sets `userRotated` to suspend until next play. |
| OQ4 | SSE hot-update: full remount or incremental re-derive? | Incremental; Kael to confirm approach | **Resolved: incremental, and free** (§6). `GlobeLens` consumes the same `['graph', timelineId]` query result the canvas does; an SSE refetch re-renders the globe with no globe-specific code. The only rule: don't reset playback state on `nodes` prop change. |
| OQ5 (new) | Coverage gate numbers (N=5, M=30%) — right threshold for the Stoicism seed? | Validate against seed | **Resolved with the real number: the Stoicism seed (and all 6 seeded timelines) has ZERO `location` strings and ZERO coordinates** (`grep -c "location:" scripts/seed.ts` → 0). The gate against the shipped seed is 0% — every seed lands in the zero-coordinate state. The gate threshold (N=5/M=30%) is fine *in principle*, but it's moot until coordinates exist → see **G1a (seed coordinates)** in §8/§0. This is a scope flag for Margot, not just a number to tune. |
| OQ6 (new) | Non-linear vs linear playback for v1? | If bucketing adds >2 days scope, ship linear | **Resolved: ship non-linear in v1, no hedge needed** (§4). Reuse `makeTimeScale` from `useTimelineScale.ts` wholesale — playback advances linearly in x-space, `cursorInstant = scale.toInstant(x)`. No new bucketing algorithm, so the >2-day trigger never fires. Linear remains a one-line escape hatch (`collapseGaps:false`). |
