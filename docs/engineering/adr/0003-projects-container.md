# ADR 0003 — Projects: a top-level container above timelines

- **Status:** Proposed (Kael, 2026-06-14) — pending founder sign-off. Slice 1 of the LOCKED stories-first repositioning.
- **Date:** 2026-06-14
- **Deciders:** Kael (Chief Engineer, owner) · Margot (Product, strategy — concurrent) · founder (sign-off)
- **Scope:** The **Projects container only** — the `projects` table, `timelines.projectId`, resource (`artifacts`/`sources`) re-scoping, read scoping, the three project MCP tools, and the minimal project-list UI. This is **P1 / slice 1** of the repositioning.
- **Decision record this implements:** `../../product/stories-first-pivot.md` §3.3 (first shippable slice = the Project container) and §4 (data-model sketch).
- **Builds on:** ADR [0001](./0001-sources-artifacts-schema.md) (sources/artifacts; this ADR re-scopes those tables) · the shipped multi-tenant Phase 2 ownership model (migration `0019`).
- **Explicitly NOT in scope (separate future ADRs):** globe-basemap parameterization (P4), scheduled serialized generation + proposed-patch review (P3), conversational entities (P5), social-scheduler integration (P6), component extraction (P7), and cross-timeline shared entities (see Open / deferred). This ADR adds **only** the container.

---

## Context

Today the top-level owned container is `timelines` (`src/lib/db/schema.ts:71`, owner-scoped via `ownerId` since Phase 2). Nodes, edges, patches, and stories all hang off a timeline (`schema.ts:138`, `:156`, `:174`, `:259`); `artifacts` and `sources` are owner-scoped reference data (`schema.ts:324`, `:341`; migration `0019`). **There is no grouping above a timeline** — `listTimelines(ownerId)` returns a flat list (`src/lib/db/graph.ts:27`), and the home dashboard renders that flat list directly (`src/routes/index.tsx` → `SignedIn` → `TimelinesSection`).

The stories-first repositioning (founder, 2026-06-14, `../../product/stories-first-pivot.md`) inverts the unit of value from the *timeline* to the *story*, and makes a **Project** the container that holds many stories, timelines, entities, and resources. Every downstream capability in that plan — Realscript brand theming (P2), the morning-chapter loop (P3), generated worlds/fiction (P4), conversational entities (P5), social distribution (P6) — hangs off a Project that exists first. So slice 1 is purely: **add the container, re-scope what hangs under it, keep everything that ships today working.**

**The hard constraints this design lives inside (verified against the code, not assumed):**

1. **Postgres-portable, hosting-aware.** SQLite (`better-sqlite3`, Node runtime) today, Postgres later. Every owned table uses app-generated `text` ids via `crypto.randomUUID()` (`schema.ts:68`), JSON via `text({ mode: 'json' })`, system time via `integer({ mode: 'timestamp_ms' })` (`schema.ts:69`). No new column type or DB feature may break that portability.
2. **Owner-scoped, fail-closed multi-tenant.** The shipped pattern (migration `0019`, `src/lib/db/graph.ts`, `src/lib/mcp/registry.ts`): every owned row carries a **nullable** `ownerId` FK to `user`; reads are owner-scoped **at the entry points** (server fns via `requireUser()` in `src/lib/auth/session.ts:18`; MCP via `ToolCtx.ownerId` + `requireOwned` in `registry.ts:42`); the `db/*` layer takes ids and **trusts its guarded caller** (`graph.ts:20` comment). A null-owner row never surfaces. Projects must reuse this pattern verbatim — not invent a parallel one.
3. **The Patch invariant is sacred.** One graph edit = one atomic undoable Patch (`schema.ts:174`, `src/lib/db/patches.ts`). Timeline metadata (`title`, `viewSettings`, `theme`, `isPublic`) lives **outside** the Patch engine — set by direct owner-scoped CRUD (`graph.ts:41–77`). **Projects are metadata of exactly that kind** → Project CRUD is **not** a Patch (confirmed below). The Patch engine stays untouched, and knows nothing about projects.
4. **Migration discipline — no NOT-NULL rebuild.** The team previously hit a NOT-NULL-rebuild gotcha and fixed it **fail-closed** in Phase 2: migration `0019` adds `ownerId` as a **nullable** column (`ALTER TABLE artifacts ADD owner_id text REFERENCES user(id)`), backfills via correlated `UPDATE`s, and falls back to the sole user for self-host installs — **never** a table rebuild, never a NOT-NULL add on a populated table. SQLite's `ALTER TABLE ADD COLUMN` cannot add `NOT NULL` without a default and cannot add an FK that's also NOT-NULL cleanly; drizzle-kit's workaround is the 12-step table rebuild, which is the exact gotcha to avoid. Projects' migration must follow `0019`'s shape.

Verified before locking: `schema.ts`, `graph.ts`, `registry.ts`, migrations `0016` and `0019`, `src/lib/server/timelines.ts`, `src/lib/auth/session.ts`, `scripts/verify-isolation.ts`. The data-model sketch in `stories-first-pivot.md` §4 was directionally right; this ADR makes it concrete and corrects two things the sketch left open (the `projectId` nullability decision, and the resource-scoping backfill path).

---

## Decision

Eleven decisions, each with a one-line justification. Concrete DDL in **Schema**; the executable order is in **Slice-1 implementation checklist**.

### D1 — One new table: `projects`, the top-level owned container.

`projects` sits between `user` and `timelines`. It carries `ownerId` (FK `user`, cascade) exactly like `timelines`, so the shipped ownership/isolation pattern extends with zero new machinery. *Justification:* the repositioning needs a single home for the project-level metadata (`kind`, `world`, `brandRef`, `theme`) that every later phase reads; a table is the honest model, and reusing the `ownerId` shape means `verify:isolation`'s proof technique extends directly.

### D2 — `projects.kind` ('nonfiction' | 'fiction', default 'nonfiction') is designed in NOW, used minimally now.

Add the column in slice 1 even though slice 1 only ever writes `'nonfiction'`. *Justification:* the founder decision (`stories-first-pivot.md` §3.1) is nonfiction-first, fiction on the roadmap (P4). Adding the enum column day one makes P4's generated-world / fiction mode **additive** (set `kind='fiction'`, populate `world`) rather than a retrofit that touches every existing project row. A one-column enum with a default is free now and saves a populated-table migration later. The app does not branch on `kind` in slice 1 beyond defaulting it — no fiction behavior ships here.

### D3 — `projects.world` (JSON, nullable) holds the world/basemap config; null or `{ basemap: 'earth' }` = real Earth.

A nullable `text({ mode: 'json' })` column, typed `ProjectWorld | null`. Slice 1 leaves it `null` for every project (the globe is hard-locked to Earth today — `GlobeLens.tsx`/`GlobeMiniWidget.tsx`). *Justification:* P4 parameterizes the globe basemap per project (Earth | preset | custom topojson). A JSON column is the right seam: it's Postgres-portable, it carries arbitrary future basemap config without a schema change, and **null is a clean "default Earth" sentinel** so no existing reader must change when P4 lands. The *shape* of `ProjectWorld` is a P4 concern — we reserve the column and a minimal type (`{ basemap: 'earth' }`), not the full schema. **This ADR does not design the basemap model** (that is the P4 globe ADR); it only reserves the column so P4 is additive.

### D4 — `projects.brandRef` (text, nullable) is an opaque external Realscript brand id; no FK.

A nullable `text` column. *Justification:* P2 themes a project from a Realscript brand fetched over HTTP (`GET /api/v1/brands/{id}/theme.css`). The brand lives in **another system on another stack** — there is nothing in this DB to FK to, and there must not be (per §3.2, integration is by contract, not co-location). It's an opaque foreign-system reference, like an external id. Storing it now lets P2 be "fetch brand `brandRef` → map onto `theme`" without a schema change. Slice 1 never sets it.

### D5 — `projects.theme` (JSON, nullable) is the project-level default theme; timelines inherit then override.

Reuse the **exact** `TimelineTheme` shape (`src/lib/domain/types.ts`, the type behind `timelines.theme` at `schema.ts:88` and `domain/theme.ts`'s `timelineThemeSchema`). Type it `TimelineTheme | null`. *Justification:* the repositioning wants one coherent look per project, with per-timeline override (a project's timelines share a palette unless one opts out). Reusing `TimelineTheme` means: the shipped `timelineThemeSchema` (Zod) validates it for free, `resolveTimelineTheme` already knows the shape, and inheritance is a trivial **resolve-time** rule (`timeline.theme ?? project.theme ?? defaults`) with **no new column on `timelines`** and no migration of theme data. **Inheritance is a read-time fallback, not a write-time copy** — changing a project's theme re-themes every non-overriding timeline automatically, and nothing drifts. Slice 1 stores it (set on create / via the project tools) but the *render-side inheritance wiring* (`resolveTimelineTheme` consulting the project) can be a fast-follow within P1 — the column and contract land now.

### D6 — `projects.slug` is `notNull().unique()` — projects are URL-addressable; resolution is per-owner-unique by construction.

Match `stories.slug`/`people.slug` (`schema.ts:265`, `:248`): a `notNull().unique()` slug. *Justification:* the project is the thing a user opens and (later) the natural root of a shareable/branded space, so it earns a human-readable URL handle — the same reason `stories` has one and `artifacts` (ADR 0001 D2) does not. **Global uniqueness vs per-owner:** a globally-unique slug is the simplest correct choice for slice 1 (one `UNIQUE` index, no composite, Postgres-portable) and avoids leaking owner ids into URLs. The creating server fn generates the slug from the title with a uniqueness-suffix on collision (the same slugify-then-dedupe the story path already does) — so two users both making "My first project" get `my-first-project` and `my-first-project-2`. (A per-owner `unique(ownerId, slug)` is a clean future change if project URLs ever need to be owner-namespaced; not needed now.)

### D7 — `timelines.projectId` is added **nullable**, backfilled to a per-owner default project; NOT made NOT-NULL in slice 1.

Add `projectId text REFERENCES projects(id)` to `timelines` — **nullable**, with an index. The migration creates one default project per existing owner ("My first project") and points every existing timeline at it. *Justification — this is the migration-discipline decision (constraint 4):* SQLite cannot `ALTER TABLE ADD COLUMN ... NOT NULL REFERENCES` on a populated table without either a default or the 12-step rebuild — the exact NOT-NULL-rebuild gotcha Phase 2 hit and fixed fail-closed. Migration `0019` is the proven template: **add nullable, backfill via correlated `UPDATE`, sole-user fallback for self-host.** We do the same. The application invariant ("every timeline has a project") is enforced **at the write path** — `createTimeline` always sets `projectId`, just as it always sets `ownerId` today (`graph.ts:36`) — not by a DB NOT-NULL constraint. A null `projectId` is treated as "unassigned"; reads tolerate it (an owner's null-project timelines surface under their default project), so a backfill miss **degrades gracefully instead of orphaning**. Promoting `projectId` to NOT-NULL is deferred to a later hardening migration **only once** every install is known-backfilled (and even then, via a verified rebuild, not a blind ALTER) — flagged in Open / deferred. **This matches the still-nullable `timelines.ownerId` (`schema.ts:77`), which Phase 2 also left nullable for exactly this reason.**

### D8 — `artifacts` and `sources` gain a nullable `projectId`; backfilled via their timeline/owner, falling back to the owner's default project.

Add `projectId text REFERENCES projects(id)` (nullable, indexed) to both `artifacts` (`schema.ts:341`) and `sources` (`schema.ts:324`). *Justification:* "Resources" in the repositioning = the artifact/source corpus (ADR 0001) grouped under a project. Project-scoping is the natural grouping and **preserves the B4 artifact moat's reuse story: cite once, reuse across the project.** Backfill mirrors `0019`'s artifact backfill exactly — walk `moment_artifacts`/`story_artifacts` → `nodes` → `timelines` to find the timeline, then take **that timeline's `projectId`** (set earlier in the same migration); orphans fall back to the owner's single default project; the sole-user fallback covers self-host. Like `ownerId`, `projectId` here is **nullable + write-path-enforced**, never NOT-NULL-on-populated. *Subtlety:* an artifact reused across **two timelines in different projects** is ambiguous to backfill — slice 1 assigns it to **one** project (its first linked timeline's) and treats `projectId` as "home project," NOT a hard reuse boundary (search/citation can still cross within an owner). Cross-project artifact reuse policy is an Open question, deferred — but the column being "home project, not a fence" means we never have to *un*-scope it later.

### D9 — Project CRUD is metadata, **NOT** in the Patch stack — confirmed and locked.

Creating/renaming/deleting a project, and setting its `theme`/`world`/`brandRef`, are **direct owner-scoped CRUD** (`db/projects.ts`), exactly like `setTimelineTheme`/`setTimelineView`/`renameTimeline` (`graph.ts:41–77`). *Justification:* the Patch engine exists to make **graph mutations** (nodes/edges) atomically undoable (`schema.ts:174`); it is per-timeline (`patches.seq` is monotonic *per timeline*, `schema.ts:179`). A project is a container above the timeline — there is no per-project graph, no `seq` to order against, and "undo deleting a project" is not a graph operation. Forcing project CRUD into Patches would either need a new per-project undo stack (scope creep, unasked) or pollute a timeline's stack with cross-timeline events (breaks the invariant). So project CRUD sits beside the other metadata setters, outside the engine. **The Patch engine is not touched by this ADR at all.** (Project *delete* cascades to its timelines and their graphs via FK — that's a destructive admin action with a confirm, not an undoable edit; same posture as `deleteTimeline` today, `graph.ts:50`.)

### D10 — Read scoping: extend `ToolCtx` with `projectId?`, add three project tools, make existing tools project-aware additively.

- **`ToolCtx`** (`registry.ts:42`) gains an **optional** `projectId?: string` — the "active project" for a build session. *Justification:* most existing handlers key off `ownerId` + a `timelineId` they already own-check (`requireOwned`, `registry.ts:60`); they do not *need* a project to function. Adding `projectId` as **optional** means **zero existing handler breaks**, and project-aware behavior is opt-in: `list_timelines` filters by `projectId` **when present**, else returns all the owner's timelines (today's behavior preserved). `create_timeline` assigns the call's `projectId` when present, else the owner's default project.
- **Three new tools:** `create_project` (title → new project, returns id+slug+url), `list_projects` (the owner's projects, newest first), `get_project` (one project's metadata + its timelines/resource counts). These are owner-scoped via `ctx.ownerId`, identical in shape to `create_timeline`/`list_timelines`/`get_timeline` (`registry.ts:142–188`).
- **Ownership composition:** a project is owned (it has `ownerId`); a timeline is owned **and** belongs to a project. `requireOwned(timelineId)` (`registry.ts:60`) is unchanged — it already proves owner via `getTimelineMeta`. Project ownership is the same check one level up (`makeRequireOwnedProject`). Because timeline→project is within a single owner, **owner-scoping already prevents all cross-tenant access**; the project filter is an *organizational* narrowing within an owner, not a second security boundary. The security boundary stays exactly where Phase 2 put it: `ownerId`. *Justification:* one boundary, proven by `verify:isolation`; projects add grouping, not a new attack surface.

### D11 — Sharing stays **per-timeline** in slice 1; a project has no `isPublic`. Recommended minimal answer.

The existing public model — `timelines.isPublic` (`schema.ts:80`) + the no-auth `/s/$slug` story page (`src/routes/s.$slug.tsx`, `getPublicStory` gated on `timeline.isPublic`) — is **untouched**. A project carries **no visibility flag** in slice 1; you still publish by making a timeline public (which publishes its story). *Justification (steelman the alternative first):* one could argue a project should be the shareable unit (a public "world" browsable end-to-end) — that matches the long-term vision. But (a) the repositioning explicitly defers "public *browsing* of whole workspaces" (CLAUDE.md guardrail), (b) `canView` (`graph.ts:97`) and the entire public reader are built on `timeline.isPublic` and changing the share unit is a meaningful surface change with its own UX, and (c) slice 1's job is the container, not a new sharing model. **The minimal correct slice-1 answer: keep sharing per-timeline; the public reader doesn't even need to know projects exist.** Project-level visibility (a public project landing that lists its public stories) is a clean later addition — `projects.isPublic` + a `/p/$slug` route — gated behind its own ADR, and *additive* to per-timeline sharing (a project being public would simply surface its already-public timelines). Flagged in Open / deferred.

---

## Schema

Concrete, Postgres-portable Drizzle DDL. Conventions match the existing schema (`text` ids via `newId`, JSON via `text({ mode: 'json' })`, system time via `now`, indexes via the array form). **This ADR is design-only — it does not generate the migration.**

```ts
// --- domain enum + type (src/lib/domain/types.ts, alongside the existing ones) ---

// Project truth model. Designed in now (D2); slice 1 only writes 'nonfiction'.
export const PROJECT_KINDS = ['nonfiction', 'fiction'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

// World / basemap config (D3). Reserved seam — full shape is a P4 concern.
// null (or { basemap: 'earth' }) == real Earth. Slice 1 leaves it null.
export type ProjectWorld = { basemap: 'earth' } | { basemap: 'custom'; topojsonUrl: string } // P4 extends this

// --- projects: the top-level owned container (D1) ---
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner. Nullable for migration safety (matches timelines.ownerId / artifacts.ownerId);
    // new projects ALWAYS set it. Reads are owner-scoped, fail-closed.
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // URL handle (D6). Global-unique; the creating server fn slugifies title + dedupes.
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    // Truth model (D2). Default 'nonfiction'; fiction is P4-additive.
    kind: text('kind', { enum: PROJECT_KINDS }).notNull().default('nonfiction'),
    // World/basemap config (D3). null == Earth. Reserved seam for P4.
    world: text('world', { mode: 'json' }).$type<ProjectWorld>(),
    // Opaque external Realscript brand id (D4). No FK — it lives in another system.
    brandRef: text('brand_ref'),
    // Project-level default theme (D5). SAME shape as timelines.theme (TimelineTheme).
    // Timelines inherit at read time (timeline.theme ?? project.theme ?? defaults).
    theme: text('theme', { mode: 'json' }).$type<TimelineTheme>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [index('projects_owner_id_idx').on(t.ownerId)],
)

export type ProjectRow = typeof projects.$inferSelect

// --- timelines: + projectId (D7) ---
// Added as a NULLABLE column (migration-safe, matches ownerId). Write path always
// sets it; reads tolerate null (surfaces under the owner's default project).
// (the existing `timelines` definition gains this column + index)
projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
// ...and in the table's index array:
index('timelines_project_id_idx').on(t.projectId),

// --- artifacts + sources: + projectId (D8) ---
// Both gain the same nullable, indexed column. "Home project," not a reuse fence.
projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
// artifacts index array: index('artifacts_project_id_idx').on(t.projectId)
// sources index array:   index('sources_project_id_idx').on(t.projectId)
```

**Notes on the DDL choices:**
- **`onDelete: 'cascade'` on every `projectId` FK** — deleting a project removes its timelines (and, by their existing cascades, the timelines' nodes/edges/patches/stories) and its resources. This is the deliberate, destructive admin semantics of D9 (a project delete is a confirm-gated wipe, not an undoable edit). It mirrors `deleteTimeline`'s existing cascade posture.
- **`ownerId` on `projects` stays nullable** — consistent with `timelines.ownerId` (`schema.ts:77`) and `artifacts.ownerId` (`schema.ts:348`); the write path always sets it, reads fail closed on null. No NOT-NULL on a table we may later need to migrate.
- **No new column on `timelines.theme`** — theme inheritance (D5) is a read-time resolve, so `timelines.theme` is unchanged; only `projects.theme` is new.
- **No FTS / virtual tables / triggers** — unlike ADR 0001, this migration is plain drizzle-kit-generated DDL plus hand-written backfill `UPDATE`s (the part drizzle-kit won't author). No hand-authored virtual tables.

---

## Migration & rollout

**Next free migration number: `0020`.** Confirmed against `drizzle/` — highest existing is `0019_dizzy_toro.sql` (the Phase 2 multi-tenant migration). **This ADR does not generate the migration; design-only.** A builder runs `bun run db:generate` for the table + column DDL, then **hand-appends the backfill `UPDATE`s** (drizzle-kit generates `CREATE TABLE` / `ALTER TABLE ADD COLUMN` but never data backfill) into the generated `0020_*.sql`, following migration `0019`'s exact idiom.

**The migration shape (mirrors `0019` — nullable add → correlated backfill → sole-user fallback; NO rebuild):**

1. `CREATE TABLE projects (...)` — the new table (drizzle-generated).
2. `ALTER TABLE timelines ADD project_id text REFERENCES projects(id);` + `CREATE INDEX timelines_project_id_idx ...` (nullable add — **no rebuild**, the D7/constraint-4 decision).
3. `ALTER TABLE artifacts ADD project_id ...` / `ALTER TABLE sources ADD project_id ...` + their indexes (nullable adds).
4. **Backfill (hand-written, idempotent, no-op on a fresh hosted DB):**
   - **One default project per existing owner.** For each distinct `timelines.owner_id` (non-null) with no project yet, insert a project `{ id: <uuid>, ownerId, slug: 'my-first-project' (deduped), title: 'My first project', kind: 'nonfiction' }`. Because pure-SQL UUID generation + per-row slug dedupe is awkward in a `.sql` migration, this default-project seeding is the one step better done in a **tiny migration helper run alongside** (a `tsx` step the builder invokes, in the spirit of `0019`'s data steps) OR as a `INSERT ... SELECT` with `lower(hex(randomblob(16)))` for the id and a slug suffixed by the owner's rowid to guarantee uniqueness. **Recommend the `INSERT ... SELECT` form** so the whole migration stays in `0020_*.sql` (no external script to forget), using `'my-first-project-' || (SELECT COUNT(*) ...)`-style disambiguation; the human-facing title stays "My first project" for everyone.
   - **Point every timeline at its owner's default project:** `UPDATE timelines SET project_id = (SELECT p.id FROM projects p WHERE p.owner_id = timelines.owner_id LIMIT 1) WHERE project_id IS NULL AND owner_id IS NOT NULL;`
   - **Sole-user self-host fallback** (matches `0019:29`): for any still-null timeline when exactly one user exists, attach to that user's default project.
   - **Resources** (artifacts/sources): set `project_id` from the linked timeline's `project_id` via the `moment_artifacts`/`story_artifacts` → `nodes` → `timelines` walk (copy `0019:16–28` verbatim, selecting `t.project_id` instead of `t.owner_id`); orphans → the owner's default project; sole-user fallback last. Sources inherit from their artifact (mirror `0019:31–33`).
5. **No NOT-NULL promotion** in `0020` (D7). `project_id` stays nullable everywhere; the write path enforces presence.

**Backfill safety properties (the no-orphan guarantee):**
- A fresh hosted DB has no rows → every backfill `UPDATE` no-ops; the table is created empty. Safe.
- An upgrading self-host install (one user, N timelines) → one default project, all timelines + resources attached, sole-user fallback covers any link-graph gap. Nothing orphans.
- A multi-user upgrading install → one default project **per owner**, each owner's timelines/resources attached to *their* project. The sole-user fallback is correctly skipped (count ≠ 1), so no cross-tenant attachment can happen. **Fail-closed: a row the backfill can't confidently place stays `project_id = NULL` and surfaces under its owner's default project at read time — never attached to the wrong owner, never hidden.**

**No-break guarantee:** every existing server fn (`src/lib/server/timelines.ts`) and MCP tool keeps working — `projectId` is optional in `ToolCtx`, `list_timelines` without a project returns the full owner list (today's behavior), and the public reader (`/s/$slug`) never reads projects. The home dashboard keeps rendering until the project-list UI is wired (it can show "all timelines" exactly as today, then gain a project layer).

**Verification (extend the shipped isolation test):** add `verify:projects` modeled on `scripts/verify-isolation.ts` — drive the **real registry handlers** with two distinct `ToolCtx` (users A and B): assert A can `create_project` / `list_projects` / `get_project`; assert B's `get_project(A's id)` is **denied**; assert `create_timeline` under A's `ctx.projectId` lands in A's project and is invisible to B; assert `list_timelines` with a `projectId` filters to that project and without one returns all of the owner's timelines. Run under Node (`bun run verify:projects`). Keep `verify:isolation`, `verify:mcp`, and the e2e suite green.

---

## Consequences

**Positive**
- **The container exists with zero new infrastructure** — `projects` reuses the shipped `ownerId` ownership pattern, so isolation is proven the moment `verify:projects` (a clone of `verify:isolation`) passes. No new security boundary to reason about.
- **Every later phase has its home.** `kind` (P4 fiction), `world` (P4 basemap), `brandRef` (P2 Realscript brand), `theme` (project-level look) are all reserved now, so P2–P5 become **additive** — set a column, wire a reader — never a populated-table migration.
- **Theme inheritance with no data migration** (D5) — `timeline.theme ?? project.theme ?? defaults` is a read-time rule reusing `TimelineTheme` + `timelineThemeSchema`; changing a project's theme re-themes its timelines automatically, nothing drifts.
- **Migration follows the proven `0019` shape** — nullable add + correlated backfill + sole-user fallback, **no NOT-NULL rebuild**, fail-closed no-orphan. The exact gotcha the team already hit is designed around, not re-encountered.
- **The Patch engine is untouched** (D9) — project CRUD is metadata beside the other setters; undo/redo knows nothing about projects, so the core mechanic carries zero new risk.
- **The MCP contract extends additively** (D10) — `ToolCtx.projectId` is optional, existing tools keep their current behavior with no project, three new tools mirror existing ones. No BYO-client breakage; the in-app agent and the MCP server stay one tool surface.
- **Sharing is unchanged** (D11) — the public reader doesn't learn about projects; slice 1 ships no new sharing surface to get wrong.

**Negative**
- **`projectId` is nullable + write-path-enforced, not DB-enforced** (D7/D8) — the "every timeline has a project" invariant lives in application code (`createTimeline` always sets it), not a NOT-NULL constraint. A code path that inserts a timeline **without** setting `projectId` would create an unassigned timeline. Mitigated: there is exactly one timeline-create path (`createTimeline`, `graph.ts:36`) and `verify:projects` asserts it sets the project; reads tolerate null (degrade, not orphan). The NOT-NULL hardening is a deliberate later migration once all installs are known-backfilled.
- **Backfill places ambiguous reused artifacts in one project** (D8) — an artifact linked across timelines in different projects gets a single "home project." Accepted because `projectId` is "home, not fence" (search/citation can still cross within an owner), and cross-project reuse policy is explicitly deferred. The decision to make it a home rather than a boundary is what keeps this from being a trap later.
- **A small read-path branch everywhere `projectId` is optional** — `list_timelines` and the home query gain an "if project, filter; else all" branch. Minor, but it's surface that must stay consistent between the server fn and the MCP tool.
- **Default-project seeding in pure SQL is slightly awkward** — UUID + unique-slug generation in a `.sql` backfill needs the `lower(hex(randomblob(16)))` / rowid-suffix idiom (the one part not copy-paste from `0019`). Mitigated by recommending the in-migration `INSERT ... SELECT` form so there's no external script to forget; a builder must get this one statement right (called out in the checklist).

**Neutral**
- `projects.slug` is global-unique (D6), diverging from a possible per-owner namespace — intentional for slice-1 simplicity; a clean future change if owner-namespaced project URLs are ever wanted.
- `brandRef` has no FK (D4) — diverges from every other reference in the schema, but correctly: it points at another system. Same posture ADR 0001 took for *not* over-modeling.
- `world` is a reserved-but-unused JSON column in slice 1 — carrying it now is a deliberate cheap bet against a P4 populated-table migration.

---

## Alternatives considered

- **No container; reuse `timelines` as the group (rejected).** Tag timelines with a free-text "project" label instead of a table. Fails immediately: `kind`/`world`/`brandRef`/`theme` are *project* properties with no home on a timeline, theme inheritance has nowhere to inherit *from*, and every later phase (P2–P5) would have to invent ad-hoc per-label storage. A table is the honest model and costs no more than the shipped `timelines` table did.
- **`projectId` NOT NULL via table rebuild (rejected — the headline rejection).** Add `project_id` as NOT NULL by letting drizzle-kit do its 12-step rebuild (create new table, copy, drop, rename). This is **exactly the NOT-NULL-rebuild gotcha Phase 2 hit and fixed** (constraint 4). On SQLite a rebuild of `timelines` mid-migration risks the FK fan-in (nodes/edges/patches/stories all reference `timelines.id`) and is the high-blast-radius operation we have a proven, safer alternative for. Rejected in favor of `0019`'s nullable-add-then-backfill, with NOT-NULL hardening deferred to a verified later migration.
- **Project CRUD inside the Patch engine (rejected).** Make project create/delete undoable Patches for a uniform "everything is undoable" story. Breaks the per-timeline `seq` model (`schema.ts:179`) — a project is above the timeline, with no per-project graph and no `seq` to order against — and would either need a whole new undo stack (unasked scope) or pollute timeline stacks with cross-timeline events. Project CRUD is metadata, like the theme/view setters; it stays out of the engine (D9).
- **Per-timeline `projectId` copied theme instead of inherited (rejected).** Copy `project.theme` onto each timeline at assignment for a simpler read (`timeline.theme` always set). Reintroduces the drift ADR 0001 D8 fought: two copies of the theme, and changing the project theme silently fails to update already-assigned timelines. Read-time inheritance (D5) is drift-free and needs no theme migration.
- **Project as the sharing unit now (rejected for slice 1).** Make `projects.isPublic` + a public project page the share model. Steelmanned in D11: it matches the long-term "public world" vision. Rejected for slice 1 because the entire public stack is built on `timeline.isPublic` + `/s/$slug`, "public browsing of whole workspaces" is an explicit guardrail deferral, and changing the share unit is its own UX surface. Kept per-timeline; project-level visibility is a clean additive later ADR.
- **Cross-timeline shared entities in slice 1 (rejected / deferred).** Let one entity node belong to many timelines within a project (one "character" across stories). A genuinely useful future capability, but a **much** bigger model change: nodes are per-timeline today (`nodes.timelineId NOT NULL`, `schema.ts:140`), the whole graph/Patch/canvas stack assumes it, and it would touch loading, the Patch engine's id space, and the canvas. Project-as-grouping first (timelines own their nodes); shared entities revisited after slice 1 (Open / deferred).

---

## Open / deferred

- **`projectId` → NOT NULL hardening** — a later migration once every install is known-backfilled, done via a *verified* rebuild (not a blind ALTER), with a guard that fails loud if any null `project_id` remains. Deferred (D7).
- **Cross-project artifact reuse policy** — slice 1 gives each artifact a single "home project" but does not fence search/citation by project (owner-scope still governs). Whether reuse should cross projects, be confined, or be a deliberate "import," is a product+schema question for a later ADR (D8).
- **Cross-timeline shared entities** — one entity node referenced by many timelines within a project. Deferred to its own ADR (a real graph-model change); timelines own their nodes in slice 1.
- **Project-level visibility / public project page** — `projects.isPublic` + a `/p/$slug` landing that lists the project's public stories. Additive to per-timeline sharing; its own ADR when "public worlds" is earned (D11).
- **`ProjectWorld` / globe-basemap schema** — the *shape* of `world` (Earth | preset | custom topojson + bounds) and the globe refactor are the **P4 globe-basemap ADR**, not this one. This ADR only reserves the column (D3).
- **Scheduled serialized generation + proposed-patch review** (the morning-chapter loop) — **P3, separate ADR.** Needs a cron/scheduler seam and an agent-run-with-review model; out of scope here.
- **Conversational entities** (live chat grounded in entity + time window) — **P5, separate ADR.** Out of scope here.
- **Realscript brand/scheduler HTTP clients** — P2/P6 integration ADRs; this ADR only reserves `brandRef` (D4).
- **Stories-as-default-lens at the project level** — a light UI note from the repositioning (`stories-first-pivot.md` §2): when a project opens, the `?view=stories` lens is the default. This is a front-end default (the lens switcher already exists), **not** a data-model decision — it rides along in the P1 UI work, no schema implication.

---

## Slice-1 implementation checklist

Ordered for execution. Every path is real (verified this pass). Build bottom-up: schema → migration → db layer → server RPCs → MCP tools → UI, verifying after the migration and again at the end. **This is build work — route it through Sal per the project's pipeline; do not hand-edit production code from the ADR.**

**1 — Domain types** (`src/lib/domain/types.ts`)
- Add `PROJECT_KINDS = ['nonfiction','fiction'] as const` + `ProjectKind`.
- Add `ProjectWorld` type (minimal: `{ basemap: 'earth' } | { basemap: 'custom'; topojsonUrl: string }`) — reserved seam.

**2 — Schema** (`src/lib/db/schema.ts`)
- Add the `projects` table (DDL above) + `export type ProjectRow`.
- Add `projectId` (nullable, `references(() => projects.id, { onDelete: 'cascade' })`) + `timelines_project_id_idx` to `timelines`.
- Add `projectId` (same) + index to `artifacts` and `sources`.
- (Optional, D2 future-proofing already covered by the column — no other schema change.)

**3 — Migration** (`drizzle/0020_*.sql`) — **next free number is 0020** (highest is `0019_dizzy_toro.sql`)
- `bun run db:generate` to produce the `CREATE TABLE projects` + three `ALTER TABLE ADD COLUMN project_id` + indexes.
- **Hand-append the backfill**, copying migration `0019`'s idiom (`drizzle/0019_dizzy_toro.sql` lines 13–35):
  1. Seed one default project per distinct non-null `timelines.owner_id` (title "My first project", `kind='nonfiction'`) via `INSERT ... SELECT` using `lower(hex(randomblob(16)))` for the id and a collision-safe slug — **the one statement to get exactly right**.
  2. `UPDATE timelines SET project_id = (owner's default project) WHERE project_id IS NULL AND owner_id IS NOT NULL`.
  3. Sole-user self-host fallback for any residual null (mirror `0019:29,34`).
  4. Backfill `artifacts.project_id` / `sources.project_id` from the linked timeline's `project_id` (the `moment_artifacts`/`story_artifacts` → `nodes` → `timelines` walk, copying `0019:16–33`, selecting `t.project_id`); orphans → owner's default project; sole-user fallback last.
- `bun run db:migrate`, then run **`verify:isolation`** + **`verify:mcp`** to confirm nothing regressed on the existing surface.

**4 — db layer** (`src/lib/db/projects.ts`, new — mirror `src/lib/db/graph.ts`'s timeline CRUD)
- `createProject(title, ownerId): ProjectRow` (slugify + dedupe), `listProjects(ownerId)`, `getProject(id) / getProjectMeta(id)`, `renameProject`, `deleteProject(id, ownerId)` (cascade), `setProjectTheme(id, ownerId, theme)` / `setProjectWorld` / `setProjectBrandRef`, and `ensureDefaultProject(ownerId)` (returns the owner's default project id, creating it if absent — the runtime companion to the migration backfill, so new signups get a project).
- `makeRequireOwnedProject(ownerId)` guard (mirror `makeRequireOwned`, `registry.ts:60`).
- In `graph.ts`: `createTimeline(title, ownerId, projectId)` now **requires** a `projectId` (resolve via `ensureDefaultProject` at the call site when none given); `listTimelines(ownerId, projectId?)` gains an optional project filter. `TimelineMeta` may carry `projectId` for theme inheritance.

**5 — Theme inheritance** (`resolveTimelineTheme`, wherever it lives — `src/lib/db/graph.ts` / `domain/theme.ts` / the canvas)
- Resolve `timeline.theme ?? project.theme ?? defaults` (D5). Load the project's theme alongside the timeline meta on canvas open. (Can be the last step within P1 — the column + tools land first.)

**6 — Server RPCs** (`src/lib/server/projects.ts`, new — mirror `src/lib/server/timelines.ts`)
- `listProjects`, `createProject`, `renameProject`, `deleteProject`, `setProjectTheme` — each `requireUser()` then owner-scoped db call (copy the shape from `server/timelines.ts:29–96`).
- Update `server/timelines.ts`: `createTimeline` accepts an optional `projectId` (default via `ensureDefaultProject`); `listTimelines` accepts an optional `projectId` filter.

**7 — MCP tools** (`src/lib/mcp/registry.ts`)
- Extend `ToolCtx` (`registry.ts:42`) with optional `projectId?: string`.
- Add `create_project`, `list_projects`, `get_project` (mirror `create_timeline`/`list_timelines`/`get_timeline`, `registry.ts:142–188`; owner-scoped via `ctx.ownerId`; `get_project` own-checks via `makeRequireOwnedProject`).
- Make `create_timeline` assign `ctx.projectId ?? ensureDefaultProject(ownerId)`; make `list_timelines` filter by `ctx.projectId` when present.
- Wire `ctx.projectId` through both callers (`buildMcpServer` in `src/lib/mcp/server.ts` and the agent runner in `src/lib/agent/runner.ts`) — default to the owner's default project when the session has no active project, so single-project users never notice.

**8 — UI: project list / home + create-and-open** (minimal)
- `src/routes/index.tsx` → `SignedIn` (`src/components/home/SignedIn.tsx` + `TimelinesSection.tsx`): introduce a project layer — the dashboard lists **projects**; opening one shows its timelines (reuse `TimelinesSection`, now project-scoped). Smallest version: a project switcher/header above the existing timeline list, defaulting to the owner's default project so the current view is preserved on day one.
- A "New project" affordance (mirror `NewTimelineDialog.tsx`) → `createProject` → open it.
- New timelines are created **within** the active project (pass `projectId` to `createTimeline`).
- Set the project's default lens to `?view=stories` when opening (front-end default; no schema change).
- (A dedicated `/projects` or `/p/$id` route is optional for slice 1 — the home dashboard carrying the project layer is enough.)

**9 — Verify**
- Add **`verify:projects`** (clone `scripts/verify-isolation.ts`): two users, assert project create/list/get works, the non-owner is denied `get_project`, timelines created under A's project are invisible to B, and the `list_timelines` project filter behaves (filtered when `projectId` set, full owner list when not).
- Run `verify:projects` + `verify:isolation` + `verify:mcp` + `bun run typecheck` + the e2e suite (`bun run test:e2e`). All green before merge.

**10 — Docs**
- Update `CLAUDE.md` (data-model section + project structure) to describe `projects` and the container hierarchy. Update `docs/README.md` if it indexes the data model. (Margot owns the product-strategy/roadmap rewrite — do **not** touch product docs here.)
