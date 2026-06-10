---
project: "Synek"
syncedAt: 2026-06-09T00:00:00.000Z
---

# Synek Roadmap

> Offline source of truth for Sal. **Core UX first — most lovable product before any thought of money.**
> **Scope guardrail:** This repo is the single-user, local-first Core. Cloud/SaaS, teams, billing, public sharing, hosted models, scheduled jobs, and integrations are explicitly deferred (see **Deferred** below) until the core feels undeniable. See `CLAUDE.md` for the full guardrail.
> **Hosting is the eventual destination** (see **Hosting horizon** below). We build nothing hosted yet, but architectural decisions should be *hosting-aware*: every "the user brings their own X" in the local Core (model, key, DB, secrets) is the local-first shape of a managed, metered service later. Pick local-first defaults that have a clean hosted upgrade path — don't pick ones that have to be torn out.

---

## Status — reconciled 2026-06-10

> Commits outran the last MCP sync (06-09). Verified against code, not the prose below:

| Critical-path step | State |
|---|---|
| NOW.0 Stoicism seed | ✅ Shipped (`db:seed stoicism`, c50ad39) |
| NOW.1 `npx synek` installer | ✅ Shipped (`bun run setup`, ef43bd9) |
| NOW.2 Handoff + login | ✅ Shipped — N.2.1 viewer URL already returned by `create_timeline`; N.2.2 instructions now frame "spatial memory" + share-the-link **and** introduce `write_story`. OAuth + login prior. |
| NOW.3 Live canvas (SSE) | ✅ Shipped — bus + SSE route (prior) + `useTimelineStream` client (N.3.3), arrival animation reused (N.3.4), graceful polling fallback (N.3.5: 10s baseline for stdio + 2s on SSE drop). Data-layer/build verified; live in-browser pass still owed. |
| NOW.4 Visual warmth | 🟡 Subtypes + per-subtype cards + **era tint (N.4.3)** + **Claude-sourced images on `apply_patch` (N.4.5a)** shipped; **generated illustrations (N.4.5b)** deferred. |
| NOW.5 Stories as MCP tools | ✅ Shipped (minimal slice) — `write_story` (N.5.1), playback reader (N.5.2), depth badge (N.5.3), instructions (N.5.4). Data-layer verified (`bun run verify:story`). Undo-restores-story follow-up now **FIXED** (StorySnapshot on add_node across the FK cascade, `00b8365`; `bun run verify:story-undo`). |

---

## North Star

> **Claude open on the left, Synek open on the right. The user talks to Claude about a topic — say, Stoicism. On the right, a timeline builds itself in near-real-time, with stories.**

This is the single bet. Every item on this roadmap earns its place by serving that recording. The demo milestone is a screen-recording: a 60-second side-by-side of a user typing "map Stoicism for me" into Claude, and watching the canvas populate — faces, events, a story on tap — while it happens.

**Positioning:** Synek is Claude's spatial memory. It's where your research lives, visually and permanently.

---

## Critical path (in sequence)

The hero experience has five hard dependencies. Each one blocks the next demo checkpoint.

```
[1] CLI installer         → [2] Link handoff + login     → [3] Live canvas updates
                                                            ↓
                                                   [4] Visual warmth (VIS)
                                                            ↓
                                                   [5] Stories as MCP tools (S1)
```

**[1] CLI installer** — collapse the 6–8 step setup into `npx synek`. Nothing else matters if the on-ramp is brutal.
**[2] Link handoff + login** — Claude creates the timeline and returns a link; the user clicks, authenticates (single-user, NOT multi-tenant), and the canvas loads.
**[3] Live canvas updates** — the canvas streams patch arrivals in near-real-time. **This is the hardest architectural unlock** — see the open question below.
**[4] Visual warmth** — faces not boxes; the canvas makes an emotional impression before anyone taps into a story.
**[5] Stories as MCP tools** — Claude can write a story onto a moment via `apply_patch`/new tools; the canvas plays it back.

The demoable checkpoint between [3] and [4] is already valuable: a live-building graph, even cold gray boxes, proves the concept. But nobody returns to a cold diagram. Ship [4] tight against [3].

---

## NOW — Get to the demo recording

Everything here ladders to one artifact: the 60-second Stoicism screen-recording.

### NOW.0 — Stoicism seed (`bun run db:seed stoicism`) — ✅ SHIPPED (c50ad39)

*Why:* The demo needs real content now. A technically-correct but blank canvas is the highest-likelihood reason a first viewer bounces. This is the cheapest de-risking experiment and it unblocks all visual/story work.

- **N.0.1** — Seed script: ~15 events/entities (key Stoics, founding moments, texts), BCE dates, edges representing influence and succession
- **N.0.2** — At least 5 Wikimedia portrait URLs on person nodes (Zeno, Epictetus, Marcus Aurelius, Seneca, Chrysippus) — offline-safe (remote URLs fine for seed, per VIS PRD)
- **N.0.3** — Wired into `bun run db:seed stoicism`; `dev:test` uses it via `e2e.db`

No PRD code. New. Precondition for every visual and story milestone below.

### NOW.1 — CLI installer (`npx synek`) — ✅ SHIPPED (ef43bd9, `bun run setup`)

*Why:* Setup friction is the single biggest drop-off before a user ever sees the product. The hero experience doesn't begin until the canvas is open.

- **N.1.1** — `npx synek` (or `bunx synek`) scaffolds local SQLite, `.env`, and mints the bearer token in one step
- **N.1.2** — Prints the MCP config snippet (endpoint URL + token) ready to paste into Claude Desktop or `claude_desktop_config.json`
- **N.1.3** — First-run auto-seeds the Stoicism timeline so the canvas isn't blank

Maps to: KEYS front-door work (PRD `prd/mcp-api-keys.md`) — the CLI is the on-ramp the KEYS PRD assumed but didn't specify.

### NOW.2 — Link handoff + login (single-user auth) — ✅ SHIPPED (seam: N.2.1 url + N.2.2 instructions)

*Why:* Claude creates a timeline and needs to hand the user off to the viewer. Right now there's no clean "here's your link" moment. This is the seam between Claude's left panel and Synek's right panel.

> **Guardrail note:** this is single-user bearer-token auth, NOT multi-tenant. "Login" means the local user authenticates to their own local instance. No accounts, no OAuth, no teams. The link is `http://localhost:PORT/timelines/<id>` with a session cookie or bearer redirect. Do not let this look like user-facing account infrastructure.

- **N.2.1** — MCP `create_timeline` returns the full viewer URL in the result
- **N.2.2** — MCP `instructions` field updated: the system prompt Claude receives describes Synek as "your spatial memory" and tells Claude to share the link after creating a timeline
- **N.2.3** — Better Auth front-door polish (KEYS PRD `prd/mcp-api-keys.md`): named/listable/revocable keys replacing the opaque session-token flow. Auto-seeds a "Default" key on first run.
- **N.2.4** — Login page: when an unauthenticated user hits `/timelines/<id>`, they see a minimal login prompt (bearer token paste or session), then land on the timeline

Maps to: KEYS (PRD `prd/mcp-api-keys.md`, status: built at the data layer; UX owed).

### NOW.3 — Live canvas updates (streaming patches to the viewer) — ✅ SHIPPED (N.3.3–N.3.5; live in-browser pass owed)

*Why:* This is the technical unlock that makes "watch it build" real. Without it, the user refreshes manually and the magic doesn't exist. This is the biggest architectural question on the critical path.

> **Decision (founder, 2026-06-09): go with (B) Server-Sent Events.** Near-real-time is the point — a 1–2s polling lag is exactly the lag that breaks the "watch it build" magic the hero demo is selling. Build SSE first; keep polling only as the graceful-degradation fallback (N.3.5). The candidate approaches that were on the table, for the record:
>
> **(A) Polling** — viewer polls `GET /api/timelines/:id/patches?after=<seq>` every 1–2s. Zero new infrastructure, works with the single-writer model. Latency: ~1–2s. *Rejected as the primary path; retained as fallback.*
>
> **(B) Server-Sent Events (SSE) — CHOSEN** — server pushes patch events over a long-lived SSE connection. Requires a shared event bus between the write path and the SSE handler (an in-process `EventEmitter` works for single-process; breaks with multiple workers — acceptable for the single-user local Core). Latency: near-real-time. Compatible with TanStack Start.
>
> **(C) WebSocket** — full duplex; heaviest to implement; no benefit over SSE for this use case (viewer is read-only). *Rejected.*
>
> **Resolve first — the single-writer constraint:** the MCP client and the web server cannot both hold the DB open as primary writers. WAL mode is already on and `busy_timeout` is set, so the SSE server reading while the HTTP MCP endpoint writes is safe — but a left-running **stdio** server during a browser demo is not. For the live demo, drive writes through the **HTTP MCP endpoint** (same process as the viewer, so the in-process `EventEmitter` bus works), not stdio.

- **N.3.1** — In-process patch event bus: an `EventEmitter` (or equivalent) that the commit path (`commitPatch` in `src/lib/db/patches.ts`) emits to after each patch lands, carrying `{ timelineId, seq, ops }`
- **N.3.2** — `GET /api/timelines/:id/events` SSE endpoint: subscribes to the bus, streams patch ops for that timeline as they commit. Replays anything after a client-supplied `Last-Event-ID` / `?after=<seq>` so a reconnect never drops a patch
- **N.3.3** — `useTimelineStream(id)` viewer hook (`EventSource`): merges incoming nodes/edges into the React Flow graph incrementally — no full refetch, no layout thrash. Seeds from the initial `useQuery(['graph', id])` load, then applies the live delta
- **N.3.4** — New nodes animate in (existing fade-in animation, already shipped) so the build looks live
- **N.3.5** — Graceful fallback: on SSE connection failure, fall back to polling `GET /api/timelines/:id/patches?after=<seq>` (1–2s) so the viewer still converges if the stream drops

### NOW.4 — Visual warmth (VIS — faces not boxes) — 🟡 PARTIAL (subtypes + cards + era tint N.4.3 + Claude-sourced images N.4.5a shipped; generated illustrations N.4.5b deferred)

*Why:* The demo screenshot/recording lives or dies on the visual first impression. A cold gray box diagram of correct Stoic philosophers is not something anyone screenshots or shares. VIS is supporting work for the hero moment — it makes the canvas do emotional work before a story is tapped.

Maps to: VIS PRD (`prd/visual-immersion.md`, status: proposed).

- **N.4.1** — Entity subtypes (`person` / `org` / `place` / `work`) on nodes: `metadata.subtype` field; AI suggests on `add_node`/`update_node`, user overrides in detail panel. Mirrors `color`/`size` pattern (already shipped).
- **N.4.2** — Per-subtype canvas cards: `PersonCard` leads with a framed portrait; org gets a logo lockup; event/place/work get their own visual treatment. Consistent framing (no decapitated portraits, no stretched logos).
- **N.4.3** — Era tint: `PeriodNode` carries a faint background tint derived from the period's date range — the mood of the age reads at a glance.
- **N.4.4** — Seed imagery renders offline: Wikimedia URLs for the Stoicism seed; data-URL fallback for generated images. Demo never shows broken images.
- **N.4.5a** — ✅ SHIPPED — Claude-sourced images via `apply_patch`: `add_node`/`update_node` take an `images: [{ url, alt?, show? }]` field (`src/lib/mcp/ops.ts`). Claude web-searches for a real, web-accessible image (Wikimedia portrait, official logo, public-domain art) and passes the URL; Synek stores + renders it (`show` defaults `true` → it appears on the canvas). On `update_node` the array **replaces** the node's images; omit to leave them untouched. MCP `instructions` now tell Claude to give nodes a face. **Zero generation cost, no new API key — the pure inversion (Claude sources, Synek stores).** Storage + render already existed; this opened the MCP seam. Data-layer verified (`bun run verify:mcp` — incl. default-show + replace semantics).
- **N.4.5b** — DEFERRED (within NOW) — *generated* illustrations for nodes with **no** sourceable image: an image-model call (gpt-image-1 or equivalent) → one undoable Patch, provenance + cache, labelled "illustration, not a photograph." Off the demo critical path (Stoicism has real portraits) and the only piece with a real per-image **cost**. **Local-first shape:** bring-your-own key in `.env` (provider-agnostic `SYNEK_IMAGE_*`), graceful error when absent, no settings UI — the user is already the host, so "the user pays" is the default, not new infra. **Hosted shape:** the same call moves behind a metered/billed service (see *Hosting horizon* → *Deferred D.1*). Revisit only when a real timeline can't be illustrated from sourced images.

Non-goals from VIS PRD apply: no deep entity ontology, no stock-photo pipeline, no video/audio, no theming engine.

### NOW.5 — Stories as MCP tools (S1, minimal slice) — ✅ SHIPPED (N.5.1–N.5.4; undo-restores-story follow-up FIXED in `00b8365`)

*Why:* The hero experience ends with "with stories." Without the story layer, Synek is a well-organized diagram. With it, Synek is a place where ideas become narratives. This is a thin vertical slice — one story per moment, no citations yet.

Maps to: S1 story spine PRD (`prd/s1-story-spine.md`, status: schema + data layer built, dormant since MCP inversion).

> **Architecture note:** story generation is NOT a graph Patch. The `stories`/`story_segments`/`people`/`generations`/`prompt_templates` tables are already in the schema (dormant). Re-expose generation as MCP tools that Claude calls directly (Claude has the model; Synek stores the output). The generation service (`generateStory`) was built server-side — rewire it so the MCP client sends the story content as structured data, and Synek stores + plays it back. Alternatively: a new `write_story` MCP tool that accepts pre-generated story content (beats + text) and commits it to the dormant tables. No in-app model call needed.

- **N.5.1** — `write_story` MCP tool: accepts `nodeId` + array of beats (kind + text + optional citations). Writes to `stories`/`story_segments` tables. One atomic operation; not a graph Patch (separate provenance).
- **N.5.2** — Story playback UI on the canvas: tap a node with a story → beat-by-beat reader in the node-detail slot. Existing S1.4 playback infrastructure (built, dormant) re-activated.
- **N.5.3** — Depth badge: a visual indicator on nodes that have a story vs. those that don't. Draws the eye toward moments that have been written.
- **N.5.4** — MCP `instructions` updated: tell Claude it can write stories onto moments after building the timeline.

---

## NEXT — Make it feel like a product

Ship after the demo recording is made. These deepen the experience for users who come back.

### NEXT.1 — Artifact grounding (S2 — the moat)

*Why:* Stories without sources are Claude-generated plausible fiction. Sources are the defensibility layer — the gap between Synek and "just ask Claude in a chat window." Every beat cites a real document.

Maps to: S2 PRD (`prd/s2-artifact-grounding.md`). Depends on N.5 (stories exist).

- **S2.0 — ✅ SHIPPED (slice 1, inline grounding)** — `write_story` beats take an optional `citations: { title, url?, quote? }[]` (same shape as node citations), persisted as a JSON column on `story_segments` (no join table — deferred until artifact reuse is real) and rendered inline under each beat in `NodeDetailPanel`. Postgres-portable; undo/redo-faithful (the moment-delete snapshot spreads the full segment row). Migration `0012`. Data-layer verified (`bun run verify:story` — incl. title+url+quote round-trip, title-only, empty, rewrite clears). Full normalized model (S2.1–S2.4 below) still deferred; backfill path documented in the PRD.
- S2.1 — `sources` + `artifacts` tables (BCE-safe `dateInstant`)
- S2.2 — `story_artifacts` + `segment_citations` joins
- S2.3 — Grounded generation: `write_story` v2 accepts artifact references; beats name their source
- S2.4 — Inline citation UX: tap a beat sentence → artifact card (transcript/image/reliability)

Done when: a story shows inline citations; tap reveals grounding; you can browse artifacts to their anchored stories.

### NEXT.2 — In-canvas search + keyboard navigation

*Why:* Once a timeline has 30+ nodes, "where is Marcus Aurelius" becomes a real question. Absence of search is the single biggest friction for a returning user.

Maps to: 2.4 from the old substrate roadmap (`#local-17`, planned).

- Full-text search over node titles/summaries; results highlight and pan to the node
- Keyboard-first navigation: `⌘K` command palette, arrow keys to step through a filtered set

### NEXT.3 — Multi-POV stories (S3 — same moment, different eyes)

*Why:* One POV is a story. Two POVs is an argument. Three POVs is history. This is the mode that makes Synek distinctive.

Maps to: S3 PRD (`prd/s3-multi-pov.md`). Depends on S2 (grounding makes multiple POVs honest).

- S3.1 — `story_people` cast join; person role per story
- S3.2 — POV-constrained generation (epistemic vantage; prior POVs passed to avoid paraphrase)
- S3.3 — POV switcher on the canvas; "Add a perspective" affordance

### NEXT.4 — Postgres + self-host path (2.5)

*Why:* SQLite is fine for single-user local. But a meaningful cohort of technical users will want to self-host with a real DB. This is the pre-money self-host bridge — not SaaS.

Maps to: 2.5 from the old substrate roadmap (`#local-18`, planned).

- Drizzle adapter swap (schema is already Postgres-portable)
- Single Docker Compose (app + Postgres + auto-migration on start)
- `bun run issue:key` works in the Docker context

---

## LATER — Strong mode

Ship when NEXT is solid and the product earns the right to go deeper.

### LATER.1 — Witness mode (S4 — inside their heads)

*Why:* The witness POV is the highest-empathy experience — you read a moment from inside a person's head. It requires grounded multi-POV (S2 + S3) to be honest.

Maps to: S4 PRD (`prd/s4-witness-mode.md`). Depends on S2 + S3.

- S4.1 — `interior_monologues` (anchored to a segment; unique on person + segment)
- S4.2 — Lazy-generate-on-tap + cache
- S4.3 — Witness UX: tappable people in the cast → interior aside, distinct from narration

### LATER.2 — Living Timelines (L — per-timeline agentic keeper)

*Why:* A timeline that stays current as the world changes (competitor moves, tech releases, ongoing events) is a fundamentally different product from a static historical map. But this is the agentic/scheduled-jobs territory the CLAUDE.md guardrail flags until the core is undeniable.

**Flagship Watcher use-cases** (the demo-able instances of this mode):
- **Competitor Watcher** — a market/landscape timeline that stays current as competitors ship, raise, pivot, or get acquired.
- **Model-release Watcher** — a timeline of frontier LLM/AI model releases that adds each new model as it drops (Claude, GPT, Gemini, open-weights), with capability/price deltas as edges.

Maps to: L roadmap items (`#local-50` through `#local-55`). Depends on S2 (artifacts are how the agent stays grounded). Stays **local-first** — no cloud cron, no hosted runner.

**Gating:** does not start until S1 + S2 feel lovable and the demo recording is made.

- L.1 — `timeline_agents` schema + per-timeline config (kind, cadence, scope brief, source allowlist, budget cap)
- L.2 — Agent run model: `agent_runs` + proposed-Patch review queue (approve → undoable Patch; reject → discard). Preserves the Patch invariant.
- L.3 — Local-first runner: "Run now" button first; opt-in interval daemon second
- L.4 — Grounded research/ingestion: agent gathers signal → lands as S2 `artifacts`
- L.5 — Agent personas: Historian (deepen/correct a past timeline) · Watcher (keep an ongoing one current)
- L.6 — Agent dashboard: status, run history, proposal review, budget/cost

### LATER.3 — Telemetry opt-in

Maps to: 2.6 (`#local-19`, planned). Self-hoster count; fully opt-in.

---

## Hosting horizon — acknowledged, not yet built

> **Synek will be a hosted product.** Local-first is the *discipline* that forces a lovable Core, not the final destination. Nothing hosted gets built before the demo and a lovable Core (the scope guardrail stands), but the Core is designed so the hosted version is an upgrade, not a rewrite. This section records the carry-forward intent so today's decisions don't paint us into a local-only corner.

**Design rule:** every "bring your own X" in the local Core is the local-first shape of a managed service later. Prefer local-first defaults with a clean hosted upgrade path.

| Local Core (today) | Hosted shape (later, D.1) |
|---|---|
| User's own MCP client + model (the whole inversion) | Unchanged — the user's Claude stays the brain; we host the canvas + storage, not a model |
| Bearer token in `.env`, single local user | Real accounts/sessions (Better Auth already at the data layer); the bearer seam stays for MCP |
| SQLite file, single writer | Postgres (schema already kept portable — **NEXT.4** is the bridge); per-tenant isolation |
| **N.4.5b** generated images = BYO `SYNEK_IMAGE_*` key | Same call behind a **metered/billed** image service — the cost question this raised is a *hosted* concern, solved with metering, not local plumbing |
| Local in-process SSE bus | Same protocol; needs a shared bus (Redis/PG LISTEN) once there's >1 process/worker |

**What this does NOT license now:** no accounts UI, no billing, no multi-tenant tables, no hosted cron. Those remain in **Deferred** until the Core earns it. The point is only that when we cross that line, the seams are already in the right places.

---

## Deferred — parked (local-first / single-user; no money yet)

Schema hooks exist where noted; no committed phase.

- **D.1 — Cloud SaaS, hosted models, workspaces/teams/roles, billing** `#local-20` — the destination sketched in **Hosting horizon** above; includes the metered/billed image service that **N.4.5b** defers.
- **D.2 — Proactive industry-mapping agent, scheduled jobs, signal ingestion, weekly briefings, integrations (Slack/Notion/etc.)** `#local-21`
  The local-first variant is specced as **L: Living Timelines** (LATER.2). This stub covers the cloud/hosted-cron and weekly-briefing variants that land only with a multi-user/SaaS posture.
- **D.3 — Public read-only sharing, enterprise SSO/audit logs** `#local-22`
- **S5 — Users + signal: `user_story_progress`, `user_interior_taps`, `user_saved_stories`** `#local-45`
  Engagement signal that automates light→deep promotion. Unlocks only with a multi-user posture.
- **H.1 — Council / conversation mode** `#local-46`
  `conversations` + participants + messages — persona-constrained threaded dialogue. Different shape than narration.
- **H.2 — Branching / CYOA** `#local-47`
  `choice_points` + `choice_outcomes`. Multiplies content cost — only after witness proves out.
- **H.3 — Generation game (procedural lives)** `#local-48`
  A separate product/domain.
- **H.4 — Diary drip** `#local-49`
  Thin `subscriptions` + cron over `artifacts` where `artifact_type = 'diary_entry'`.
- **Keyboard-first navigation + command palette** `#local-17` → promoted to NEXT.2
- **Mobile, real-time multi-cursor collaboration** — Won't do this cycle.

---

## Substrate (shipped) — the timeline canvas

> Built and verified at the data layer (typecheck + production build + data-layer/contract tests green). This is the **map** the hero experience runs on. One thing still owed regardless of other work: a live in-browser UI pass (Claude Preview can't hydrate the dev server; needs a normal browser session).

All prior Phase 0, Phase 1, Phase 2 items remain shipped at the data layer. Highlights relevant to the critical path:

- **MCP inversion** — built + verified. `list_timelines`, `create_timeline`, `get_timeline`, `apply_patch`, `undo`, `redo`. Both HTTP (`/api/mcp`) and stdio transports. Bearer-token auth guard.
- **Patch invariant** — one turn = one atomic undoable Patch. ⌘Z/⌘⇧Z wired. Manual edits and MCP writes go through the same path.
- **Canvas** — React Flow, client-only. Date→x placement, type lanes, edge styling by kind, node color/size/image, lane collision spreading, glide animation.
- **Better Auth** — single local user; session token flow. KEYS PRD (api-keys table, named/revocable) is built at the data layer; UI owed.
- **Exports** — JSON, Markdown, SVG, PNG (data-layer verified; PNG is browser-only).
- **Stories/people/generations schema** — in the DB, dormant since MCP inversion. Ready to re-activate via NOW.5.
