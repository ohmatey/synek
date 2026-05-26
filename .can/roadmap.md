---
project: "Synek"
syncedAt: 2026-05-25T00:00:00.000Z
---

# Synek Roadmap

> Offline source of truth for Sal. **Core UX first — most lovable product before any thought of money.**
> **The pivot (2026-05-25):** the center of gravity moves from *building a knowledge mesh* to *reading grounded, time-anchored stories*. The timeline canvas — already shipped — becomes the **map**; **stories are the product**.
> **New magic moment:** *tap a moment → an AI tells you a short, source-grounded story, in any voice that was there.*

## Path to v1 — the story product

The substrate is built (timeline canvas: build → correct/trust → revisit → export — see **Substrate (shipped)** below). The new v1 is the **lovable story product**, sequenced so the defensible part — primary-source grounding — lands early:

- **Brutal-minimum lovable:** **S1** (a moment tells a story) + **S2** (every beat is grounded in a real source). That pairing alone is the undeniable demo.
- **Strong-mode product:** **S3** (multi-POV) + **S4** (witness mode) — the same moment through different eyes, and inside their heads.

Full PRDs per phase live in [`.can/prd/`](prd/). Everything under **Deferred** stays parked (local-first / single-user; no money yet).

> **Reconciliation guardrails** (baked into every PRD): don't rename the substrate — "moment" is the product word for an existing `node`, and the story layer hangs off `nodes.id` via FKs. Stories are **not** graph Patches — graph edits keep the one-turn-one-Patch invariant; story/POV/interior generation is a separate, **provenance-tracked** flow. Postgres sketch → Drizzle/SQLite; domain time stays **instant + precision** (BCE/fuzzy-safe).

## NOW — S1: Story spine + provenance

The new magic moment: tap a moment → one grounded, readable story; every generation tracked from day one. PRD: [`prd/s1-story-spine.md`](prd/s1-story-spine.md).

- **S1.1 — Story substrate: `people` + `stories` + `story_segments`** `done` `high` `feature` `#local-31`
  Tables hang off `nodes.id` (no renames). One primary story per moment; segments ordered + typed by `kind`.
- **S1.2 — Provenance: `prompt_templates` + `generations` + cache-by-hash** `done` `high` `feature` `#local-32`
  Built day one. Every generation records model/tokens/cost/latency; `cacheKey = hash(templateId, inputs)` dedupes.
- **S1.3 — Generation service: `generateStory` (generateObject → segments)** `done` `high` `feature` `#local-33`
  Separate from the graph-tool/Patch loop. Cache check → model → one transaction writes story + segments + generation row.
- **S1.4 — Story playback on the canvas + "Tell the story here" + depth badge** `done` `high` `feature` `#local-34`
  Beat-by-beat reader in the node-detail slot (right = beat + Back/Next, left = canvas framed/lensed on the moment); beats link to related moments (tap → center/ring via the lens); `depth_tier` (light/deep) badge; moment affordance to generate.

Done when: tap a moment → generate → step beat-by-beat on the canvas (moment framed + lensed); identical inputs hit cache; depth tier renders.

**Status:** built — schema + migration (`stories`/`story_segments`/`people`/`prompt_templates`/`generations`), the provenance/cache generation service (`generateObject`, separate `SYNEK_STORY_MODEL`), and the playback reader (shares the node-detail slot; drives the lens + camera; beat→related-moment links) are in. Verified via typecheck + clean production build + a 19-check data-layer test (commit / cache-hit / regenerate-archives-prior). **Owed:** a live in-browser pass of the reader/lens/camera + a real model turn (needs `OPENROUTER_API_KEY`; Claude Preview can't hydrate this dev server).

## NEXT — S2: Artifact grounding (the moat)

The defensibility layer, pulled early. Tap a sentence → see the primary source it came from. PRD: [`prd/s2-artifact-grounding.md`](prd/s2-artifact-grounding.md).

- **S2.1 — `sources` + `artifacts` (instant+precision dates)** `planned` `high` `feature` `#local-35`
  Reusable reference data; artifacts carry a BCE-safe `dateInstant` so they can place on the timeline.
- **S2.2 — `story_artifacts` + `segment_citations` joins** `planned` `high` `feature` `#local-36`
  Story-level anchors + beat-level "this came from X". Composite PKs.
- **S2.3 — Grounded generation: story prompt v2 takes artifacts, emits citations** `planned` `high` `feature` `#local-37`
  Model grounds beats in supplied artifacts and names the artifact per beat → `segment_citations`. Uncited beats stay honest.
- **S2.4 — Inline citation UX + artifact-first browse** `planned` `medium` `feature` `#local-38`
  Beat → artifact card (transcript/translation/image/source/reliability). Library of artifacts → anchored stories.

Done when: a story shows inline citations; tap reveals grounding + reliability; you can browse artifacts to their anchored stories.

## LATER — S3: Multi-POV · S4: Witness mode

The two strong modes, once grounding is first-class. PRDs: [`prd/s3-multi-pov.md`](prd/s3-multi-pov.md), [`prd/s4-witness-mode.md`](prd/s4-witness-mode.md).

- **S3.1 — `story_people` cast join (+ people enrichment)** `planned` `medium` `feature` `#local-39`
  Many stories per moment; a person's role per story. Leverages S1's `povType` / `primaryPersonId`.
- **S3.2 — POV-constrained generation (epistemic vantage)** `planned` `medium` `feature` `#local-40`
  Generate a person's version grounded in shared artifacts, limited to what they could know; prior POVs passed in to avoid paraphrase.
- **S3.3 — POV switcher + "Add a perspective" + person thread** `planned` `medium` `feature` `#local-41`
  Switch eyes on a moment; sketch/pick a person; follow one person across moments.
- **S4.1 — `interior_monologues` (anchored to a segment)** `planned` `medium` `feature` `#local-42`
  Unique on (person, segment) — the contextual-thought cache key.
- **S4.2 — Lazy-generate-on-tap + cache** `planned` `medium` `feature` `#local-43`
  Tap person@beat → lookup or generate (grounded in scene + artifacts) → store; later taps free.
- **S4.3 — Witness UX: tappable people → interior aside** `planned` `medium` `feature` `#local-44`
  Present cast is tappable; interiors render distinct from narration; manual light→deep promotion.

Done when: ≥2 grounded POVs per moment switchable; tap a person mid-beat → cached, contextual interior in their voice.

## Deferred — parked (local-first / single-user; no money yet)

Schema *hooks* exist; no committed phase. Story-era hooks first, then the original commercialization deferrals.

- **S5 — Users + signal: `users`, `user_story_progress`, `user_interior_taps`, `user_saved_stories`** `planned` `low` `feature` `#local-45`
  The engagement signal that would *automate* light→deep promotion (which interiors users actually cared about). Unlocks only with a multi-user posture — which would supersede the single-user guardrail.
- **H.1 — Council / conversation mode** `planned` `low` `feature` `#local-46`
  `conversations` + participants + messages — persona-constrained threaded dialogue (people talking *to each other*). Different shape than narration.
- **H.2 — Branching / CYOA** `planned` `low` `feature` `#local-47`
  `choice_points` + `choice_outcomes`. Multiplies content cost — only after witness proves out.
- **H.3 — Generation game (procedural lives)** `planned` `low` `feature` `#local-48`
  `life_event_templates` + `life_phases`. A separate product/domain.
- **H.4 — Diary drip** `planned` `low` `feature` `#local-49`
  Thin `subscriptions` + cron over `artifacts` where `artifact_type = 'diary_entry'`. Mostly scheduling, not schema.
- **D.1 — Cloud SaaS, hosted models, workspaces/teams/roles, billing** `planned` `low` `feature` `#local-20`
- **D.2 — Proactive industry-mapping agent, scheduled jobs, signal ingestion, weekly briefings, integrations** `planned` `low` `feature` `#local-21`
- **D.3 — Public read-only sharing, enterprise SSO/audit logs** `planned` `low` `feature` `#local-22`

---

## Substrate (shipped) — the timeline canvas, now the navigation layer

> Built and verified at the data layer (typecheck + production build + data-layer/contract tests green). After the pivot, this is the **map you navigate stories from**, not the headline product. One thing still owed regardless of the pivot: a live in-browser UI pass (the Claude Preview can't hydrate the dev server; needs a normal browser + an `OPENROUTER_API_KEY`).

### Phase 0 — The magic moment (the canvas loop)

Smallest thing that proves the core loop. No auth, no undo, single timeline.

- **0.1 — Scaffold runnable app + SQLite/Drizzle wired** `done` `high` `chore` `#local-1`
  TanStack Start + React Flow + AI SDK + Drizzle skeleton boots to a legible canvas + chat shell.
- **0.2 — AI chat loop: streamText + tools, multi-step in one turn** `done` `high` `feature` `#local-2`
  `src/routes/api/chat.ts`: `streamText` with `makeTools` + `stopWhen(stepCountIs(16))`, returns `toUIMessageStreamResponse()`.
- **0.3 — Wire ChatPanel to /api/chat (useChat), refetch graph on finish** `done` `high` `feature` `#local-3`
  `useChat` posts to `/api/chat`; `onFinish` invalidates the `['graph', id]` query so the canvas refetches.
- **0.4 — Render the real graph on the canvas (replace sample data)** `done` `high` `feature` `#local-4`
  Canvas loads via the `getGraph` server fn (TanStack Query); date→x placement, type lanes, typed edges.
- **0.5 — Persist nodes/edges to SQLite (single `default` timeline)** `done` `high` `feature` `#local-5`
  Tools write straight through to better-sqlite3; the DB is the source of truth.

✅ **Phase 0 complete.** Plumbing verified (typecheck clean, route 200, seeded graph renders on the canvas). Needs `OPENROUTER_API_KEY` in `.env` to drive a live AI turn.

### Phase 1 — The lovable core (build / edit / undo / multi-timeline)

What makes it a product you return to.

- **1.1 — Full 6-tool set (update/delete node + edge)** `done` `medium` `feature` `#local-6`
  Delivered in Phase 0 — all six tools (add/update/delete × node/edge) are live.
- **1.2 — Patch model: PatchBuilder + patches table + atomic commit + undo/redo + ⌘Z/⌘⇧Z** `done` `high` `feature` `#local-7`
  The core invariant: one user turn = one atomic, undoable Patch (forward + inverse ops). Verified at the data layer (commit/undo/redo/truncate). `src/lib/db/patches.ts`.
- **1.3 — Multi-timeline: timelines CRUD, home list, `/timelines/$id`** `done` `medium` `feature` `#local-8`
  Home list at `/` (create / rename / delete / open). `src/lib/server/timelines.ts`, CRUD in `src/lib/db/graph.ts`. Delete cascades nodes/edges/patches.
- **1.4 — Node detail view: click → edit fields, view/edit citations, see relations** `done` `medium` `feature` `#local-9`
  Click a node → `NodeDetailPanel` edits title/summary/date/precision/end + citations, and lists the node's **relations** (connected edges, colored by kind, click to jump to the other node). Saves via `editNode`/`deleteNode` (`src/lib/server/nodes.ts`) as **one undoable Patch** — manual edits reuse the AI's commit path, so ⌘Z reverts them.
- **1.5 — Canvas polish: lane collision spreading, zoom-synced ruler, enter animation + fitView easing, edge styling by kind** `done` `medium` `improvement` `#local-10`
  `layoutLaneY` spreads same-lane overlaps onto rows; `TimeRuler` tracks pan/zoom; fitView easing; node fade-in; per-kind edge dash/width.
- **1.6 — Better Auth single local user gating the app** `open` `low` `feature` `#local-11`
  Not a usefulness blocker in local-first mode — it's a gate, not a delight. Pair with self-host (2.5) rather than blocking v1.
- **1.7 — Citations rendered as footnote links; AI encouraged to cite** `done` `low` `feature` `#local-12`
  Citations surfaced in the graph DTO, count badge on nodes, footnote links in the detail panel.
- **1.8 — Multi-model config (default one provider via env)** `open` `low` `improvement` `#local-13`
- **1.9 — Chat/turn persistence per timeline** `done` `high` `feature` `#local-23`
  `messages` table + `db/messages.ts` (load/save) + `server/messages.ts`; `/api/chat` persists the full transcript in `toUIMessageStreamResponse` onFinish; `ChatPanel` seeds `useChat` from it via a `DefaultChatTransport` carrying `timelineId` — which also **fixed a latent bug**: turns were posting to `'default'` regardless of the open timeline. Save/load + cascade verified at the data layer.
- **1.10 — Turn feedback + error surfacing** `done` `high` `feature` `#local-24`
  Chat shows a "Thinking…/Building…" status while a turn runs, and an error banner (Retry + Dismiss) on failure via useChat `error`/`regenerate`/`clearError`; `toUIMessageStreamResponse` `onError` surfaces real messages instead of the masked default. Verified the server returns a 400 with guidance for a missing `OPENROUTER_API_KEY` (the banner's fallback also names the key).

Done when: you can build, correct (with undo safety), revisit, and trust multiple timelines.
**Status:** build / edit / undo / multi-timeline are in — verified via typecheck + clean production build + data-layer tests. **Still owed for a _complete_ substrate:** an in-browser UI pass (the Claude Preview couldn't hydrate the dev server).

### Phase 2 — Lovable polish & self-host (still pre-money)

- **2.1 — Optimistic per-tool canvas updates (stream tool-call parts)** `done` `high` `improvement` `#local-14`
  Route-level `BuildStreamProvider` shares in-flight `add_node` tool inputs from the chat to the canvas; `TimelineCanvas` renders translucent pulsing "pending" nodes (refit via `FitOnPending`), cleared after the commit refetch. Inert without a live stream. **Live behavior unverified** — needs `OPENROUTER_API_KEY` + a browser that hydrates.
- **2.2 — Export: Markdown/JSON structured export (PNG/SVG deferred)** `done` `high` `feature` `#local-15`
  Pure `toJSON`/`toMarkdown` transforms (`src/lib/domain/export.ts`) + download buttons on the canvas; timeline title threaded through the graph DTO. Verified at the data layer (9/9). **PNG/SVG image export deferred** — needs a canvas-image lib + a browser to verify; tracked as `#local-25`.
- **2.7 — Image export: SVG + PNG** `done` `medium` `feature` `#local-25`
  Dep-free pure `toSVG(graph)` (`src/lib/domain/export.ts`) — lanes, edges (arrow marker), nodes, date axis, XML-escaped. PNG rasterized in-browser from the (untainted) SVG via `Image`+`canvas`. ExportControls now offers JSON · Markdown · SVG · PNG. SVG/escape verified at the data layer (no html-to-image dependency). PNG download is browser-only.
- **2.8 — Multimodal prompt input (attach images + documents)** `done` `medium` `feature` `#local-26`
  📎 attach in **both** the timeline chat input **and** the home prompt bar (home files stash via `src/lib/pending-attachments.ts` → consumed by the first turn). Files become data-URL `FileUIPart`s via `src/lib/files.ts`; transcript renders thumbnails/chips; persisted with the turn. Image support solid via Claude/OpenRouter; PDF/text handling is model/gateway-dependent. Live behavior unverified (needs key + browser).
- **2.9 — Node images: attach + show selected on the timeline** `done` `medium` `feature` `#local-27`
  Detail panel **Images** section (upload → data-URL, per-image "show" toggle, remove) stored in `node.metadata.images`; canvas renders the shown images as a thumbnail strip on the node. Saved as one undoable Patch (metadata merge keeps citations). Merge+undo verified at the data layer.
- **2.10 — Node resize (small / medium / large)** `done` `low` `improvement` `#local-28`
  Detail panel **Size** selector → `node.metadata.size`; node root gets `sf-size-*` scaling font + image sizes.
- **2.11 — Cleaner layout + motion** `done` `medium` `improvement` `#local-29`
  `layoutLaneY` is now **height-aware**: it estimates each node's height (size + image strip) and stacks rows by real heights, then chains lanes top→bottom so nothing overlaps or bleeds between lanes (verified 6/6). Motion: dropped the count-based remount (`key` is now just `timelineId`) so nodes keep identity and **glide** via a `transform` transition on `.react-flow__node`; an imperative `AutoFit` re-frames on count change instead of remounting. Glide/fit are browser-only to confirm.
- **2.12 — Node detail panel v2 (read-first doc) + node color** `done` `medium` `improvement` `#local-30`
  Redesigned `NodeDetailPanel` Notion/Figma-style: big doc title + description (read view, click to edit, one field at a time), compact property rows (Date/End/Size/**Color**), section dividers, relations as pills. New **color** property (uses `metadata.color`) — swatch picker, accents the node border + title dot on the canvas. Color set/clear/undo verified at the data layer; explicit Save still commits one Patch.
  **Live preview:** the panel publishes an id-stamped `NodeDraft` that the canvas overlays on the selected node (title/date→position/size/color/images update as you type) — never persisted until **Save**; closing or canceling drops the draft and the node snaps back. No DB write on cancel, so it reverts for free.
- **2.3 — Lens filtering when a chat question is active** `done` `medium` `feature` `#local-16`
  Non-mutating `focus` tool (`ai/tools.ts`) + prompt guidance: when the user asks a *question* about the timeline, the AI answers and flags the relevant node ids instead of editing. `focusIds` rides the build-stream context (derived from the last assistant message's `tool-focus` part); the canvas dims non-focused nodes/edges, rings the focused ones (amber), and shows a "Lens · N · Clear" chip. A build turn (no focus) auto-clears it. Lens behavior needs a live turn + browser to confirm.
- **2.4 — Keyboard-first navigation + command palette** `planned` `low` `feature` `#local-17`
- **2.5 — Postgres migration + single Docker Compose (self-host bridge)** `planned` `medium` `chore` `#local-18`
- **2.6 — Telemetry opt-in (self-hoster count)** `planned` `low` `feature` `#local-19`

## Won't do (this cycle)

Mobile, real-time multi-cursor collaboration.
