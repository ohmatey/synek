# Strata

**Strata** (product/display name: *Chronograph*) is a temporally-anchored, AI-generated **knowledge canvas**. You type into a chat; an AI builds a visual mesh of typed nodes and relationships along a horizontal timeline — capturing how a field, industry, or technology evolved. The canvas is the output; the chat is the way you talk to it.

## Scope guardrail — read before adding anything

**Core UX only. Most lovable product before any thought of money.** This repo is the single-user, local-first **Core**. The following are **deliberately out of scope** and must NOT be added until the core feels undeniable (they live in `.can/roadmap.md` → Deferred):

- Cloud/SaaS, hosted models, billing
- Workspaces, teams, roles, multi-tenant
- The proactive industry-mapping agent, scheduled jobs, signal ingestion, weekly briefings
- Integrations (Slack/Notion), public sharing, enterprise SSO/audit logs

If a change starts to look like one of these, stop and confirm. The product earns the right to commercialize by being lovable first.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start (SSR + server functions + file routing) + TanStack Query |
| UI / runtime | React 19, Bun, Vite |
| Canvas | React Flow (`@xyflow/react` v12) — **client-only** |
| AI | Vercel **AI SDK v6** (`ai`, `@ai-sdk/react`), provider via `@ai-sdk/openai` pointed at OpenRouter |
| DB | SQLite via Drizzle (`drizzle-orm/bun-sqlite`). **Postgres is deferred** — keep the schema portable |
| Auth | Better Auth, single local user — **Phase 1, not yet wired** |
| Validation | Zod v4 |

## Project structure

```
src/
  router.tsx                       getRouter()
  routes/
    __root.tsx                     html doc; imports React Flow + global CSS
    index.tsx                      → redirects to /timelines/default
    timelines.$id.tsx              app shell: canvas (left) + chat (right)
    api/chat.ts                    AI engine (server route) — STUB until Phase 0
  components/
    client-only.tsx                mount-guard for client-only libs
    canvas/
      TimelineCanvas.tsx           React Flow; sample data until Phase 0
      useTimelineScale.ts          date → x, type → lane y
      nodes/{EventNode,EntityNode,PeriodNode}.tsx
      types.ts                     CanvasNodeData
    chat/{ChatPanel,MessageList}.tsx   shell; useChat lands in Phase 0
  lib/
    domain/types.ts                NodeType, EdgeKind, Precision (+ GraphOp re-export)
    db/{index,schema}.ts           bun:sqlite client + Drizzle schema
    ai/{provider,tools,prompt}.ts  model gateway, the 6 tools, system prompt
drizzle/                           generated migrations (committed)
```

## Data model (`src/lib/db/schema.ts`)

`timelines`, `nodes`, `edges`, `patches`. Kept Postgres-portable: app-generated `text` ids (`crypto.randomUUID()`), JSON via `text({ mode: 'json' })`, system time via `integer({ mode: 'timestamp_ms' })`.

**Domain time** (the axis) is a sortable `integer` instant (epoch-ms, negative = BCE) + a `precision` enum (`year|quarter|month|day`) — history needs fuzzy/ancient dates ("Q3 2008", "49 BCE"), not a JS `Date`. Events have `endInstant = null`; entities/periods set a span.

## The Patch invariant (the core mechanic)

**One user turn = one atomic, undoable Patch.** Each AI turn's tool calls accumulate in an in-memory `PatchBuilder` — **nothing touches the DB mid-stream**. After the stream resolves, a single SQLite transaction applies the ops and writes one `patches` row holding both forward `ops` and precomputed `inverseOps`. Undo/redo is a per-timeline linear stack (`seq` + `status`); a new patch truncates the redo branch. `GraphOp` lives in `schema.ts`. (Builder + undo logic: Phase 1, `src/lib/db/patches.ts`.)

## AI loop (`src/routes/api/chat.ts`, Phase 0)

Load the timeline graph → `streamText({ model: model(), system: systemPrompt(), messages, tools: makeTools(builder), stopWhen: stepCountIs(n) })` → on finish, commit the builder as one Patch in a transaction → return `result.toUIMessageStreamResponse()`. The DB is the source of truth; the client refetches the graph after a turn. Six tools: `add_node`, `update_node`, `delete_node`, `add_edge`, `update_edge`, `delete_edge` (`src/lib/ai/tools.ts`). The model is encouraged to **cite freely**; citations are stored in `node.metadata.citations`.

## Canvas conventions

React Flow is **client-only** — always render it behind `<ClientOnly>` (SSR touches `window`). Node x-position derives from date (`instantToX`); y is the type lane (`LANE_Y`). Nodes are non-draggable (position is owned by the data). `nodeTypes` is module-level (memoized). Edges are colored by `kind` with an arrow marker.

## Commands

```bash
bun run dev          # dev server on http://localhost:3000 (generates src/routeTree.gen.ts)
bun run build        # production build
bun run typecheck    # tsc --noEmit
bun run db:generate  # generate a migration from schema.ts
bun run db:migrate   # apply migrations (also applied on server start, idempotent)
```

## Env (`.env.example`)

- `OPENROUTER_API_KEY` — the default model gateway (Core is bring-your-own-key)
- `STRATA_MODEL` — OpenRouter model slug (default `anthropic/claude-sonnet-4-6`)
- `DATABASE_URL` — SQLite file (default `local.db`)

## Current status (the init boundary)

Scaffold + data model + stubs are in place and the app boots to a legible **shell** (a canvas with sample nodes + a chat panel). **Not yet built** (these are the roadmap phases in `.can/roadmap.md`): the live `streamText` tool loop, the PatchBuilder/undo system, node detail, multi-timeline, auth, and canvas polish. Build them with `/sal build`.
