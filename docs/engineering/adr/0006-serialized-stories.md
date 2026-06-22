# ADR 0006 — Serialized stories: series, chapters, and the next-chapter loop

- **Status:** Proposed (Kael, 2026-06-22) — pending founder sign-off. Implements roadmap **P3** (Serialized stories + the morning-chapter loop).
- **Date:** 2026-06-22
- **Deciders:** Kael (Chief Engineer, owner) · founder/Aaron (sign-off, drove the reframe) · Sal (conducts the slices) · Margot (product framing, async)
- **Scope:** The **series layer** — a new `story_series` container under `projects`, `seriesId` + `chapterNumber` on `stories`, a `patch_story` MCP tool for surgical chapter edits, a `get_series` read (the anti-duplication watermark), the opt-in graph-enrich flag on the chapter loop, the public **series page** (`/sr/$slug`, played/explored in order), and a client-side "write the next chapter" skill. **No in-app scheduler.**
- **Decision record this implements:** `../../product/roadmap.md` → **P3**; `../../product/stories-first-pivot.md` §6.
- **Builds on:** ADR [0003](./0003-projects-container.md) (the Projects container — series is its child) · ADR [0004](./0004-shared-entities.md) (the precedent for a **separate, domain-scoped undo stack**, `entity_patches`) · the shipped story layer (`stories` / `story_segments`, `write_story`) and the public story page (`getPublicStory`, `/s/$slug`).
- **Explicitly NOT in scope (separate future work):** in-app cron/scheduling (deliberately dropped — see D1), generated fiction worlds (P4), conversational entities (P5), social-scheduler distribution of a finished series (P6), and the `story_patches` beat-level undo stack (designed here, deferred to a fast-follow — see D6).

---

## Context

The story layer ships today: a `story` hangs off a single `momentId` (a node), holds an ordered list of `story_segments` (beats), and is written via the `write_story` MCP tool. A moment can already hold **several** stories — but they are an unordered **bag**: no link between them, no sequence, no notion of "the next one." `write_story` with an existing `storyId` **replaces** that story's meta + beats wholesale (`registry.ts:585`); there is no surgical edit path. There is no `series`/`chapter` column on `stories` (`schema.ts:448–482`).

Roadmap **P3** wants the headline magic: a story becomes a **series of chapters**; "write the next chapter" pulls from existing entities/periods/citations and **enriches** the timeline + globe as it goes, one chapter at a time — the literal North Star ("opens a Project, says *write the next chapter*, watches their world grow a beat at a time, and **publishes** it").

The original roadmap framing assumed P3 depends on **a scheduling/cron seam**. The founder's reframe (2026-06-22) removes that assumption: **the loop is driven from the user's MCP client (Claude Cowork), not the app.** The cadence, the trigger, the prompt, and the research all live client-side. That flips the work from "build a scheduler" to "give the tool surface + skills the durable state and contracts the *write-the-next-chapter* job needs."

**The hard constraints this design lives inside (verified against the code, not assumed):**

1. **Postgres-portable, hosting-aware.** App-generated `text` ids (`crypto.randomUUID()`), JSON via `text({ mode: 'json' })`, time via `integer({ mode: 'timestamp_ms' })`. No new column type breaks that.
2. **Owner-scoped, fail-closed multi-tenant.** `ownerId` is the only security boundary; reads are scoped at the entry points (server fns + `ToolCtx.ownerId`/`requireOwned`), the `db/*` layer trusts its guarded caller. Series inherits ownership transitively through `projectId` → `projects.ownerId`, and is re-checked at every entry point (no new boundary).
3. **The Patch invariant is sacred.** One graph edit = one atomic undoable Patch. Stories are **deliberately outside** the graph Patch engine (`schema.ts:378–389`). The series layer stays outside it too — series/chapter mutations are story-layer CRUD, not `GraphOp`s. The **graph enrich** step (D5) is the *only* part that touches the graph, and it goes through the existing `apply_patch` path unchanged, so the invariant holds for free.
4. **Migration discipline — no NOT-NULL rebuild.** Follow the `0019`/`0020` shape: nullable-add + owner/parent-scoped backfill, never a NOT-NULL add on a populated table, never a 12-step rebuild. `seriesId`/`chapterNumber` land **nullable** (a one-off story belongs to no series).

Verified before locking: `schema.ts` (stories/story_segments/entity_patches), `registry.ts` (`write_story`, `set_story_theme`), `src/lib/server/stories.ts` (`getPublicStory`), `src/components/public/`, latest migration `0027`.

---

## Decision

Ten decisions, each with a one-line justification. DDL in **Schema**; executable order in **Slice breakdown**.

### D1 — No in-app scheduler. The loop is client-driven; the app persists only ordering + a watermark.

The cadence comes from the user's MCP client (Cowork). The **only** state that must live server-side regardless of who pulls the trigger is (a) series → chapter **ordering** and (b) a cheap **coverage watermark** so chapter N+1 enriches rather than duplicates. *Justification:* the inversion posture already puts intelligence client-side; a cron seam would be the app re-acquiring a job the client owns. Dropping it removes the single biggest assumed dependency of P3 and keeps Synek a pure viewer + tool surface.

### D2 — Series is a NEW first-class child of `projects` — NOT a repurposing of `projects`.

A `story_series` table sits between `projects` and `stories`. A project holds **many** series; a series **orders** its chapters. *Justification:* a project is a **world/workspace** (and the org/security narrowing boundary, ADR 0003); a series is a **narrative sequence** with order and a frontier. They differ in cardinality (one world hosts several narratives) and lifecycle (series is ordered, projects are not). Merging them forces a NOT-NULL retrofit the moment a world needs a second narrative, and overloads the row that already carries brand/theme/world/kind + the cinematic-home filter + `ctx.projectId`. An additive table has **lower total blast radius** than repurposing the existing container, because it touches nothing that ships today.

### D3 — `stories` gains nullable `seriesId` (FK `story_series`, set null on series delete) + `chapterNumber` (int).

A story with `seriesId = null` is a standalone story (today's behavior, unchanged). A story in a series carries its 1-based `chapterNumber`. *Justification:* chapters **are** stories — so per-chapter sharing (`stories.isPublic`), per-chapter theme, status, cast, and the whole existing reader come for free. Set-null (not cascade) on series delete so dissolving a series leaves its chapters as standalone stories rather than destroying authored content.

### D4 — Chapters anchor on their OWN moments (Fork 1 = B). The series is the link; the moment is per-chapter.

Chapter 3 (a 2023 event) anchors on a 2023 node; chapters lay a trail down the timeline as the world grows. *Justification:* matches the North Star ("the world grows a beat at a time") and the canvas semantics (a chapter badges the moment it's about). The series, not a shared anchor moment, is what binds them — which is exactly what D2's table provides.

### D5 — The next-chapter loop MAY enrich the graph, opt-in, never by default.

Default = narrate over the existing graph. An explicit per-run flag lets the loop grow the timeline: research → `apply_patch` (adds nodes/citations) → *then* `write_story`. *Justification:* the founder's call — growing the timeline is the magic but the user decides per-run whether the chapter must fit the current world or extend it. The enrich step rides the existing `apply_patch` path, so it is already proposable/approvable/undoable under the Patch invariant with zero new machinery.

### D6 — `patch_story`: surgical, atomic story edits, mirroring `apply_patch`'s batch shape.

`write_story` (replace-whole-story) is wrong for touching one beat. `patch_story(storyId, ops[])` applies a batch atomically: `add_segment` (append/insert at `sequence`), `update_segment`, `delete_segment`, `reorder_segments`, `update_meta` (title/hook/cast/cover/theme/status/isPublic). *Justification:* the chapter loop and the editor both need cheap, partial mutations; a familiar op-batch shape keeps it consistent with `apply_patch`. **Division of labor:** `write_story` *creates the next chapter* (new story, `seriesId` + `chapterNumber = N+1`); `patch_story` *edits an existing chapter*. No overlap.

### D7 — `patch_story` is undoable via a SEPARATE `story_patches` stack — designed now, built as a fast-follow.

Stories are outside the graph Patch stack, but ADR 0004 set the precedent for a separate domain-scoped stack (`entity_patches`, keyed by `entityId`). Mirror it: `story_patches`, keyed by `storyId` + `seq`. *Justification:* keeps the "propose → approve → revert" trust model intact without teaching the graph engine about stories. **Scope discipline:** slice 1 ships `patch_story` *without* the stack (chapter-level revert is just "delete that story" — `write_story`/series delete already do this); the stack lands in the fast-follow when beat-level undo is wanted.

### D8 — `get_series`: one read returns the series in order + the anti-duplication watermark.

Returns: series meta, chapters ordered by `chapterNumber` (title/hook/status/`isPublic`/`momentId`), the **union of node ids each chapter cites/references**, and the **frontier** (max `chapterNumber`, max covered instant). *Justification:* this read is the watermark — it is how the client knows chapter N's boundary, what's already been narrated, and where to advance. It pairs with the existing `get_layout_report` (graph-side watermark) so the loop dedups against *both* the graph and the narrative.

### D9 — The frontier is DERIVED, not a stored mutable cursor.

`get_series` computes frontier from the chapters (max `chapterNumber`, max covered instant) at read time. *Justification:* a stored pointer drifts from reality the moment a chapter is deleted, reordered, or edited; deriving it is cheaper than maintaining it and is self-healing. No "current chapter" column on `story_series`.

### D10 — A series is a first-class PUBLIC, playable surface: `/sr/$slug`.

A series gets its own shareable page — a "Netflix season": cover, ordered chapter list, play-in-order, explore. `story_series.isPublic` gates it (independent of any chapter's `isPublic`, mirroring the story/timeline split). `getPublicSeries` returns the series + its public chapters in order; the page reuses the `PublicStoryReader` per chapter with next-chapter continuation. *Justification:* the founder wants the series shareable and explorable in order — and per-chapter sharing already exists, so this is a series-level index over a proven reader, not a new reader. SSR OpenGraph mirrors `/s/$slug`.

---

## Schema (migration `0028`, additive)

```sql
-- New: the narrative spine, a child of projects.
CREATE TABLE story_series (
  id            text PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id      text REFERENCES user(id) ON DELETE CASCADE, -- denormalized for fail-closed scoping, like other owned rows
  slug          text NOT NULL UNIQUE,                       -- slugify-then-dedupe, global-unique like projects/stories
  title         text NOT NULL,
  hook          text,
  cover_image   text,                                       -- JSON StoryImage, the season cover
  theme         text,                                       -- JSON TimelineTheme; series ?? timeline ?? project ?? defaults
  anchor_moment_id text REFERENCES nodes(id) ON DELETE SET NULL, -- optional "home" node for the series; chapters anchor on their own moments (D4)
  is_public     integer NOT NULL DEFAULT 0,                 -- gates /sr/$slug, independent of chapter visibility (D10)
  status        text NOT NULL DEFAULT 'active',             -- active | concluded | draft
  created_at    integer NOT NULL,
  updated_at    integer NOT NULL
);

-- Stories become chapters when they join a series (nullable — standalone stays the default).
ALTER TABLE stories ADD COLUMN series_id text REFERENCES story_series(id) ON DELETE SET NULL; -- D3
ALTER TABLE stories ADD COLUMN chapter_number integer;                                        -- D3

-- D7 — designed now, table created in the fast-follow slice (NOT migration 0028):
-- CREATE TABLE story_patches (
--   id text PRIMARY KEY, story_id text NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
--   owner_id text REFERENCES user(id) ON DELETE CASCADE,
--   seq integer NOT NULL, summary text NOT NULL,
--   ops text NOT NULL, inverse_ops text NOT NULL,           -- JSON StoryOp[]
--   status text NOT NULL DEFAULT 'applied', created_at integer NOT NULL
-- );
```

No NOT-NULL add on a populated table; `seriesId`/`chapterNumber` are nullable; no backfill needed (existing stories stay standalone). Drizzle migration generated from `schema.ts`, never hand-edited (the `0026`/FTS5 exception does not apply here).

## Tool surface (registry.ts)

| Tool | Status | Job |
|---|---|---|
| `create_series` | NEW | Create a series in a project (title/hook/cover/theme). Returns `seriesId` + `slug`. |
| `get_series` | NEW | The ordered chapters + covered node-ids + derived frontier — the watermark (D8/D9). |
| `write_story` | EXTEND | Optional `seriesId` + `chapterNumber` (or `appendToSeries: seriesId` → auto next number). Creates a chapter (D6). |
| `patch_story` | NEW | Atomic batch of story ops on one story (D6). No undo stack in slice 1 (D7). |
| `set_series_public` | NEW | Flip `story_series.isPublic` for the `/sr/$slug` page (D10). |

All owner-scoped: resolve `projectId`/`storyId` → owner, run the same guard the story tools use, fail closed.

## Public surface

- `getPublicSeries(slug)` server fn (sibling of `getPublicStory`, `src/lib/server/stories.ts`) — gated on `story_series.isPublic`; returns series meta + public chapters in `chapterNumber` order (only the nodes those chapters reference ship, no full-graph leak).
- `src/routes/sr.$slug.tsx` — SSR OpenGraph + Twitter cards (mirror `s.$slug.tsx`); a season index that plays chapters in order via the existing `PublicStoryReader`, with "next chapter →" continuation.
- Owner "Share series" control + a `Series` hero/row in the cinematic home (`src/components/home/cinematic/`).

---

## Consequences

**Positive.** P3 ships with **no scheduler**. Chapters reuse the entire existing story reader, per-story sharing, and theming. The series page is an index over a proven reader. `get_series` + `get_layout_report` give the loop a real anti-duplication watermark, so "write the next chapter" enriches instead of repeating. The enrich step rides `apply_patch`, so the Patch invariant is untouched. Migration is purely additive.

**Negative / risks.** (1) Three new tools + one extend widen the MCP surface — mitigated by the clear `write_story`-creates / `patch_story`-edits split. (2) `get_series` computing covered node-ids per read could get heavy on a long series — acceptable at expected sizes; index `stories(series_id, chapter_number)` and revisit if a series exceeds ~100 chapters. (3) Deriving the frontier (D9) means a malformed chapter ordering surfaces at read time, not write time — acceptable; the read is self-healing. (4) `patch_story` without an undo stack in slice 1 means a bad beat edit is only reverted by re-editing or deleting the chapter — flagged, and the stack (D7) is the named fast-follow.

**Neutral.** `story_series.anchor_moment_id` is optional and unused by chapters (which anchor on their own moments, D4); it exists for a future "series home on the canvas" affordance and costs nothing now.

---

## Alternatives considered

1. **Reposition `projects` → `series` (founder's question).** Viable but rejected (D2): cardinality breaks when a world hosts a second narrative, lifecycle mismatch (ordered vs. unordered), and it overloads the org/security boundary. An additive table is lower blast radius than repurposing the live container.
2. **Chapter = appended `story_segments` on ONE story.** Rejected: fights `write_story`'s replace semantics, collapses the series into one un-shareable mega-page, and loses per-chapter status/sharing/theme.
3. **Store a mutable frontier cursor on `story_series`.** Rejected (D9): drifts from the chapters; deriving is cheaper and self-healing.
4. **In-app cron/scheduled generation.** Rejected (D1): the client (Cowork) owns cadence; an in-app scheduler re-acquires a job the inversion gives to the client. (Revisit only if a non-client-driven hosted cadence is ever in scope — out of P3.)

---

## Slice breakdown (for Sal to ticket)

1. **Series schema + container** — migration `0028` (`story_series` + `stories.series_id`/`chapter_number`), `db/series.ts` CRUD (owner-scoped via project), `create_series` + `get_series` MCP tools, `verify:series` data-layer check. *(unblocks everything)*
2. **Chapter authoring** — extend `write_story` (`seriesId` + `appendToSeries` auto-next), `patch_story` tool + `db` ops (no undo stack), warnings parity with `write_story`.
3. **The next-chapter skill** — a client-side `synek` plugin skill (sibling of `synek:watch`): `get_series` → optional enrich (`apply_patch`, opt-in flag) → `write_story` chapter N+1. Read-before-write dedup against `get_series` + `get_layout_report`. Zero app code.
4. **Public series page** — `getPublicSeries` + `src/routes/sr.$slug.tsx` (SSR OG, play-in-order over `PublicStoryReader`), `set_series_public` tool, owner Share control.
5. **Series on the canvas/home** — `Series` hero/row in the cinematic home; series presence on the canvas (badge/anchor). *(UI slice, follows the data + tools)*
6. **`story_patches` undo (fast-follow, D7)** — `story_patches` table + apply/invert + `undo`/`redo` wiring for `patch_story`, mirroring `entity_patches`.

Slices 1→2→{3,4} are the P3 critical path; 5 and 6 are fast-follows.
