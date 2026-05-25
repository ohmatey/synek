---
project: "Strata"
syncedAt: 2026-05-25T00:00:00.000Z
---

# Strata Roadmap

> Offline source of truth for Sal. **Core UX first — most lovable product before any thought of money.**
> **Goal:** make the magic moment — *type a prompt, watch an AI build a credible, time-placed timeline on a canvas* — undeniable, then make it lovable to live in.

## NOW — Phase 0: The magic moment

Smallest thing that proves the core loop. No auth, no undo, single timeline.

- **0.1 — Scaffold runnable app + SQLite/Drizzle wired** `done` `high` `chore` `#local-1`
  TanStack Start + React Flow + AI SDK + Drizzle skeleton boots to a legible canvas + chat shell.
- **0.2 — AI chat loop: streamText + add_node/add_edge, multi-step in one turn** `open` `high` `feature` `#local-2`
  Implement `src/routes/api/chat.ts`: load graph, `streamText` with `makeTools(builder)` + `stopWhen(stepCountIs(n))`, return `toUIMessageStreamResponse()`. ← **smallest unblocked pick**
- **0.3 — Wire ChatPanel to /api/chat (useChat), refetch graph on finish** `open` `high` `feature` `#local-3`
  Deps: 0.2. Replace the shell form with `useChat`; invalidate the graph query when a turn completes.
- **0.4 — Render the real graph on the canvas (replace sample data)** `open` `high` `feature` `#local-4`
  Deps: 0.2. Load nodes/edges from the DB; keep date→x placement and type lanes.
- **0.5 — Persist nodes/edges to SQLite (single `default` timeline)** `open` `high` `feature` `#local-5`
  Deps: 0.2. Tools write through to the DB; the DB is the source of truth.

Done when: "map the history of observability tooling" produces a correctly time-placed mesh.

## NEXT — Phase 1: The lovable core

What makes it a product you return to.

- **1.1 — Full 6-tool set (update/delete node + edge)** `open` `medium` `feature` `#local-6`
- **1.2 — Patch model: PatchBuilder + patches table + atomic commit + undo/redo + ⌘Z/⌘⇧Z** `open` `high` `feature` `#local-7`
  The core invariant: one user turn = one atomic, undoable Patch (forward + inverse ops). See CLAUDE.md.
- **1.3 — Multi-timeline: timelines CRUD, home list, `/timelines/$id`** `open` `medium` `feature` `#local-8`
- **1.4 — Node detail view: click → edit fields, view/edit citations** `open` `medium` `feature` `#local-9`
- **1.5 — Canvas polish: lane collision spreading, zoom-synced ruler, enter animation + fitView easing, edge styling by kind** `open` `medium` `improvement` `#local-10`
- **1.6 — Better Auth single local user gating the app** `open` `medium` `feature` `#local-11`
- **1.7 — Citations rendered as footnote links; AI encouraged to cite** `open` `low` `feature` `#local-12`
- **1.8 — Multi-model config (default one provider via env)** `open` `low` `improvement` `#local-13`

Done when: you can build, correct (with undo safety), revisit, and trust multiple timelines.

## LATER — Phase 2: Lovable polish & self-host (still pre-money)

- **2.1 — Optimistic per-tool canvas updates (stream tool-call parts)** `planned` `low` `improvement` `#local-14`
- **2.2 — Export: PNG/SVG of view + Markdown/JSON structured export** `planned` `medium` `feature` `#local-15`
- **2.3 — Lens filtering when a chat question is active** `planned` `low` `feature` `#local-16`
- **2.4 — Keyboard-first navigation + command palette** `planned` `low` `feature` `#local-17`
- **2.5 — Postgres migration + single Docker Compose (self-host bridge)** `planned` `medium` `chore` `#local-18`
- **2.6 — Telemetry opt-in (self-hoster count)** `planned` `low` `feature` `#local-19`

## Deferred — parked until the core is lovable (no thought of money yet)

Real per the PRD (§5–8), but explicitly out of scope until Phase 0–1 feel undeniable.

- **D.1 — Cloud SaaS, hosted models, workspaces/teams/roles, billing** `planned` `low` `feature` `#local-20`
- **D.2 — Proactive industry-mapping agent, scheduled jobs, signal ingestion, weekly briefings, integrations** `planned` `low` `feature` `#local-21`
- **D.3 — Public read-only sharing, enterprise SSO/audit logs** `planned` `low` `feature` `#local-22`

## Won't do (this cycle)

Mobile, real-time multi-cursor collaboration.
