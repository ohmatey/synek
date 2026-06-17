# ADR 0005 — Cull the public discovery feed: Synek is a pure local-first app

- **Status:** Accepted (founder decision via AskUserQuestion, 2026-06-17).
- **Date:** 2026-06-17
- **Deciders:** founder (chose the cull depth + what to keep via AskUserQuestion) · engineering (boundary mapping + execution).
- **Scope:** Remove the cross-user public **Explore discovery feed** and the dead **marketing/landing** surface; promote the signed-in workspace to the root `/`. Reverses ADR-adjacent founder decision "Public discovery is now IN scope (2026-06-16)" recorded in `CLAUDE.md`.
- **Explicitly NOT in scope (KEPT, untouched):** per-story **sharing** (`/s/$slug`, `getPublicStory`, `src/components/public/`, the in-reader Share button, the `timeline.isPublic` / story `isPublic` flags); multi-tenant auth / email / Fly deploy (the cloud seam); the brand layer; the optional key-gated in-app agent; the whole canvas + stories engine.

---

## Context

The product had drifted toward a cloud-first, discovery-led posture: the root `/` was a public, cross-user **Explore feed** (`src/components/explore/`, `src/lib/server/explore.ts`, `listPublic*` in `src/lib/db/{stories,graph}.ts`), anonymous-readable, listing public stories/timelines/nodes across all owners. That feed existed to test a *sharing-drives-acquisition* bet. A marketing **Landing** page (`Landing`/`HeroPreview`/`SiteFooter`) predated it and was already unused.

The founder reset the positioning: **Synek is a pure app** — anyone downloads it and runs it locally with their own MCP client (the MCP inversion already makes the core local-first and AI-less by default), with cloud as a *deploy mode* of the same codebase, not a separate product. A discovery feed and a marketing landing page do not belong in a pure local app.

Key realization that bounded the work: the local-first core already existed (BYO MCP client, SQLite, no in-app AI). What had accreted was a *positioning layer*. "Use with local models" needs no new code — the BYO MCP client (Claude Desktop / Code, or any OpenAI-compatible local endpoint pointed at the MCP server) is the local-model path. So this is a deletion + a route promotion, not a rewrite.

**Four forks the founder locked (AskUserQuestion, 2026-06-17):**
1. **Cull depth:** delete the public *discovery* layer (Explore feed) — but keep multi-tenant auth as the cloud seam.
2. **Local models:** BYO MCP client only — do **not** add in-app local inference; the agent runner is untouched.
3. **Root page:** `/` is the **workspace**.
4. **Brand layer:** **keep** (serves on-brand story creation).

A follow-up correction narrowed the cull: **keep per-story sharing** (`/s/$slug`). So only the cross-user *feed* dies, not the act of sharing a single story by link.

---

## Decision

### D1 — The root `/` is the signed-in workspace.
`src/routes/index.tsx` renders `ProjectsWorkspace` (was `ExplorePage`) behind the existing auth gate, with a plain `robots: noindex` head (no marketing meta). `?project=<slug>` scope behaves as before. *Justification:* a pure app opens into your work, not a feed.

### D2 — `/projects` becomes a redirect to `/`.
Kept as a thin `beforeLoad` redirect (preserving `?project`) so old links/bookmarks resolve. The `/p/$slug` MCP project handle now resolves to `/?project=<slug>`. All in-app links (`AppHeader`, `ProjectCard`, `AuthScreen` post-login) point at `/`.

### D3 — Delete the Explore feed end-to-end.
Removed: `src/components/explore/` (ExplorePage + the three public cards), `src/lib/server/explore.ts`, `listPublicStories` (`db/stories.ts`), `listPublicTimelines`/`listPublicNodes` (`db/graph.ts`), and the `PublicStoryCard`/`PublicTimelineCard`/`PublicNodeCard` DTOs (`domain/types.ts`). Dropped the e2e `explore.spec.ts`.

### D4 — Delete the dead marketing cluster.
`Landing.tsx`, `HeroPreview.tsx`, `SiteFooter.tsx` were used only by each other; removed, with the `Landing` barrel export. "No landing page" is now literally true.

### D5 — Keep sharing whole.
`getPublicStory` and `/s/$slug` use a different, single-story code path from the (now-removed) `listPublic*` feed queries, so per-story sharing is untouched. The `timeline.isPublic` column stays (cheap, the publish primitive). The Share button stays inside the in-canvas `StoryReader`.

### D6 — Cloud stays a deploy mode, not a fork.
Multi-tenant auth, email verification/reset, and the Fly deploy (Phase 2) remain. Local and cloud are the **same codebase**: run locally (single user, your own MCP client) or deploy it (multi-user). No `SYNEK_MODE` branch was needed because nothing in the kept surfaces is local- or cloud-exclusive once the public feed is gone.

---

## Consequences

- **Positive:** smaller surface; the app reads as a focused tool, not a content site; one less anonymous, NOT-owner-scoped read path to reason about (the feed's cross-user reads are gone — sharing's single-story public read remains, gated on the per-story flag). The sharing-acquisition bet narrows to a testable "share a link," dropping "browse a feed."
- **Negative / retired:** the cross-user discovery bet is retired. If discovery returns, it comes back as a deliberate, separately-recorded decision — not the default home.
- **Verification:** `bun run typecheck` + `bun run build` green (the `/s/$slug` chunk still builds — sharing intact). e2e specs that asserted the old `/projects` URL updated to `/`.

## Alternatives considered

- **Gate behind a `SYNEK_MODE` switch (keep Explore code, hide in local).** Rejected by the founder's "delete the public discovery layer" choice — carrying dead-but-live discovery code is the maintenance trap the cull exists to avoid.
- **Delete sharing too (`/s/$slug`).** Rejected by the founder follow-up — sharing a story by link is wanted; only the feed is not.
