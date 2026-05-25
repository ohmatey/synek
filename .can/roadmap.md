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
- **0.2 — AI chat loop: streamText + tools, multi-step in one turn** `done` `high` `feature` `#local-2`
  `src/routes/api/chat.ts`: `streamText` with `makeTools` + `stopWhen(stepCountIs(16))`, returns `toUIMessageStreamResponse()`.
- **0.3 — Wire ChatPanel to /api/chat (useChat), refetch graph on finish** `done` `high` `feature` `#local-3`
  `useChat` posts to `/api/chat`; `onFinish` invalidates the `['graph', id]` query so the canvas refetches.
- **0.4 — Render the real graph on the canvas (replace sample data)** `done` `high` `feature` `#local-4`
  Canvas loads via the `getGraph` server fn (TanStack Query); date→x placement, type lanes, typed edges.
- **0.5 — Persist nodes/edges to SQLite (single `default` timeline)** `done` `high` `feature` `#local-5`
  Tools write straight through to better-sqlite3; the DB is the source of truth.

✅ **Phase 0 complete.** Plumbing verified (typecheck clean, route 200, seeded graph renders on the canvas). Needs `OPENROUTER_API_KEY` in `.env` to drive a live AI turn. **NEXT → Phase 1** (to be parallel-batched).

## NEXT — Phase 1: The lovable core

What makes it a product you return to.

- **1.1 — Full 6-tool set (update/delete node + edge)** `done` `medium` `feature` `#local-6`
  Delivered in Phase 0 — all six tools (add/update/delete × node/edge) are live.
- **1.2 — Patch model: PatchBuilder + patches table + atomic commit + undo/redo + ⌘Z/⌘⇧Z** `done` `high` `feature` `#local-7`
  The core invariant: one user turn = one atomic, undoable Patch (forward + inverse ops). Verified at the data layer (commit/undo/redo/truncate). `src/lib/db/patches.ts`.
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
