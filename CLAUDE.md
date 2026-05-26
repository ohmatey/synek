# Strata

**Strata** (product/display name: *Chronograph*) is a temporally-anchored **knowledge canvas**, driven from **outside via an MCP server**. The app holds no AI of its own: you connect your own MCP client (Claude Desktop / Claude Code) with an API key, and that client's model creates and manages a visual mesh of typed nodes and relationships along a horizontal timeline. The canvas is the output and viewer; your MCP client is how you build it.

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
| AI | **None in-app.** Intelligence comes from the user's MCP client. The app exposes an MCP server (`@modelcontextprotocol/sdk`) — HTTP at `/api/mcp` + a stdio binary |
| DB | SQLite via Drizzle (`drizzle-orm/better-sqlite3` — Vite SSR runs under **Node**, so *not* `bun:sqlite`). **Postgres is deferred** — keep the schema portable |
| Auth | **Better Auth** (single local user), `bearer` plugin. The credential is a long-lived session token (Better Auth 1.6 has no api-key plugin) sent as `Authorization: Bearer <token>`; mint with `bun run issue:key` |
| Validation | Zod v4 |

## Project structure

```
src/
  router.tsx                       getRouter()
  routes/
    __root.tsx                     html doc; QueryClientProvider + React Flow/global CSS
    index.tsx                      home: list timelines + create-and-open
    timelines.$id.tsx              app shell: the canvas (full-width viewer)
    api/mcp.ts                     MCP endpoint (Streamable HTTP), guarded by requireApiKey
    api/auth/$.ts                  Better Auth catch-all handler
  components/
    client-only.tsx                mount-guard for client-only libs
    canvas/
      TimelineCanvas.tsx           React Flow; loads the graph via TanStack Query
      NodeDetailPanel.tsx          read/edit a node (manual edits → one Patch); citations + image upload
      HistoryControls.tsx          undo/redo buttons + ⌘Z / ⌘⇧Z
      useTimelineScale.ts          date → x, type → lane y
      nodes/{EventNode,EntityNode,PeriodNode,PersonCard}.tsx
      types.ts                     CanvasNodeData
  lib/
    domain/{types,dates}.ts        NodeType/EdgeKind/Precision + graph DTOs; fuzzy dates
    db/{index,schema,graph}.ts     better-sqlite3 client, Drizzle schema, graph load/ensure
    db/patches.ts                  PatchBuilder + apply/invert + commit/undo/redo
    db/auth-schema.ts              Better Auth tables (user/session/account/verification)
    server/{graph,patches,nodes,timelines}.ts   client RPCs for the viewer
    mcp/{server,ops,http}.ts       MCP server factory, batch-op logic, HTTP transport
    auth/{index,guard}.ts          Better Auth instance + bearer-token guard
  mcp/stdio.ts                     standalone stdio MCP server (run via tsx)
drizzle/                           generated migrations (committed)
```

## Data model (`src/lib/db/schema.ts`)

`timelines`, `nodes`, `edges`, `patches`. Kept Postgres-portable: app-generated `text` ids (`crypto.randomUUID()`), JSON via `text({ mode: 'json' })`, system time via `integer({ mode: 'timestamp_ms' })`.

**Domain time** (the axis) is a sortable `integer` instant (epoch-ms, negative = BCE) + a `precision` enum (`year|quarter|month|day`) — history needs fuzzy/ancient dates ("Q3 2008", "49 BCE"), not a JS `Date`. Events have `endInstant = null`; entities/periods set a span.

## The Patch invariant (the core mechanic)

**One logical edit = one atomic, undoable Patch.** A batch of ops accumulates in an in-memory `PatchBuilder` — **nothing touches the DB mid-batch**. A single SQLite transaction then applies the ops and writes one `patches` row holding both forward `ops` and precomputed `inverseOps`. Undo/redo is a per-timeline linear stack (`seq` + `status`); a new patch truncates the redo branch. `GraphOp` lives in `schema.ts`. **Built** in `src/lib/db/patches.ts` (PatchBuilder, apply/invert, commit/undo/redo); undo/redo exposed via `src/lib/server/patches.ts` and bound to ⌘Z/⌘⇧Z in `HistoryControls`. Both the MCP `apply_patch` tool and manual edits in `NodeDetailPanel` go through this same path.

## MCP server (`src/lib/mcp/`, `src/routes/api/mcp.ts`, `src/mcp/stdio.ts`)

The app exposes one MCP server (`buildMcpServer()` in `mcp/server.ts`) over **two transports** sharing all logic: Streamable HTTP at `/api/mcp` (stateless, fresh server+transport per request — `mcp/http.ts` via the SDK's `WebStandardStreamableHTTPServerTransport`) and a stdio binary (`mcp/stdio.ts`, run with `bun run mcp:stdio`). Tools: `list_timelines`, `create_timeline`, `get_timeline`, `apply_patch`, `undo`, `redo`; plus a read-only `strata://timeline/{id}` resource. **All writes go through `apply_patch`** — one call carries a batch of ops (`add_node`/`update_node`/`delete_node`/`add_edge`/`update_edge`/`delete_edge`) and commits as **one Patch**. Within a batch, `ref` on an `add_node` aliases the new id so a later `add_edge` can wire to it (`mcp/ops.ts` resolves refs). Both transports validate `Authorization: Bearer <token>` via Better Auth before any tool runs (`auth/guard.ts`). Clients are encouraged to **cite freely**; citations are stored in `node.metadata.citations`.

## Canvas conventions

React Flow is **client-only** — always render it behind `<ClientOnly>` (SSR touches `window`). Node x-position derives from date (`instantToX`); y is the type lane (`LANE_Y`). Nodes are non-draggable (position is owned by the data). `nodeTypes` is module-level (memoized). Edges are colored by `kind` with an arrow marker.

## Commands

```bash
bun run dev          # dev server on http://localhost:3001 ($PORT overrides; generates src/routeTree.gen.ts)
bun run dev:test     # seeded test instance: PORT=3001 + DATABASE_URL=e2e.db
bun run build        # production build
bun run typecheck    # tsc --noEmit
bun run db:generate  # generate a migration from schema.ts
bun run db:migrate   # apply migrations (also applied on server start, idempotent)
bun run db:push      # push schema to the DB without a migration (dev)
bun run db:seed      # seed example timelines (all, or one: bun run db:seed space-race)
bun run seed:e2e     # seed the e2e.db file used by Playwright
bun run test:e2e     # Playwright e2e (needs: bunx playwright install chromium)
bun run issue:key    # mint the local user + print the bearer token (the "API key")
bun run mcp:stdio    # run the standalone stdio MCP server (for Claude Desktop, etc.)
bun run verify:mcp   # data-layer check of the apply_patch → Patch → undo/redo path
```

## Env (`.env.example`)

- `DATABASE_URL` — SQLite file (default `local.db`)
- `PORT` — dev server port (default `3001`)
- `BETTER_AUTH_SECRET` — set a real secret outside local dev (`openssl rand -base64 32`)
- `BETTER_AUTH_URL` — auth base URL (default `http://localhost:3001`)
- `STRATA_API_KEY` — the bearer token your MCP client sends; mint with `bun run issue:key`. Used by the stdio server.

## Current status

**MCP inversion is built.** The app is a pure timeline **viewer + MCP server**; all intelligence comes from the user's MCP client. Connect a client to `http://localhost:3001/api/mcp` (or the stdio binary) with `Authorization: Bearer <token>` and it creates/manages timelines via `apply_patch` (one call = one undoable Patch). Verified end-to-end: `bun run verify:mcp` (data layer), plus live HTTP + stdio `initialize`/`tools/list`/`apply_patch`/`get_timeline`/`resources/list`, and the 401 path.

**Runtime note (don't reintroduce `bun:sqlite`):** Vite's SSR module loader runs under **Node**, so the DB uses `better-sqlite3`. Run the app with `bun run dev`. To seed or script the DB outside the server, run under Node (e.g. `bunx tsx script.ts`) — Bun can't load better-sqlite3's Node-ABI binary. The stdio MCP server also runs under tsx for this reason. **Run only one primary writer at a time** (app OR stdio) — both open `local.db` (WAL + `busy_timeout` make reads safe). `@tanstack/react-start` is pinned to **1.168.11** (1.168.12 has a virtual-module regression — TanStack/router#7486).

**Story/illustration layer is dormant.** Server-side story generation and node illustration were removed with the in-app AI; their tables (`stories`, `story_segments`, `people`, `generations`, `prompt_templates`) remain in the schema, inert, so the capability can be re-exposed as MCP tools later (see `.can/`).
