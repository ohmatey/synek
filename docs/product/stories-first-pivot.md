---
project: "Synek"
owner: founder · (to formalize: Margot product · Kael architecture)
updated: 2026-06-14
status: DECISIONS LOCKED (founder, 2026-06-14) — nonfiction-first · keep Synek SEPARATE (dogfooding wedge) · Projects first. Pending Margot strategy formalization + Kael ADR.
links: [product-strategy.md, roadmap.md, prd/README.md, ../engineering/adr/README.md]
supersedes_note: "product-strategy.md is stale (local-first framing) relative to CLAUDE.md cloud-first posture + shipped multi-tenant Phase 2; this proposal builds on the SHIPPED reality, not the stale doc."
---

# Synek — Stories-first repositioning + Realscript companion

> Re-center Synek on **Stories**, with **Timelines · Entities · Resources** as the supporting cast — all grouped under a new top-level **Project**. Reposition Synek as **Realscript's companion app for immersive AI stories**, and as the live testbed for Realscript's **brand** and **social-scheduling** integrations.

## TLDR

- **The unit of value moves from the timeline to the story.** Today the top-level container is a timeline and a story hangs off one moment on it. We invert: a **Project** is the container; it holds many **stories**, **timelines**, **entities**, and **resources**. Timeline + globe + entities become *supporting views into* stories rather than the product itself.
- **Synek becomes Realscript's immersive-story companion.** Realscript ships short-form/storyboard content; Synek is where a *long-running, world-anchored, serialized* story lives. The two share a **brand** (Realscript's brand API themes a Synek project) and a **distribution path** (Synek hands a finished story to Realscript's scheduler to post on social). Synek also **dogfoods** the shared immersive-story components.
- **Most of the hard infra is already shipped.** Cloud-first posture, the in-app key-gated agent loop, per-user isolation (multi-tenant Phase 2), public sharable stories (`/s/$slug` with SSR OG + responsive reels), and BYO keys all exist. This pivot is mostly *re-centering + 4 net-new capabilities*, not a rebuild.
- **Three founder decisions gate the plan** (§3). My recommendations are locked in as working assumptions so the crew can start; reverse any with one line.

---

## 1. What you asked for → what it needs → state today

| Your ask | What it requires | State today |
|---|---|---|
| A **Project** to store many stories, timelines, entities, resources | New `projects` table above `timelines`; `timelines.projectId`; resources (artifacts/sources/files) scoped to a project | **Net-new.** Top-level is `timelines`; no grouping above it. Ownership/isolation primitives already exist (multi-tenant Phase 2). |
| **"New chapter of story X every morning"** (pull from entities/periods/citations; enrich the timeline+globe) | Scheduled serialized generation: a per-story cron that runs the in-app agent with a "next chapter" brief, reading existing graph + citations, writing one new chapter + enriching nodes | **Net-new loop**, but the parts exist: in-app agent (`src/lib/agent/`), `write_story`, `apply_patch`, layout/citation reads. The client-side `/synek:watch` skill is the manual ancestor. Overrides the "scheduled jobs" guardrail. |
| **Conversations with entities during certain time periods** | A chat surface grounded in an entity + a time window; agent constrained to what that entity could know at that date | **Net-new surface.** Verb-system S3.4 "Talk to {entity}" is the copy-prompt ancestor; this makes it a live in-app chat. |
| **Globe = the world within the story** (generated, or template: Earth / Harry Potter universe) | Parameterize the globe basemap; per-project world config; non-Earth basemaps | **Net-new.** Globe is hard-locked to Earth (`world-atlas/countries-110m.json` in `GlobeLens.tsx` + `GlobeMiniWidget.tsx`); no basemap param. |
| **Stories SEO/share-compliant + fully responsive** | OG/Twitter cards, SSR, mobile reader | **Mostly done.** `/s/$slug` already ships SSR OG + Twitter cards + mobile-first reels reader. Small polish lift. |
| **Use Realscript components / dogfood** | A shared, framework-neutral immersive-story component surface | **No clean path today** (Realscript UI is Next/RSC/Postgres-locked; Synek's reader is further ahead). Decision §3.2. |
| **Companion app: test brand + scheduler integrations** | HTTP clients to Realscript brand + scheduler APIs | **Clean & ready.** Brand: `GET /api/v1/brands/{id}/theme.css\|tokens\|kit`. Scheduler: `POST /api/schedules` with `x-internal-service-key`. |

---

## 2. The reframe (positioning)

**Old positioning (strategy doc):** *"Synek is Claude's spatial memory"* — a timeline-first knowledge canvas, local-first, no AI in-app.

**New positioning (LOCKED, founder 2026-06-14):** *"Synek is the companion app to Realscript for **creating immersive, serialized stories for the digital world** — build a world once (timeline, entities, globe), grow it a chapter at a time with your own AI, and publish it as responsive, SEO-ready pages scheduled to social via Realscript."*

**Persona (LOCKED): the digital-story creator / serial worldbuilder.** Synek is **purely a story-creation-and-publishing tool** — the old "Claude's spatial memory / private research canvas" framing is **retired**. The user builds a living (nonfiction-first) world and publishes it serially to a digital audience (option **(b)**: audience/creator, *not* private learning). Adjacent to Realscript's short-form marketer but distinct: long-form, serialized, world-anchored. The timeline / globe / entities are creation + navigation surfaces, not the destination.

- **Story is the hero.** You open a Project, you read/continue a Story. The timeline, the globe, the entity cards are *lenses on that story's world* — they exist to make the story navigable and inhabited, not as the destination.
- **Timelines + entities + globe = supporting features.** They remain first-class data, but in the UI they're "views into the world of the story." (This matches the existing `?view=stories|timeline|globe` lens switcher — we promote *stories* to the default lens at the project level.)
- **Realscript relationship.** Realscript = short-form/storyboard production at velocity. Synek = the long-form, serialized, world-building companion. Shared brand → consistent identity across both. Shared distribution → Synek stories flow into Realscript's social scheduler. Shared components → Synek proves the immersive-story component library.
- **Synek is Realscript's first external customer.** Because it's a separate repo on a different stack, every integration it consumes (brand, scheduler, components) is a real external-contract test that hardens Realscript's platform for future third-party integrators — value an internal monorepo app could never produce.

---

## 3. The decisions (founder, 2026-06-14) — LOCKED

### 3.1 Truth model  → **DECIDED: nonfiction-first; fiction on the roadmap**

Synek's whole grounding stack (citations, primary-source `artifacts`, reliability tiers, `geoScope`) assumes **real history you can source** — keep that as the spine.

- **Now (nonfiction):** existing grounding intact — real-Earth globe, `geoScope`, cite-or-mark-unverified, artifacts = the B4 moat. Enrichment = *web research*. Projects default to `kind: nonfiction`.
- **Roadmap (fiction, P4):** `kind: fiction` adds a **generated/custom world basemap** (Harry Potter, Lord of the Rings, etc.), "lore references" in place of citations, and canon-consistency in place of sourcing. The `projects.kind` flag is designed in from slice 1 so fiction is additive, not a retrofit.
- Net effect: smallest honest change now (preserves the moat), the immersive-fiction vision is sequenced, not dropped.

### 3.2 Synek ↔ Realscript relationship  → **DECIDED: keep SEPARATE — Synek is the dogfooding wedge**

Synek stays its own repo/stack (Bun/TanStack/SQLite). It is **Realscript's first external customer** and the live testbed for Realscript's productized surfaces. Integration is by **contract, not co-location**:

- **Brand** → HTTP (`/api/v1/brands/{id}/theme.css|tokens|kit`) or the framework-agnostic `@realscript/brands` SDK. Proves the brand export works for an outside consumer.
- **Scheduler** → HTTP (`POST /api/schedules`, `x-internal-service-key`). Proves the social-publish contract works for an outside producer.
- **Components** → extract a **framework-neutral React + Tailwind-v4 package** (zero Next imports); Synek is the **first real consumer**, surfacing the bugs/gaps an internal monorepo app never would. Synek's reader leads, so the proven set flows Synek→package→Realscript.
- **Why separate beats merging:** dogfooding only has signal if the consumer is *external* and on a *different* stack — an internal app imports everything directly and never tests the public contract. Merging (the rejected option) would have cost a Next.js/Postgres rewrite for zero user value and *destroyed* the dogfooding signal.
- **Operating discipline:** Synek builds what *its own user* needs; the Realscript surfaces are exercised as a **byproduct** (theme a story → brand API; share → scheduler API; render → components). Never build a Synek feature *to* test Realscript — that fakes the signal.

### 3.3 First shippable slice  → **DECIDED: the Project container**

- Your #1 stated want, the foundational re-center (every other capability hangs off Projects), shippable on top of the existing multi-tenant ownership model.
- Sequencing of the rest is in §6 (P2 brand → P3 morning loop → P4 worlds/fiction → P5 conversations → P6 social → P7 component extraction).

---

## 4. Data model — the Project container (sketch for Kael's ADR)

```
user (Better Auth)
  └─ projects                ← NEW top-level container (ownerId, slug, title, kind, world config, brand ref, theme)
       ├─ timelines          ← + projectId FK   (holds nodes/edges = entities, events, periods, concepts)
       │    └─ stories       ← unchanged: hang off a moment (node); inherit project via timeline
       └─ resources          ← artifacts + sources (+ uploaded files) re-scoped: + projectId
```

- **`projects`**: `id`, `ownerId` (FK user), `slug`, `title`, `description`, `kind` ('nonfiction'|'fiction'), `world` (JSON: basemap = 'earth'|preset|custom-topojson-url + bounds), `brandRef` (optional Realscript brand id), `theme` (project-level default; timelines inherit/override). Postgres-portable (text ids, JSON columns) per existing convention.
- **`timelines.projectId`**: every timeline belongs to one project. Migration backfills a default "My first project" per existing owner so nothing orphans.
- **Resources**: `artifacts` + `sources` gain `projectId` (currently only `ownerId`). "Resources" in your ask = the artifact/source corpus + (future) uploaded files. Project-scoping is the natural grouping and keeps the B4 reuse story ("cite once, reuse across the project").
- **Open question (flagged, deferred):** should an **entity be reusable across timelines within a project** (one "character" appears in several timelines/stories)? Today nodes are per-timeline. Cross-timeline entity sharing is a bigger model change — recommend **Project-as-grouping first** (timelines own their nodes), revisit shared entities after slice 1.
- **Ownership/isolation:** reuse the shipped multi-tenant pattern — every project-scoped read is owner-scoped at the entry points; the MCP registry's `ctx.ownerId` extends to `ctx.projectId`.

---

## 5. Realscript integration surface (verified, file-cited)

| Integration | Entry point (Realscript) | How Synek consumes | Friction |
|---|---|---|---|
| **Brand** (theme a project) | `GET /api/v1/brands/{id}/theme.css` · `.../tokens?format=tailwind` · `.../kit` (Bearer); or `@realscript/brands` SDK (`createBrandsClient`, framework-agnostic) | HTTP client → map onto `projects.theme` / `timelines.theme` (already has colors/font/imageStyle/mood) | **Low.** Pure HTTP/JSON. SDK is axios+zod, Bun-safe. |
| **Scheduler** (post a story to social) | `POST /api/schedules` with `x-internal-service-key`; body `{ connectionId, scheduledFor, mediaUrl, title, description, hashtags, externalId, callbackUrl }`; platforms TikTok/YouTube/IG; BullMQ/Redis | On publish, POST cover image (or rendered media) + caption + `externalId=story slug` + link to `/s/$slug`; receive callback webhook | **Low API / Medium media.** Scheduler wants `mediaUrl` (video/image); a Synek story is a *web reel* → post the **cover image** as a single-image social post linking to `/s/$slug`, or (later) render the reel to video. **Decision deferred — not a slice-1 blocker.** |
| **Components** | `apps/web/src/components/ui/*` (shadcn) + Storybook; story/panel modules are Next/RSC-locked | Per §3.2: a framework-neutral package; Synek is the **first external consumer** that proves the contract (Synek→package→Realscript) | **Extraction work, not import** — the neutral package is the deliverable; cross-stack risks (next/*, RSC, workspace deps) are exactly what Synek's external consumption flushes out. |

Cross-stack reality: both repos are React 19 + Tailwind v4 + shadcn (token-compatible), but Realscript is pnpm/Next and Synek is Bun/TanStack — `workspace:*` imports and `next/*` imports don't cross. HTTP APIs cross cleanly; components must be neutral-packaged to cross.

---

## 6. Phased roadmap (proposed)

> Sequenced behind the slice-1 decision (§3.3 = Project container). Each phase is a shippable increment with its own PRD/ADR.

- **P1 — Project container** *(slice 1)*: `projects` table + `timelines.projectId` + resources `projectId` + migration/backfill + project list/home + project-scoped reads + MCP `create_project`/`list_projects` + `ctx.projectId`. Stories-as-default-lens at project level. **Owner: Kael (ADR) → build.**
- **P2 — Realscript brand integration**: brand HTTP client → `projects.theme`; "Use a Realscript brand" picker; theme inheritance timeline←project. *Fastest companion-app proof; validates the Synek↔Realscript link.*
- **P3 — Serialized stories + morning-chapter loop**: story `kind: serialized`, chapters as ordered stories under a "series"; scheduled per-story agent run ("write the next chapter, pull from graph+citations, enrich"); proposed-patch review (reuse LATER.2 agent-run model). *Depends on §3.1 truth model + a scheduler/cron seam.*
- **P4 — Worlds & the parameterized globe**: `projects.world` basemap param; Earth + at least one fiction template; globe refactor (`GlobeLens`/`GlobeMiniWidget` accept a basemap); fiction canon-bible storage.
- **P5 — Conversational entities**: live chat surface grounded in entity + time window (promote verb S3.4 to a real conversation; the deferred `H.1 conversations` schema is the home).
- **P6 — Social distribution**: scheduler HTTP client; "Share to social" from a published story; media decision (cover-image post vs. rendered video).
- **P7 — Component extraction**: lift the proven immersive-story components into the shared neutral package (§3.2 end-state).

---

## 7. Reconciliation with strategy + guardrails

**This pivot overrides several `CLAUDE.md` / roadmap deferrals** — but most were *already* overridden by the shipped cloud-first + multi-tenant + public-sharing work:

- ✅ Already shipped (no longer "deferred"): multi-tenant/per-user isolation, in-app agent, public sharing.
- ⚠️ Newly overridden by this proposal: **scheduled jobs** (P3 morning loop), **a project/workspace container** (P1), **conversational agent surface** (P5), **social integrations** (P6), **fictional (non-history) content** (P4 — a philosophical shift away from "grounded real history").
- 🔒 Stays intact: the Patch invariant; owner-scoped isolation; the MCP tool surface as the single write path; the in-app agent staying key-gated/optional; nonfiction grounding (B4 moat) preserved under §3.1's per-project mode.

**Required doc updates once decisions land:** update `CLAUDE.md` scope guardrail + `product-strategy.md` positioning/bets (it's stale anyway) + `roadmap.md` (fold P1–P7 in). Margot owns the strategy/PRD rewrite; Kael owns the Project-container + globe-basemap ADR.

---

## 8. Next steps

1. **Founder:** confirm/redirect the three decisions in §3 (one line each is enough).
2. **Margot:** repositioned `product-strategy.md` (new positioning, Realscript-companion bet, fiction/nonfiction stance) + a PRD per phase.
3. **Kael:** ADR for the Project container (§4) + the globe-basemap parameterization + the scheduled-generation/proposed-patch model.
4. **Build slice 1 (P1 Project container)** once §3.3 is confirmed.
