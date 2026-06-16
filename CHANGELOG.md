# Changelog

## 0.2.0 — 2026-06-16

**Stories-first, cloud-first.** The posture shifts from "local-first Core" to **cloud-first,
fully functional self-hosted, progressively enhanced**, and the product re-centers on
**stories** — create a world once, grow it a chapter at a time, and publish it. The MCP
inversion still holds (your own MCP client is the brain by default), now with an optional
in-app agent and a multi-tenant hosted path.

### Stories — the product
- **Stories as a first-class layer** — `write_story` (cast, cover, per-beat images with
  full/inset/bleed layouts, per-beat **live widgets**: mini timeline/globe/entity from node
  ids), a docked story **reader** with per-beat entity focus, multiple stories per moment,
  and a third **Stories view** lens (reader decoupled from entity panels).
- **Read-aloud narration** (Web Speech) + an **auto-play** toggle; story end-panel with a
  "continue this story" prompt.
- **Public sharable stories** — a no-auth, mobile **`/s/$slug`** reels page (SSR OpenGraph +
  Twitter cards, live per-beat widgets) to test the sharing-drives-acquisition bet; sharing a
  story publishes its timeline.

### Projects + a cinematic home
- **Projects** — a top-level container above timelines (owner-scoped; `projects` table,
  migration 0020; MCP `create_project`/`list_projects`/`get_project` + `ctx.projectId`).
- **Move in/out of projects** + a **cinematic, Netflix-style home** (featured story heroes,
  horizontal rows, project-as-filter) and a **`/p/$slug`** project page.

### The globe
- **Globe lens** — d3-geo orthographic projection with lat/lng on nodes, play-through, and a
  top-center view switcher (lazy-loaded).
- **Globe story mode (GS1–GS4)** — per-beat camera ease + zoom, interactive wheel/pinch zoom,
  floating entity cards, an era ribbon, and a dated scrubber.

### Canvas
- **Timeline themes** — per-timeline visual themes (`set_timeline_theme` MCP tool + editor).
- **Verb system** (Tier 1 + Tier 2 "alive canvas" invitations) and a **⌘K command palette**
  (search, actions, kind filter).
- **Timeline scroller** (bottom scrubber + zoom controls), **deep-linkable canvas URL state**,
  a Linear/Notion node restyle, and resizable docked panels.

### Intelligence — MCP + optional in-app agent
- **Optional, key-gated in-app agent** (`OPENROUTER_API_KEY`) — the prompt dialogs gain a
  **Run** that executes server-side against the **same** tool registry the MCP server uses
  (one tool surface, two callers). With no key set, the BYO-client local-first default is
  unchanged.
- **Richer MCP surface** — `query_timeline`, `get_node`, `get_layout_report`, `set_timeline_view`,
  `set_timeline_theme`, `write_story`; `apply_patch` returns advisory **warnings** + a
  `graphSummary`.
- **Artifact grounding (S2, the moat)** — normalized `sources`/`artifacts` (migration 0016 +
  FTS5) with `register_artifact`/`search_artifacts` and undo-safe story citations.

### Hosting — multi-tenant + self-host
- **Multi-tenant Phase 2** — per-user **isolation** (every artifact/timeline/story/history read
  owner-scoped; migration 0019), **open signup** with email verification + password reset
  (Resend), and a **per-user BYO OpenRouter key encrypted at rest** (AES-GCM).
- **Self-host** — a single-instance SQLite-on-volume **Docker** image (migrate-on-boot) and a
  **Fly.io** single-instance deploy + runbook.

### Security
- **Server-side SSRF egress guard** (`src/lib/net/ssrf.ts`, ADR 0002) — scheme + IP-range +
  DNS-resolution + redirect re-validation — and a **closed live vector** in the citation/image
  URL verifier (it fetched user-supplied URLs with follow-redirects). Required primitive for
  every future server-side fetch.

### Onboarding & analytics
- **`bun run setup`** one-step on-ramp, an **`npx synek`** installer, and a **Claude Code
  plugin** (MCP connection via OAuth).
- **Opt-out PostHog** analytics (browser + server/MCP), key-gated, plus an opt-in self-host
  heartbeat.

### Verification
`bun run typecheck`, `bun run build`, the `verify:*` data-layer suite (incl. `verify:mcp`,
`verify:ssrf`, `verify:projects`, `verify:isolation`), and the Playwright e2e suite all pass.

## 0.1.0 — 2026-05-27

First tagged release. Synek (display name **Synek**) is a local-first, **MCP-driven**
timeline knowledge canvas: the app holds no AI of its own — your MCP client (Claude
Desktop / Claude Code) builds and edits timelines, and the canvas is the viewer.

### Architecture
- **MCP server** over two transports — Streamable HTTP at `/api/mcp` and a stdio binary
  (`bun run mcp:stdio`). Tools: `list_timelines`, `create_timeline`, `get_timeline`,
  `apply_patch`, `undo`, `redo`, plus a read-only `synek://timeline/{id}` resource.
- **One logical edit = one atomic, undoable Patch** — `apply_patch` carries a batch of ops
  (add/update/delete node/edge) committed as a single Patch; `ref` aliases wire edges to
  nodes created in the same call.

### Accounts & access
- **Better Auth** email/password accounts (open multi-user registration).
- **API keys** — named, hashed (sha256), revocable, show-once. Managed in the home
  *Connect an MCP client* panel (sign in required) or via `bun run issue:key`. A "Default"
  key is minted on a user's first visit. Auth falls back to session tokens for legacy keys.

### Per-user timelines + sharing
- Each account **owns its timelines** (direct `ownerId`, no "workspace" entity).
- **Private by default**, with a per-timeline **public toggle + share URL**. Access: list =
  your own; view = owner or public; create/edit/rename/delete/toggle = owner.
- The **MCP server is scoped to the key's owner** — a key only sees and edits that account's
  timelines.
- The canvas renders **read-only** for public/non-owner viewers; owners get a Share control.

### App shell & onboarding
- A proper **app layout**: header with logo + app name and an auth area (Sign in when logged
  out; your email + Sign out when logged in).
- **Landing → onboarding flow** for logged-out visitors (what Synek is + sign in / create
  account), and a signed-in **dashboard**: your timelines + a **Connect an MCP client** guide.
- The connect guide walks **login → API key → connect**: create/copy a key (shown once), the
  endpoint, and copy-paste setup for **Claude Code** (`claude mcp add`) and **Claude Desktop**
  (`mcp-remote` config) with the key pre-filled, plus a **Get the skills** step (install the
  Synek plugin).

### Demo
- The seed creates a demo account (`demo@synek.app` / `demo-password-123`, env-overridable)
  that owns 5 public example timelines, so the open-canvas demo and URL viewing work without
  login.

### Fixes
- **Dev-server hydration** — `bun run dev`'s client bundle now boots. The Start plugin's
  `virtual:tanstack-start-client-entry` 404'd on a cold dev request under Vite 7 (filter-based
  virtual-module resolution), leaving the page stuck pre-hydration; a small dev-only Vite
  middleware rewrites that request to the working `\0`-encoded id. No effect on the build.

### Verification
`bun run typecheck`, `bun run build`, `bun run verify:mcp` (data-layer Patch/undo path), and
the Playwright e2e suite (19 tests — home/auth, canvas, seed-data, node-detail, MCP) all pass.
