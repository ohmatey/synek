---
phase: S2
title: "Artifact grounding (the moat)"
status: "slice-1 shipped (S2.0 inline citations, 2026-06-10); S2.1–S2.4 deferred"
era: "Story Layer (the pivot)"
updated: 2026-06-10
---

# S2 — Artifact grounding (the moat)

> **Tap any sentence, see the letter it came from.** Every story beat can be traced to a primary source — a tablet, a diary entry, a photograph, a shopping list. This is the layer that makes the stories feel *real*, and the one a generic-AI competitor will skip.

## Why this phase, why this order

This is the **defensibility layer**. If a competitor can't easily replicate the primary-source grounding, they can't replicate the feel. It comes **right after the spine and before multi-POV/witness** on purpose: once grounding is first-class, every subsequent generated thing — alternate POVs (S3), interior monologues (S4) — inherits it. Grounding built late means re-grounding everything; grounding built second means it's free downstream.

> One inline "this detail comes from Tablet 291" is worth more trust than any "powered by AI" disclaimer.

## The experience

- In the reader, beats carry a quiet **citation affordance** — "from: *Claudia Severa's birthday invitation*". Tap it → an **artifact card**: transcript, translation, image, the source, and a **reliability note** ("primary, contemporaneous" vs "secondary, 200 yrs later").
- A new **artifact-first browse**: a library of artifacts, each linking to the stories it anchors. You can navigate the past *through the objects that survived it*, not only through time.
- When the AI generates or regenerates a story, it is **handed the moment's artifacts** and grounds beats in them — emitting which artifact each beat draws from.

## Goals

- Model sources and artifacts as first-class, reusable reference data.
- Let a story **anchor on** artifacts, and let each **segment cite** the artifact(s) it draws from.
- Feed artifacts into generation so grounding is produced, not bolted on.
- Surface grounding inline in the reader, and add an artifact-first browse view.

## Non-goals (explicitly deferred)

- **Multiple POVs** → S3. **Interior monologues** → S4.
- **Automated source ingestion / web crawling / scraping** — out of scope (that's deferred signal-ingestion territory). Artifact entry is **manual or AI-*suggested*-then-confirmed**, never auto-harvested.
- **Users / saved sources / signal** → deferred.

## Phasing — Slice 1 shipped (S2.0), full model deferred

The full S2 is four sub-tasks (**S2.1–S2.4**, detailed from *Data model delta* onward) that introduce first-class `sources` + `artifacts` tables, `story_artifacts` / `segment_citations` joins, a `write_story` v2 referencing pre-registered artifacts by id, and an artifact-card browse UX. That end-state is right but premature now, so a **minimal slice shipped first** and the normalized model becomes a later migration.

Why defer the full shape:

- **No artifact corpus exists yet.** First-class `artifacts` rows only pay off once an artifact is registered once and reused across many beats/stories (reliability scoring, browse-artifact-to-its-stories, dedupe). Today every citation is one-shot, produced inline by the MCP client as it writes the story. A join table over a single-use entity is pure overhead.
- **The node-citation shape already exists and is proven.** Graph nodes carry `metadata.citations: { title, url?, quote? }[]` (`Citation` in `schema.ts`), set via `apply_patch`. Reusing that exact shape on beats keeps one mental model and one renderer idiom, and is trivially Postgres-portable (a JSON text column).
- **Undo/redo is already safe for new segment columns.** `restoreStory` in `db/patches.ts` spreads the full `StorySegmentRow` (`{ ...seg }`), so any column added to `story_segments` round-trips through the moment-delete/undo snapshot for free — no engine change.

### Slice 1 — S2.0 inline per-beat citations ✅ shipped 2026-06-10

- Optional `citations: { title, url?, quote? }[]` per beat on the `write_story` input schema (mirrors the node-citation shape exactly).
- Persisted as a JSON column `citations` on `story_segments` (**not** a join table).
- Surfaced in `StoryBeat` / `StoryDTO` and rendered inline under each beat in `NodeDetailPanel`, matching the existing node-citation presentation.
- Postgres-portable: `text({ mode: 'json' })`, same as `relatedNodeIds`. Migration `0012`.

Done-when (slice): a beat written with citations round-trips through `write_story` → `getStoryForMoment` → the reader and shows its sources inline; undo/redo of the moment preserves the citations. Verified by `bun run verify:story` (extended — title+url+quote round-trip, title-only, empty, rewrite-clears) + `bun run typecheck`.

### Deferred to the full model (S2.1–S2.4)

The sections below specify the deferred end-state:

- **S2.1** — `sources` + `artifacts` tables (BCE-safe `dateInstant`, reliability).
- **S2.2** — `story_artifacts` + `segment_citations` joins (artifact reuse, browse-back).
- **S2.3** — `write_story` v2 referencing registered artifacts by id (+ a `register_artifact` MCP tool, or artifact creation folded into `apply_patch`).
- **S2.4** — Artifact-card UX (tap a beat sentence → transcript/image/reliability card), browse artifacts to their anchored stories.

**Migration path:** Slice-1's inline `story_segments.citations` is forward-compatible. When artifacts become first-class, a backfill reads each beat's inline citations, upserts `artifacts` rows (dedupe by url/title), and writes `segment_citations` joins; the inline column can then be dropped or kept as a denormalized cache. No data is lost and no MCP contract breaks (the inline field stays accepted, just additionally normalized).

### Slice-1 decisions

| Question | Decision |
|---|---|
| JSON column vs `segment_citations` join now? | **JSON column.** No reuse yet; join is premature. |
| Citation shape | **Reuse node `Citation` `{ title, url?, quote? }[]`** verbatim. |
| New `sources`/`artifacts` tables now? | **Defer.** Build when artifact reuse is real. |
| Provenance (`generations` table) | Out of slice; still unwired. Not needed to ground beats. |

---

> **The sections below (Data model delta → Dependencies) specify the deferred full model (S2.1–S2.4).** S2.0 shipped the inline-citation slice described above; this is the later migration, undertaken when artifact reuse is real.

## Data model delta (`src/lib/db/schema.ts`)

```ts
export const SOURCE_TYPES = ['book', 'archive', 'paper', 'museum', 'letter_collection'] as const
export const ARTIFACT_TYPES = ['letter', 'diary_entry', 'photo', 'object', 'inscription', 'record'] as const
export const STORY_ARTIFACT_REL = ['anchor', 'referenced', 'background'] as const

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey().$defaultFn(newId),
  title: text('title').notNull(),
  author: text('author'),
  year: integer('year'),
  citation: text('citation'),                       // formatted citation string
  url: text('url'),
  sourceType: text('source_type', { enum: SOURCE_TYPES }),
  reliabilityNote: text('reliability_note'),        // "primary, contemporaneous" vs "secondary"
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey().$defaultFn(newId),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),                   // "Tablet 291: Claudia Severa's birthday invitation"
  artifactType: text('artifact_type', { enum: ARTIFACT_TYPES }).notNull(),
  // Reuse the domain time model (instant + precision), NOT a JS date — artifacts can be ancient/fuzzy.
  dateInstant: integer('date_instant'),             // when the artifact itself was made (epoch-ms, BCE-safe)
  datePrecision: text('date_precision', { enum: PRECISIONS }).default('year'),
  transcript: text('transcript'),                   // the actual text content
  translation: text('translation'),                 // if from another language
  imageUrl: text('image_url'),
  sourceId: text('source_id').references(() => sources.id),
  attributedPersonId: text('attributed_person_id').references(() => people.id),  // creator, if known
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// Stories anchored / referenced / backgrounded by artifacts (composite PK).
export const storyArtifacts = sqliteTable('story_artifacts', {
  storyId: text('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  artifactId: text('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
  relationship: text('relationship', { enum: STORY_ARTIFACT_REL }).notNull().default('referenced'),
}, (t) => ({ pk: primaryKey({ columns: [t.storyId, t.artifactId] }) }))

// Ties a narrative beat back to the artifact that grounds it — the inline "this came from X".
export const segmentCitations = sqliteTable('segment_citations', {
  segmentId: text('segment_id').notNull().references(() => storySegments.id, { onDelete: 'cascade' }),
  artifactId: text('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
  excerptUsed: text('excerpt_used'),
}, (t) => ({ pk: primaryKey({ columns: [t.segmentId, t.artifactId] }) }))
```

> `import { primaryKey } from 'drizzle-orm/sqlite-core'` for the composite joins. `dateInstant` reuses the existing `instantToX` helper, so **artifacts can be placed on the timeline** — the substrate for artifact-first browse.

### Reconciling with existing node citations

Nodes already carry lightweight `metadata.citations` (`{ title, url?, quote? }`) for the *fact* of a moment. Those stay for canvas-level fact-checking. Artifacts are the richer, story-grounding layer. **Migration nicety (optional):** a one-shot that seeds `sources`/`artifacts` from existing `node.metadata.citations` so prior work isn't lost.

## Grounded generation (enhances the S1 flow)

- New prompt template `generate_story_v2` (purpose `story`) takes **artifacts for the moment** as input: title + transcript/translation excerpts.
- System guidance: *ground each beat in the supplied artifacts; do not invent sources; for each beat, name the artifact(s) it draws from and the excerpt used.*
- The `generateObject` schema gains per-segment `citations: [{ artifactSlug, excerptUsed }]`; the service resolves slugs → `segment_citations` rows in the same transaction. Beats with no artifact stay uncited (honest).
- Which artifacts belong to a moment: S2 ships **explicit linking** (curator attaches artifacts to a moment) plus optional AI-*suggested* artifacts surfaced for confirmation.

## Patch / undo interaction

Sources and artifacts are **reference data** — direct CRUD, not graph Patches. `story_artifacts` / `segment_citations` are written by the generation transaction or by manual curation. The graph Patch invariant is untouched.

## UX surfaces

- **Reader:** inline citation chips per beat → tap → **artifact card** (transcript, translation, image, source, reliability note). Uncited beats show nothing (no fake authority).
- **Artifact-first browse:** a library/grid of artifacts (filter by type), each → the stories that `anchor` on it. Artifacts with a `dateInstant` can optionally render as a **lens on the canvas** (objects placed in time).
- **Curation:** a lightweight artifact/source editor (manual add, AI-suggest-then-confirm). Keep it minimal — this is a tool for the curator, not a CMS.

## Done when

- A generated story shows inline citations; tapping a beat reveals its grounding artifact + source + reliability note.
- You can browse artifacts and jump to the stories they anchor.
- Regeneration re-grounds against the current artifact set; uncited beats remain uncited.
- Typecheck clean; data-layer test covers artifact link + segment citation round-trip + slug→citation resolution.

## Open questions

- Should artifacts also link directly to **moments** (a `moment_artifacts` join) for artifact-first timeline placement, or is `story_artifacts` enough? (Leaning: add the moment link — it powers the canvas lens.)
- Seed `sources`/`artifacts` from existing `node.metadata.citations`? (Cheap, preserves work — recommend yes.)
- How aggressive is AI artifact *suggestion* in S2 vs later? (Start: suggest from the model's own knowledge, curator confirms; no external fetch.)
- Reliability taxonomy — free text vs an enum (`primary` / `secondary` / `tertiary`)?

## Dependencies

**S1** (stories, segments, people, generations, the generation service). S2 extends the S1 generation prompt and reader.
