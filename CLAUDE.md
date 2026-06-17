# Synek

**Synek** (product/display name: *Chronograph*) is a temporally-anchored **knowledge canvas**, driven from **outside via an MCP server**. By default the app holds **no AI of its own**: you connect your own MCP client (Claude Desktop / Claude Code) with an API key, and that client's model creates and manages a visual mesh of typed nodes and relationships along a horizontal timeline. The canvas is the output and viewer; your MCP client is how you build it. **Progressive enhancement:** when an `OPENROUTER_API_KEY` is configured, the same in-app prompt dialogs gain a **Run** that executes server-side against the *same* tool surface — the canvas builds itself live, no external client needed (`src/lib/agent/`). This is opt-in and key-gated; with no key set the BYO-client inversion is unchanged. The posture is **local-first pure app** — anyone downloads it and runs it locally with their own MCP client; **cloud is a deploy mode** (the same codebase behind the Phase-2 multi-tenant auth), not a separate product. There is **no landing page and no public discovery feed**: the root `/` is the signed-in workspace (see the pure-app cull below, ADR 0005).

## Scope guardrail — read before adding anything

**Core UX first. Most lovable product before billing.** **Posture (2026-06-17, founder — pure-app cull):** Synek is a **local-first pure app** anyone can download and run locally with their own MCP client / local model; **cloud is a deploy mode**, not a separate product. There is no landing page and no public discovery surface. An **optional, key-gated in-app agent stays IN scope** (the OpenRouter "Run" path, Phase 1; `src/lib/agent/`). The following remain **deliberately out of scope** until earned (they live in `docs/product/roadmap.md` → Deferred / Hosting horizon; the gate is in `docs/product/product-strategy.md`):

- ~~Multi-tenant hosting~~ **Phase 2 BUILT (2026-06-14, uncommitted):** per-user isolation (every artifact/timeline/story/history read owner-scoped — see `verify:isolation`), open signup + email verification & password reset via Resend (`src/lib/auth/email.ts`), per-user **BYO OpenRouter key** encrypted at rest (`src/lib/crypto/secrets.ts` + `user_settings`), and a Fly.io single-instance deploy (`fly.toml` + `docs/engineering/deploy-fly.md`). Still optional: pointing the plugin at a hosted URL by default
- Billing / metering of agent + image usage (**Phase 3**, still deferred)
- Workspaces, teams, roles (still deferred — Phase 2 is per-user isolation only)
- The proactive industry-mapping agent / scheduled jobs / signal ingestion as an **in-app** service (the *client-side* keeper is the `/synek:watch` plugin skill)
- Integrations (Slack/Notion), enterprise SSO/audit logs

**Sharable stories are now IN scope (2026-06-13, founder)** — the public, mobile, widget-rich story page at `/s/$slug` (`src/components/public/`, `getPublicStory`), to validate the *sharing-drives-acquisition* bet (ads + email). It reuses the existing `timeline.isPublic` primitive (sharing a story publishes its timeline). **Still deferred:** the weekly email digest, server-side image generation, and realtime SSE on public pages. See `docs/product/prd/sharable-stories.md`.

**Public discovery was CULLED (2026-06-17, founder)** — this reverses the 2026-06-16 "public discovery in scope" decision. The cross-user **Explore feed is removed**: `src/components/explore/`, `src/lib/server/explore.ts`, the `listPublic*` reads in `src/lib/db/{stories,graph}.ts`, and the dead marketing cluster (`Landing`/`HeroPreview`/`SiteFooter`) were all **deleted**. The root `/` is now the signed-in **workspace** (`ProjectsWorkspace`), auth-gated. **Per-story sharing stays IN scope** (unchanged) — the public, no-auth `/s/$slug` page (`getPublicStory`, `src/components/public/`) and the in-reader Share button are untouched; sharing narrows from "browse a feed" to "share a link." Decision: [ADR 0005](docs/engineering/adr/0005-cull-public-discovery.md).

If a change starts to look like one of these, stop and confirm. The in-app agent stays **optional** — with no key configured, the BYO-client local-first default must remain fully intact.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start (SSR + server functions + file routing) + TanStack Query |
| UI / runtime | React 19, Bun, Vite |
| Components | **shadcn/ui** (new-york, Radix + CVA) in `src/components/ui/`, on **Tailwind v4**. `cn()` in `src/lib/utils.ts`. Semantic tokens + light/dark theme live in `@synek/ui` (`packages/ui` — `tokens.css` aliases shadcn's `--background`/`--primary`/… onto the brand palette; `ThemeProvider` drives `[data-theme]`). Toasts via `sonner` |
| Canvas | React Flow (`@xyflow/react` v12) — **client-only** |
| AI | **None in-app by default** — intelligence comes from the user's MCP client. The app exposes an MCP server (`@modelcontextprotocol/sdk`) — HTTP at `/api/mcp` + a stdio binary. **Optional in-app agent** (`src/lib/agent/`, key-gated on `OPENROUTER_API_KEY`): an in-process OpenRouter function-calling loop over the **same** tool registry the MCP server uses (`src/lib/mcp/registry.ts`), reachable from the prompt dialogs' "Run" button via the `runAgent` server fn |
| DB | SQLite via Drizzle (`drizzle-orm/better-sqlite3` — Vite SSR runs under **Node**, so *not* `bun:sqlite`). **Postgres is deferred** — keep the schema portable |
| Auth | **Better Auth** (multi-user since Phase 2 — was single local user), `bearer` plugin. The credential is a long-lived session token (Better Auth 1.6 has no api-key plugin) sent as `Authorization: Bearer <token>`; mint with `bun run issue:key`. Open email/password signup with email verification + password reset via Resend (`src/lib/auth/email.ts`; no-ops without `RESEND_API_KEY`). Every data path is **owner-scoped** (per-user isolation); per-user settings (incl. the encrypted BYO OpenRouter key) live in `user_settings` |
| Validation | Zod v4 |

## Project structure

```
src/
  router.tsx                       getRouter()
  routes/
    __root.tsx                     html doc; QueryClientProvider + React Flow/global CSS
    index.tsx                      root /: the signed-in WORKSPACE (ProjectsWorkspace) — auth-gated, owner-scoped. No landing page, no Explore feed (pure-app cull, ADR 0005). ?project=<slug> shows that project's ProjectHero + rows; bare = the projects-LIST page. Login lands here
    projects.tsx                   redirect-only → / (kept so old /projects links/bookmarks resolve, preserving ?project)
    timelines.$id.tsx              app shell: the canvas (full-width viewer)
    s.$slug.tsx                    PUBLIC, no-auth sharable story page (/s/$slug) — SSR OG + reels reader (per-story sharing — KEPT)
    p.$slug.tsx                    PUBLIC, no-auth project handle (/p/$slug) — owner-scoped resolver → /?project=<slug>
    api/mcp.ts                     MCP endpoint (Streamable HTTP), guarded by requireApiKey
    api/auth/$.ts                  Better Auth catch-all handler
  components/
    client-only.tsx                mount-guard for client-only libs
    ProfileMenu.tsx                avatar dropdown; opens the tabbed SettingsDialog (Account / API keys)
    account/SettingsDialog.tsx     consolidated settings modal (tabs reuse AccountPanel/ApiKeysPanel/AgentKeyCard); /account + /api-keys routes remain as deep-link fallbacks
    home/ProjectsWorkspace.tsx     the root `/` workspace: projects-list grid + per-project view; brings the global AppHeader; auth-gated
    home/cinematic/                workspace pieces: ProjectHero (project-page hero), ProjectCard (list-page grid), CinematicHero (new-creator empty), HomeContentRow (carousels), StoryCard/EntityCard/TimelineCard, NewProjectDialog, MoveToProjectSubmenu (HomeSidebar removed — nav moved to the AppHeader Projects button)
    brand/                         brand-kit editor (P2b): BrandManagerDialog → BrandEditor (Identity/Visual/Voice tabs) + ProjectBrandLink; local kits on Realscript's brand schema
    public/                        PublicStoryReader + ShareStoryButton + widgets/{BeatWidget,Timeline/Entity/GlobeMini}
    public/widgets/                live per-beat widgets resolved from node ids (globe lazy d3-geo)
    canvas/
      TimelineCanvas.tsx           React Flow; loads the graph via TanStack Query; immersive story playback drives the lens (globe/timeline) per beat
      NodeDetailPanel.tsx          read/edit a node (manual edits → one Patch); citations + image upload
      StoriesMenu.tsx              toolbar Stories popover panel: lists the timeline's stories + "New Story" (replaced the Stories lens tab)
      HistoryShortcuts.tsx         headless ⌘Z / ⌘⇧Z undo/redo (the visible toolbar buttons were removed)
      useTimelineScale.ts          date → x, type → lane y
      nodes/{EventNode,EntityNode,PeriodNode,PersonCard}.tsx
      types.ts                     CanvasNodeData
  lib/
    domain/{types,dates}.ts        NodeType/EdgeKind/Precision + graph DTOs; fuzzy dates
    db/{index,schema,graph}.ts     better-sqlite3 client, Drizzle schema, graph load/ensure
    db/projects.ts                 Projects CRUD + ensureDefaultProject + makeRequireOwnedProject (owner guard)
    db/brands.ts                   local brand-kit CRUD (Realscript brand schema) + setProjectBrand + makeRequireOwnedBrand
    db/patches.ts                  PatchBuilder + apply/invert + commit/undo/redo
    db/auth-schema.ts              Better Auth tables (user/session/account/verification)
    server/{graph,patches,nodes,timelines}.ts   client RPCs for the viewer
    server/projects.ts             project RPCs: list/create/get(+BySlug)/rename/delete/setTheme/moveTimelineToProject
    server/brands.ts               brand RPCs: list/create/get/update/delete + setProjectBrand + getProjectBrandId
    mcp/{server,ops,http}.ts       MCP server factory, batch-op logic, HTTP transport
    auth/{index,guard}.ts          Better Auth instance + bearer-token guard
  mcp/stdio.ts                     standalone stdio MCP server (run via tsx)
drizzle/                           generated migrations (committed)
docs/                              strategy, roadmap, PRDs (product/), ADRs (engineering/) — index: docs/README.md
.sector137/state.json              Sal's offline work queue (issue ids #local-N)
```

## Data model (`src/lib/db/schema.ts`)

`timelines`, `nodes`, `edges`, `patches`. Kept Postgres-portable: app-generated `text` ids (`crypto.randomUUID()`), JSON via `text({ mode: 'json' })`, system time via `integer({ mode: 'timestamp_ms' })`. **Multi-tenant (Phase 2):** every owned row carries an `ownerId` FK to `user` — `timelines`, `api_keys`, and (migration 0019) `artifacts` + `sources`. Reads are owner-scoped at the entry points (server fns + the MCP tool registry's `ctx.ownerId`); the `db/*` layer takes ids and trusts its guarded caller.

**Projects — the top-level container (P1 stories-first pivot, migration 0020).** A `projects` table sits above timelines; `timelines`/`artifacts`/`sources` gain a **nullable** `projectId` FK (migration 0020 reuses 0019's nullable-add + owner-scoped backfill shape — no NOT-NULL rebuild; `ensureDefaultProject` gives every owner one default). `ownerId` remains the **only** security boundary — `projectId` is org-narrowing within an owner (reads narrow when a `projectId`/`?project=slug` is present, else span all). Project fields: owner-scoped, a global-unique `slug` (slugify-then-dedupe), `kind` (`nonfiction` default; `fiction` is a P4-additive seam), `world` (null = real Earth, P4 seam), `brandRef` (opaque remote Realscript brand id, by contract — P2) / `brandId` (local Synek brand kit FK), and `theme` (same `TimelineTheme` shape as `timelines.theme`; timelines **inherit at read time** — `timeline.theme ?? project.theme ?? defaults` — so no new timeline column). Decision: [ADR 0003](docs/engineering/adr/0003-projects-container.md). The cinematic home filters by project via `?project=<slug>`; `moveTimelineToProject` reassigns (double owner-check, fail-closed, **not** a Patch — project membership is metadata, not graph state). `user_settings` (one row per user) holds the per-user **encrypted** OpenRouter key (`openRouterKeyEnc`, AES-GCM via `lib/crypto/secrets.ts`) + chosen `agentModel`. `timelines.viewSettings` is a JSON column holding the owner-saved default time-axis scale (`{ pxPerDay, collapseGaps }`), applied on open when a device has no local override; set via the `setTimelineView` RPC from the canvas's display-settings popover. `timelines.theme` is a sibling JSON column holding the timeline's own visual theme (`TimelineTheme` in `domain/types.ts`: freeform per-scheme hex accents + canvas wash, curated display font, texture, plus AI-facing `imageStyle`/`mood`); replace-on-write, null clears, NOT in the Patch stack — set via the `setTimelineTheme` RPC (theme editor in the display-settings popover) or the MCP `set_timeline_theme` tool, shared Zod contract in `domain/theme.ts`.

**Domain time** (the axis) is a sortable `integer` instant (epoch-ms, negative = BCE) + a `precision` enum (`year|quarter|month|day`) — history needs fuzzy/ancient dates ("Q3 2008", "49 BCE"), not a JS `Date`. Events have `endInstant = null`; entities/periods set a span.

## The Patch invariant (the core mechanic)

**One logical edit = one atomic, undoable Patch.** A batch of ops accumulates in an in-memory `PatchBuilder` — **nothing touches the DB mid-batch**. A single SQLite transaction then applies the ops and writes one `patches` row holding both forward `ops` and precomputed `inverseOps`. Undo/redo is a per-timeline linear stack (`seq` + `status`); a new patch truncates the redo branch. `GraphOp` lives in `schema.ts`. **Built** in `src/lib/db/patches.ts` (PatchBuilder, apply/invert, commit/undo/redo); undo/redo exposed via `src/lib/server/patches.ts` and bound to ⌘Z/⌘⇧Z in `HistoryShortcuts` (headless; the visible undo/redo buttons were removed from the toolbar). Both the MCP `apply_patch` tool and manual edits in `NodeDetailPanel` go through this same path.

## MCP server (`src/lib/mcp/`, `src/routes/api/mcp.ts`, `src/mcp/stdio.ts`)

The tool surface itself lives in a **transport-agnostic registry** (`mcp/registry.ts` — `toolRegistry`: each tool is `{ name, title, description, inputSchema (Zod), handler(args, ctx) }`, handlers return the raw object). Two consumers wrap it: `buildMcpServer()` in `mcp/server.ts` (adds the analytics `register` wrapper + the `{content:[{text}]}` envelope) and the **in-app agent runner** (`src/lib/agent/runner.ts`, OpenRouter function-calling — Zod→JSON-Schema). One tool surface, two callers, so the BYO-client and the in-app "Run" agent are always identical.

The app exposes one MCP server (`buildMcpServer()` in `mcp/server.ts`) over **two transports** sharing all logic: Streamable HTTP at `/api/mcp` (stateless, fresh server+transport per request — `mcp/http.ts` via the SDK's `WebStandardStreamableHTTPServerTransport`) and a stdio binary (`mcp/stdio.ts`, run with `bun run mcp:stdio`). Tools: `create_project`, `list_projects`, `get_project` (the Projects container — handlers carry `ctx.projectId` alongside `ctx.ownerId`), `list_timelines`, `create_timeline`, `get_timeline` (full graph — large), `query_timeline` + `get_node` (context-cheap filtered/single-node reads), `get_layout_report` (whole-graph shape review: lane health + near-duplicate lane names, axis dead zones, era/story coverage, source registry, compact node index — `src/lib/mcp/layout-report.ts`), `apply_patch`, `set_timeline_view`, `set_timeline_theme` (freeform per-scheme theme + AI image-style metadata; returns WCAG-contrast `warnings` — `src/lib/mcp/theme-warnings.ts`; `create_timeline` also takes an optional `theme`), `write_story`, `undo`, `redo`; plus a read-only `synek://timeline/{id}` resource. **All writes go through `apply_patch`** — one call carries a batch of ops (`add_node`/`update_node`/`delete_node`/`add_edge`/`update_edge`/`delete_edge`) and commits as **one Patch**; it returns `warnings` (broken image URLs, dead citation links, lane density, axis outliers — `src/lib/mcp/warnings.ts`; 429/403/timeouts report as *unverified*, not broken) and a `graphSummary` tally. Nodes take optional `lane`, `location`, images, and citations (`url` encouraged + verified; optional `sourceType`). `write_story` takes a `cast` (node-backed or name-only members), a `coverImage`, per-beat `image` with a `layout` (full/inset-left/inset-right/bleed), an optional per-beat `widget` (a LIVE mini `timeline`/`globe`/`entity` from node ids — `story_segments.widget` JSON, migration 0018 — rendered as the hero visual on the sharable `/s/$slug` page), and an optional per-beat `lens` (`globe`/`timeline`, `story_segments.lens`, migration 0022 — the **immersive** camera choreography: while the docked reader plays, the canvas switches surface per beat — explicit `lens`, else auto from whether the beat's focus node is located. So a story alternates a place beat on the globe with a time/idea beat on the timeline). It returns `warnings` for dangling node ids / node-less cast names / broken image URLs / unresolvable widget ids. Within a batch, `ref` on an `add_node` aliases the new id so a later `add_edge` can wire to it (`mcp/ops.ts` resolves refs). Both transports validate `Authorization: Bearer <token>` via Better Auth before any tool runs (`auth/guard.ts`). Clients are encouraged to **cite freely**; citations are stored in `node.metadata.citations`.

## Brand layer (Realscript companion — P2)

Synek is the **companion app to Realscript** (a brand / short-form-content platform). The brand layer is **inversion-true** — no Synek↔Realscript server coupling:

- **P2a — cross-MCP brand stories** (`synek-plugin/skills/brand-story/SKILL.md`). With BOTH the Synek and Realscript (`real`) plugins connected in the user's own client, their Claude reads a brand via Realscript's `get_brand_kit(format="llm")` MCP tool and writes the Synek story on-brand via `write_story` (+ optional `set_timeline_theme`). **Zero app code** — pure dogfood of Realscript's MCP from an external client.
- **P2b — local brand kits + editor.** A `brands` table (owner-scoped, migration 0021, additive) stores a kit on **Realscript's brand schema** mirrored in `src/lib/domain/brand.ts` (identity · palette · fonts · the structured `voiceSchema` · guidelines). `projects.brandId` links a kit to a project. CRUD in `db/brands.ts` + `server/brands.ts` (owner-scoped; `setProjectBrand` double-owner-checks project AND brand). The tabbed editor (`src/components/brand/`: `BrandManagerDialog` → `BrandEditor` + `ProjectBrandLink`) opens from the cinematic-home project rail. **Local authoring only** — no Realscript fetch/key/MCP/sync.
- **P2c — brand sync (deferred).** A server-side fetch Realscript→Synek to populate a local kit is later, and **must** route through the SSRF egress guard (`src/lib/net/ssrf.ts`, `REALSCRIPT_BASE_URL` https-only). See `docs/product/roadmap.md` → P2.

## Canvas conventions

React Flow is **client-only** — always render it behind `<ClientOnly>` (SSR touches `window`). Node x-position derives from date (`instantToX`); y is the type lane (`LANE_Y`). Nodes are non-draggable (position is owned by the data). `nodeTypes` is module-level (memoized). Edges are colored by `kind` with an arrow marker.

## Commands

```bash
bun run setup        # one-step on-ramp: writes .env (generates a secret), migrates, seeds Stoicism, mints an MCP key (stdio path), prints how to connect Claude Code (OAuth) / Desktop (stdio). `--start` also boots dev. (scripts/synek.ts)
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
- `SYNEK_LOCAL_MODE` — set to `1` to skip the login wall: the app auto-signs-in the deterministic local user (`SYNEK_USER_EMAIL`) on the SSR document so a local download is straight in. **OFF by default; NEVER set on a multi-tenant/cloud deploy** (it would sign every visitor in as the one shared local user). Server-only gate (`src/lib/auth/local-mode.ts`); the session is minted in `src/lib/server/local-session.ts` and wired into `__root` `beforeLoad`. `SYNEK_USER_EMAIL`/`SYNEK_USER_PASSWORD` set the local identity (shared with `bun run issue:key`).
- `SYNEK_API_KEY` — the bearer token your MCP client sends; mint with `bun run issue:key`. Used by the stdio server.
- `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` — **optional** PostHog browser analytics (canvas/home engagement). Blank = disabled. Host defaults to US cloud. Capture is gated on the key being present **and** the per-user opt-out in `/account` (opt-out, default ON). Helper: `src/lib/posthog/client.ts`; bootstrap: `src/components/Analytics.tsx`.
- `POSTHOG_API_KEY` / `POSTHOG_HOST` — **optional** PostHog server analytics for the MCP layer (one `mcp_tool_called` event per tool call, enriched for `apply_patch`/`write_story`). Blank = disabled (operator-gated by key presence). Helper: `src/lib/posthog/server.ts`; wired via a `register` wrapper in `src/lib/mcp/server.ts`, flushed in `mcp/http.ts` (per request) and `mcp/stdio.ts` (on shutdown).

## Current status

**MCP inversion is built.** The app is a pure timeline **viewer + MCP server**; all intelligence comes from the user's MCP client. Connect a client to `http://localhost:3001/api/mcp` (or the stdio binary) with `Authorization: Bearer <token>` and it creates/manages timelines via `apply_patch` (one call = one undoable Patch). Verified end-to-end: `bun run verify:mcp` (data layer), plus live HTTP + stdio `initialize`/`tools/list`/`apply_patch`/`get_timeline`/`resources/list`, and the 401 path.

**Runtime note (don't reintroduce `bun:sqlite`):** Vite's SSR module loader runs under **Node**, so the DB uses `better-sqlite3`. Run the app with `bun run dev`. To seed or script the DB outside the server, run under Node (e.g. `bunx tsx script.ts`) — Bun can't load better-sqlite3's Node-ABI binary. The stdio MCP server also runs under tsx for this reason. **Run only one primary writer at a time** (app OR stdio) — both open `local.db` (WAL + `busy_timeout` make reads safe). `@tanstack/react-start` is pinned to **1.168.11** (1.168.12 has a virtual-module regression — TanStack/router#7486).

**Stories are the product (stories-first pivot, 2026-06-14).** Synek is now positioned as a tool for creating immersive, **serialized stories** — and the companion app to Realscript. The story layer is the centerpiece, **not** dormant: `write_story` (MCP) writes a story onto a moment; the docked + public reader (`/s/$slug`) plays it back with live per-beat widgets; the **cinematic stories-first home** (`src/components/home/cinematic/`) leads with featured stories. The live `stories` / `story_segments` tables back the shipped reader. Only the *legacy server-side generation/illustration* tables (`generations`, `prompt_templates`, `people`) stay inert (removed with the in-app AI at the MCP inversion). Decision record: `docs/product/stories-first-pivot.md`; roadmap: `docs/product/roadmap.md` (7-phase P1 Projects → P7).
