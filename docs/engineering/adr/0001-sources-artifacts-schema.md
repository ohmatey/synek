# ADR 0001 — Sources / artifacts normalized schema (S2 — artifact grounding)

- **Status:** Accepted (founder, 2026-06-12) — all eight decisions confirmed; **Decision 8 refined** to single-home-per-citation (no inline/normalized duplication — see the decision).
- **Date:** 2026-06-12
- **Deciders:** Kael (Chief Engineer, owner) · Margot (Product, PRD) · founder (sign-off)
- **Scope:** S2.1–S2.5 ("Artifact grounding — the moat")
- **Supersedes:** the inline schema dump in `../../product/prd/s2-artifact-grounding.md` (~lines 93–144). That PRD now references **this ADR** as the data-model source of truth.
- **Product context:** `../../product/prd/s2-artifact-grounding.md` · **Roadmap:** `../../product/roadmap.md` (NEXT.1, Hosting horizon)

---

## Context

Synek grounds story beats in **primary sources** — "tap any sentence, see the letter it came from." That grounding is the defensibility layer (the moat): a generic-AI competitor can generate plausible prose, but not the trust of "this detail comes from Tablet 291."

**What already shipped (S2.0, migration `0012`):** story beats carry an optional inline `citations: Citation[]` JSON column on `story_segments`. `Citation` is `{ title; url?; quote?; sourceType? }` (`src/lib/db/schema.ts` line 33), reusing the node-citation shape verbatim. This was correct: no artifact corpus existed, every citation was one-shot, and a join table over a single-use entity is pure overhead. It is also the **forward-compatible seam** — a JSON column we can read and normalize later without a contract break.

**What forces this ADR (founder, 2026-06-11):** the product now wants **reusable artifacts that stay referenceable across future builds** — register a source once, cite it from many beats/stories, and let Claude pull it back into a *new* session to re-ground new work (`search_artifacts`). That is exactly the artifact-reuse condition S2.0 set as the gate. One-shot inline JSON cannot satisfy it: there is no stable identity to cite again, no place to attach reliability/transcript/image once, and nothing to search over. We need normalized `sources` + `artifacts`, join tables for reuse, BCE-safe placement so artifacts can live on the canvas, and a retrieval tool.

**The hard constraints this design lives inside:**

1. **No AI in-app (the inversion).** Claude-over-MCP is the brain; Synek stores, retrieves, renders. Any decision that requires an embedding model, a generation call, or a bundled model **breaks the inversion** and is disqualified at Core scale. This is the single sharpest constraint and it drives the retrieval decision below.
2. **Postgres-portable, hosting-aware.** SQLite (`better-sqlite3`) today, Postgres later (NEXT.4). Every "bring your own X" in the local Core is the local-first shape of a managed service later. No choice may require a teardown to host.
3. **The Patch invariant is sacred.** One graph edit = one atomic undoable Patch. Story/reference data lives *outside* the Patch engine. New tables must not perturb undo/redo.
4. **Single-user, local-first Core.** Dozens–hundreds of artifacts per timeline, not 10k+. Scale-appropriate simplicity beats premature infrastructure.

Verified against `src/lib/db/schema.ts` and `src/lib/db/patches.ts` before locking (the PRD draft was stale in three places — see Decision 1, 4, and 7).

---

## Decision

Eight decisions, each locked with a one-line justification. Concrete DDL in **Schema** below.

1. **Five normalized tables** (not four): `sources`, `artifacts`, `story_artifacts`, `moment_artifacts`, `segment_citations`. The PRD specced four; **`moment_artifacts` is added** (Decision 5). All are **reference data**, written by direct CRUD or the `write_story` transaction — never graph Patches (Decision 7).

2. **`artifacts` uses the standard `newId` text PK; drop the `slug` unique column.** *Justification:* a slug earns its uniqueness cost only when something external addresses the row by a human-readable handle (URLs, hand-authored references). `stories.slug`/`people.slug` predate the inversion and exist for reader URLs; artifacts are addressed by **id** from MCP tool results and join FKs, never by URL. A `notNull().unique()` slug is a write-time burden (collision handling, who-generates-it) and an MCP-contract complication (`write_story` would have to resolve slugs → ids, the PRD's brittle `[{ artifactSlug, excerptUsed }]` shape) for zero lookup benefit. The MCP contract references artifacts **by id** (the value `apply_patch`/`register_artifact` returns). Keep `title` indexed for dedupe; no slug.

3. **`artifacts` are placed in time with the domain-time model (`instant + precision`), not a JS `Date`; `sources` carry a plain `year` int.** *Justification:* an artifact *was made at* a point in history — possibly ancient or fuzzy ("Q3 2008", "49 BCE") — so it reuses `dateInstant` (epoch-ms, BCE-safe) + `datePrecision` (the `PRECISIONS` enum) and is therefore canvas-placeable via the existing `instantToX(instant, minInstant, pxPerDay)` (`src/components/canvas/useTimelineScale.ts:103`) with **zero new machinery**. A `source` (a book, an archive) is a bibliographic record, not a timeline citizen — its `year` is a publication int, never plotted, so a plain `integer` is honest and cheaper than dragging the precision model where it buys nothing.

4. **Reliability is a structured enum (`primary` / `secondary` / `tertiary`) PLUS an optional free-text `reliabilityNote`.** *Justification:* retrieval and the reader both need to **rank and filter** by reliability ("show me primary sources first"), which free text cannot do; the enum is the structured handle. The note keeps the human nuance ("contemporaneous, written by an eyewitness 3 days later"). **Reconciliation (the PRD missed this):** a `CITATION_SOURCE_TYPES = ['primary','scholarship','data','press']` enum *already exists* on `Citation.sourceType` (`src/lib/domain/types.ts:34`). That enum answers *"what kind of source is this"* (genre); reliability answers *"how close to the event"* (a 3-point provenance scale). They are orthogonal — a `press` source can be `primary` (a same-day newspaper) or `tertiary` (a retrospective). So `artifacts` carry **both**: `sourceType` (reuse the existing genre enum) and `reliability` (the new provenance enum). Do **not** collapse them — that would lose a real axis the reader surfaces.

5. **Add `moment_artifacts` (artifact ↔ node/moment) — yes.** *Justification:* the roadmap leans yes and it is the right call: artifact-first browse and the **canvas lens** ("objects placed in time, jump to the moment they belong to") need a direct artifact→moment link that does not route through a story. `story_artifacts` answers "which artifacts ground this *narrative*"; `moment_artifacts` answers "which artifacts belong to this *point on the timeline*." A moment can have artifacts before any story is written (you register the Vindolanda tablet against the moment, *then* write its story) — so the moment link cannot be derived from `story_artifacts`. It is cheap (a 2-column join, cascade on node delete) and it unblocks the lens. Locked in.

6. **Retrieval: SQLite FTS5 now; vector deferred and hosting-aware. THE HEADLINE DECISION.** Build a `search_artifacts` MCP tool backed by an **FTS5 external-content table** over `title + transcript + translation`, kept in sync by triggers. *Justification, recorded so it is not re-litigated:*
   - **Embeddings need a model the app deliberately does not have.** Claude-over-MCP emits no embeddings. Adding vector search forces either a BYO `SYNEK_EMBED_*` provider key (the exact deferred shape of the N.4.5b image key) or a bundled local embed model — **both break the inversion**. FTS5 needs *zero* new dependencies and zero model: Claude supplies the semantic judgment, Synek supplies lexical recall over the corpus. This is the inversion working as designed.
   - **At Core scale you need stored embeddings, not an index.** A single-user timeline holds dozens–hundreds of artifacts. *Even if* we added vectors, the right shape would be a stored-embedding column + brute-force cosine (linear scan, sub-millisecond at hundreds of rows) — an HNSW/IVF **index** only earns its complexity at ~10k+ vectors, which is a hosted/large-corpus concern parked next to Deferred **D.1**. So vectors buy nothing here that FTS5 doesn't, at the cost of breaking the inversion.
   - **Hosted upgrade path stays clean.** The schema is already Postgres-portable; semantic search there is `pgvector` (or Postgres FTS as an intermediate). No local plumbing to tear out — `search_artifacts` is the only seam.
   - **The MCP tool contract is backend-agnostic by design** (Decision 6a) so FTS5 → vector can swap without touching the client. **Reach for embeddings only when keyword recall provably misses** — and even then, store-and-scan before any index.

   **6a — `search_artifacts` contract (locked, backend-agnostic):**
   - **Input:** `{ query: string; timelineId?: string; types?: ARTIFACT_TYPES[]; reliability?: RELIABILITY[]; limit?: number (default 10, max 50) }`.
   - **Output:** a ranked array of compact rows — `{ id, title, artifactType, snippet, reliability, sourceType, sourceTitle?, dateInstant?, datePrecision?, imageUrl?, score }`. `snippet` is an FTS5 `snippet()` highlight today; `score` is rank today (BM25), cosine distance later — an opaque "higher is better" the client need not interpret. **No backend detail leaks** (no "ftsRank", no "distance"). Query string in, ranked artifact rows out. A vector backend later returns the *same envelope*.

7. **Patch / undo interaction: reference data is direct CRUD, never a graph Patch — and the join rows are made undo-safe by design.** `sources`/`artifacts` are CRUD (curation or `register_artifact`). `story_artifacts`/`segment_citations` are written by the `write_story` transaction or curation; `moment_artifacts` by curation/`register_artifact`. The graph Patch invariant is **untouched**. **The undo-safety subtlety the PRD missed (verified in `patches.ts`):** `restoreStory` (line 87) re-inserts a deleted moment's stories via `tx.insert(storySegments).values({ ...seg })` — it spreads the **segment row only**. It does **not** capture or restore any join table. So when a moment is deleted (or its create-patch undone) and the story cascades away, `segment_citations` rows would be silently dropped and **not** restored on redo — a latent data-loss bug if we naively FK `segment_citations.segmentId → story_segments.id ON DELETE CASCADE` and stop there. **Resolution (locked):** extend the `StorySnapshot` capture to include each segment's `segment_citations` rows, and have `restoreStory` re-insert them alongside the segment. `story_artifacts` and `moment_artifacts` are keyed off `stories`/`nodes` that the snapshot/cascade already handles for the story side, but `story_artifacts` must be captured too (it hangs off `story.id`). See **Migration & rollout → Undo-safety** for the exact `patches.ts` change. This is a *snapshot* extension, not a Patch-engine change — the engine still knows nothing about artifacts.

8. **Single-home-per-citation: inline `story_segments.citations` is the home of *unregistered, one-off* citations only — NOT a cache of normalized rows.** *(Refined by founder sign-off, 2026-06-12. The original framing — "inline as a denormalized cache of the same data that also lives in `segment_citations`" — was rejected: two copies of one citation drift, and a "retire later" cache becomes permanent debt.)* The locked model recognizes **two genuinely different tiers** wearing the word "citation":
   - **Artifact-backed** — references a registered `artifact` (transcript, reliability, reusable, searchable). Lives **only** in `segment_citations` (FK → `artifacts`). No inline copy. The reader reads it via the join. This is where an FK is correct.
   - **Unregistered one-off** — a thin mention (`{ title, url?, quote?, sourceType? }`) with no reusable identity, no transcript, nothing to dedupe on. Lives **only** in the inline `citations` JSON. Forcing it into an `artifacts` row would pollute the corpus with junk rows that have no identity — the very "join over a single-use entity is overhead" anti-pattern S2.0 avoided.

   So **no citation lives in two places** → nothing drifts. `write_story` v2 accepts, per beat, **either** `{ artifactId, excerptUsed? }` (→ `segment_citations`) **or** `{ title, url?, quote?, sourceType? }` (→ inline) — disjoint required keys make the union unambiguous, and existing inline-only calls keep working unchanged. **Consequence: no bulk-promotion backfill** — old inline citations are already in their correct (unregistered) tier; promoting one to an artifact is a deliberate *curation* action, never a migration (see Migration & rollout). This is strictly better than both "cache" (drifts) and "normalize everything" (forces junk artifacts + breaks the contract).

---

## Schema

Concrete, corrected, Postgres-portable Drizzle DDL. Conventions match the existing schema: `text` ids via `newId` (`crypto.randomUUID()`), JSON via `text({ mode: 'json' })`, system time `integer({ mode: 'timestamp_ms' })` via `now`, composite PKs via `primaryKey({ columns })`. Add `import { primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'`.

```ts
// --- enums (src/lib/db/schema.ts or domain/types.ts alongside the existing ones) ---

export const SOURCE_TYPES = ['book', 'archive', 'paper', 'museum', 'letter_collection', 'website'] as const
export const ARTIFACT_TYPES = ['letter', 'diary_entry', 'photo', 'object', 'inscription', 'record', 'document'] as const
// Provenance distance from the event — orthogonal to Citation.sourceType (genre).
export const RELIABILITY = ['primary', 'secondary', 'tertiary'] as const
// How a story leans on an artifact.
export const STORY_ARTIFACT_REL = ['anchor', 'referenced', 'background'] as const

// --- sources: bibliographic records (a book, an archive, a museum collection) ---
export const sources = sqliteTable('sources', {
  id: text('id').primaryKey().$defaultFn(newId),
  title: text('title').notNull(),
  author: text('author'),
  // Publication year — a plain int, NOT a timeline instant. Sources are not plotted.
  year: integer('year'),
  citation: text('citation'),                       // formatted bibliographic string
  url: text('url'),
  sourceType: text('source_type', { enum: SOURCE_TYPES }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// --- artifacts: the reusable primary-source objects that ground beats ---
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey().$defaultFn(newId),    // addressed by id; no slug (Decision 2)
    title: text('title').notNull(),                   // "Tablet 291: Claudia Severa's birthday invitation"
    artifactType: text('artifact_type', { enum: ARTIFACT_TYPES }).notNull(),
    // Domain time (instant + precision), BCE-safe — placeable on the canvas via instantToX (Decision 3).
    dateInstant: integer('date_instant'),             // when the artifact was MADE (epoch-ms, negative = BCE)
    datePrecision: text('date_precision', { enum: PRECISIONS }).notNull().default('year'),
    transcript: text('transcript'),                   // the actual text content (FTS-indexed)
    translation: text('translation'),                 // if from another language (FTS-indexed)
    imageUrl: text('image_url'),                       // sourced URL, never generated (matches node-image rule)
    // Provenance distance (rank/filter handle) + free-text nuance (Decision 4).
    reliability: text('reliability', { enum: RELIABILITY }),
    reliabilityNote: text('reliability_note'),
    // Genre of source — reuse the EXISTING Citation enum, orthogonal to reliability (Decision 4).
    sourceType: text('artifact_source_type', { enum: CITATION_SOURCE_TYPES }),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
    attributedPersonId: text('attributed_person_id').references(() => people.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [
    index('artifacts_title_idx').on(t.title),         // dedupe-by-title on backfill/upsert
    index('artifacts_source_id_idx').on(t.sourceId),
  ],
)

// --- story_artifacts: stories anchored/referenced/backgrounded by artifacts (composite PK) ---
export const storyArtifacts = sqliteTable(
  'story_artifacts',
  {
    storyId: text('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
    relationship: text('relationship', { enum: STORY_ARTIFACT_REL }).notNull().default('referenced'),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.artifactId] }), index('story_artifacts_artifact_idx').on(t.artifactId)],
)

// --- moment_artifacts: artifact <-> node/moment, the canvas-lens + artifact-first link (Decision 5) ---
// Powers "objects placed in time" and "this artifact belongs to this point" independent of any story.
export const momentArtifacts = sqliteTable(
  'moment_artifacts',
  {
    momentId: text('moment_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
    note: text('note'),                               // optional "why this artifact sits here"
  },
  (t) => [primaryKey({ columns: [t.momentId, t.artifactId] }), index('moment_artifacts_artifact_idx').on(t.artifactId)],
)

// --- segment_citations: a beat <-> the artifact that grounds it (composite PK) ---
// The inline "this came from X". Excerpt is the specific quote the beat draws on.
export const segmentCitations = sqliteTable(
  'segment_citations',
  {
    segmentId: text('segment_id').notNull().references(() => storySegments.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
    excerptUsed: text('excerpt_used'),
  },
  (t) => [primaryKey({ columns: [t.segmentId, t.artifactId] }), index('segment_citations_artifact_idx').on(t.artifactId)],
)

export type SourceRow = typeof sources.$inferSelect
export type ArtifactRow = typeof artifacts.$inferSelect
export type StoryArtifactRow = typeof storyArtifacts.$inferSelect
export type MomentArtifactRow = typeof momentArtifacts.$inferSelect
export type SegmentCitationRow = typeof segmentCitations.$inferSelect
```

### FTS5 setup (better-sqlite3 mechanics — concrete)

FTS5 ships in `better-sqlite3`'s bundled SQLite; no extension load needed. Use an **external-content** virtual table (`content='artifacts'`) — it stores only the inverted index, not a copy of the text, so the `artifacts` row stays the single source of truth and there is no drift between two copies of the transcript. Sync via triggers.

This is **raw DDL in the migration's `.sql` file** (drizzle-kit does not model virtual tables; hand-author it in the generated migration after the table DDL):

```sql
-- external-content FTS5 over the searchable columns (Decision 6)
CREATE VIRTUAL TABLE artifacts_fts USING fts5(
  title, transcript, translation,
  content='artifacts',
  content_rowid='rowid'        -- external-content keys on the base table's implicit rowid
);

-- keep the index in lockstep with artifacts (insert / delete / update)
CREATE TRIGGER artifacts_ai AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifacts_fts(rowid, title, transcript, translation)
  VALUES (new.rowid, new.title, new.transcript, new.translation);
END;
CREATE TRIGGER artifacts_ad AFTER DELETE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, transcript, translation)
  VALUES ('delete', old.rowid, old.title, old.transcript, old.translation);
END;
CREATE TRIGGER artifacts_au AFTER UPDATE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, transcript, translation)
  VALUES ('delete', old.rowid, old.title, old.transcript, old.translation);
  INSERT INTO artifacts_fts(rowid, title, transcript, translation)
  VALUES (new.rowid, new.title, new.transcript, new.translation);
END;
```

- **External-content vs contentless (`content=''`):** chose **external-content**. Contentless can't return column values and complicates `snippet()`; external-content gives `snippet()`/`highlight()` for the reader affordance and keeps `artifacts` authoritative. The `'delete'` command-row idiom is FTS5's required way to evict external-content rows (it can't read the deleted base row).
- **Trigger-sync vs rebuild:** **triggers**, not periodic `INSERT INTO artifacts_fts(artifacts_fts) VALUES('rebuild')`. At Core write rates (manual curation, occasional `write_story`) trigger cost is negligible and the index is always consistent; a rebuild job is operational overhead we don't need single-user.
- **`rowid` note:** the base table's PK is a `text` UUID, but external-content FTS5 keys on the implicit integer `rowid` SQLite gives every non-`WITHOUT ROWID` table. `artifacts` is a normal table, so `rowid` exists and is stable for the row's life. The `search_artifacts` query joins `artifacts_fts` back to `artifacts` on `rowid` to return the UUID `id` and full row. (If we ever make `artifacts` `WITHOUT ROWID`, switch to a contentless or shadow-key design — flagged, not a concern now.)
- **Query shape:** `SELECT a.*, snippet(artifacts_fts, ...) AS snippet, bm25(artifacts_fts) AS rank FROM artifacts_fts JOIN artifacts a ON a.rowid = artifacts_fts.rowid WHERE artifacts_fts MATCH ? ORDER BY rank LIMIT ?`. Sanitize the user `query` into a safe FTS5 MATCH expression (quote bare terms; the MCP client passes free text, so wrap tokens to avoid FTS5 syntax errors on punctuation).

---

## Consequences

**Positive**
- **Artifacts become reusable, first-class, searchable reference data** — register once, cite from many beats/stories/moments, recall across sessions. The moat is now a data structure, not prose.
- **Artifacts are canvas-placeable for free** (`dateInstant` + `instantToX`) — the artifact-first lens needs no new geometry.
- **Retrieval ships with zero new dependencies and zero model** — FTS5 is in the box, and it does not break the inversion. Claude reasons; Synek recalls.
- **`search_artifacts` is backend-agnostic**, so the FTS5 → `pgvector` swap is a single-seam change invisible to the MCP client.
- **No data loss, no MCP contract break, no duplication** — inline `citations` stays accepted and rendered as the unregistered tier; artifact-backed citations live only in `segment_citations`. Single-home-per-citation (Decision 8) means nothing drifts.
- **Undo/redo stays faithful** with a *snapshot* extension, not a Patch-engine change — the engine still knows nothing about artifacts.
- **Reliability is both rankable (enum) and nuanced (note)**, and it does not collide with the existing genre enum.

**Negative**
- **More tables and join logic** — `write_story` v2 and curation now write up to four related tables in one transaction; more surface to keep consistent.
- **The undo-safety extension touches `patches.ts`** (`StorySnapshot`, `captureStories`, `restoreStory`) — the one place this design reaches into the Patch machinery. It must be done precisely or `segment_citations`/`story_artifacts` leak on moment-delete/undo (the exact bug the PRD missed). Mitigated by a `verify:artifact-undo` data-layer test (Migration & rollout).
- **FTS5 DDL is hand-authored** in the migration (drizzle-kit won't generate the virtual table or triggers) — a manual step a builder must not forget, and one drizzle won't diff on future schema pulls.
- **Two citation tiers to route** — `write_story` v2 and `hydrateStory` must direct each beat citation to the right home (inline vs join) and merge both for display. This complexity is inherent to having a reusable tier and a one-off tier; the single-home rule (Decision 8) makes it explicit and drift-free rather than hidden behind a cache.

**Neutral**
- `sources.year` as a plain int is deliberately *less* expressive than the instant model — accepted, because sources are never plotted.
- Dropping `slug` diverges from `stories`/`people` (which keep theirs for reader URLs) — intentional; artifacts are id-addressed.
- `moment_artifacts` overlaps conceptually with `story_artifacts` for moments that *do* have a story, but the two answer different questions (point-in-time vs narrative) and a moment can hold artifacts with no story — the overlap is acceptable and the link is not derivable.

---

## Alternatives considered

- **Vector-first / embedding retrieval (rejected as default).** The headline rejection. Requires an embedding model the app deliberately lacks → forces a BYO `SYNEK_EMBED_*` key or a bundled model, breaking the inversion. And it buys nothing at Core scale: hundreds of artifacts want store-and-scan, not an ANN index (which only pays off at ~10k+ vectors — a hosted concern next to D.1). Deferred behind an unchanged `search_artifacts` contract; hosted path is `pgvector`.
- **JSON-inline-forever (rejected).** Keep `story_segments.citations` as the only home, never normalize. Fails the actual S2 requirement: no stable artifact identity to cite again, nowhere to attach transcript/image/reliability once, nothing to search over, no reuse. Inline was right for S2.0's one-shot world; it cannot carry reuse. (We *keep* it — Decision 8 — but only as the home of the *unregistered one-off* tier, not for artifact-backed citations.)
- **Normalize everything / drop inline (rejected).** Make `segment_citations → artifacts` the only citation home; every beat mention becomes an `artifacts` row. Breaks the shipped `write_story` contract, and forces a junk `artifacts` row (no identity, no dedupe key) for every passing title-only mention — polluting the searchable corpus. The single-home model (Decision 8) keeps the FK where an FK is correct and inline where there is nothing to point at.
- **Slug PK on artifacts (rejected — was in the PRD draft).** `notNull().unique()` slug adds write-time collision handling and an MCP-contract slug-resolution step (`write_story`'s `[{ artifactSlug }]`) for zero lookup benefit, since artifacts are id-addressed from tool results. Dropped in favor of `newId` + an indexed `title` for dedupe.
- **Four tables, no `moment_artifacts` (rejected).** Reuse `story_artifacts` for canvas placement. Fails the "artifact registered against a moment before any story exists" case and couples the canvas lens to story authorship. Added the moment link (Decision 5).
- **Collapse reliability into the existing `sourceType` enum (rejected).** They are orthogonal axes (genre vs provenance distance); collapsing loses the "primary vs secondary" filter the reader card surfaces. Kept both.
- **Contentless FTS5 (`content=''`) (rejected).** Can't return stored column values and complicates `snippet()`. External-content keeps `artifacts` authoritative and supports the highlight affordance.
- **Periodic FTS rebuild instead of triggers (rejected).** Unnecessary operational moving part at single-user write rates; triggers keep the index always-consistent for free.

---

## Migration & rollout

**Next free migration number: `0016`.** Confirmed against `drizzle/` — highest existing is `0015_useful_retro_girl.sql` (counter ran past the 0012/0014/0015 cited in the roadmap). **This ADR does not generate the migration; design-only.** A builder runs `bun run db:generate` for the table DDL, then **hand-appends the FTS5 virtual table + triggers** (above) into the generated `0016_*.sql` — drizzle-kit won't author those.

**Backfill: NONE (no-op).** *(Changed by the Decision 8 refinement, founder 2026-06-12.)* Under single-home-per-citation, the old inline `story_segments.citations` rows are **already in their correct tier** — the unregistered one-off tier — so there is nothing to promote and `0016` is **pure DDL** (5 tables + the FTS5 objects), with no data migration and no fixture dependency. A bulk read-inline→upsert-artifact→write-`segment_citations` pass would *duplicate* each citation across both tiers, contradicting Decision 8.

**Promotion is curation, not migration.** Turning an inline citation into a reusable artifact is a deliberate human action: a curator (or Claude) calls `register_artifact` for the source, then re-runs `write_story` on that beat with the `{ artifactId }` form. This is the right place for the title/url/`reliability` judgment that must be human (the model can't infer provenance distance).

**The `node.metadata.citations` seed pass is DEFERRED** (founder call) — not run in `0016`. If ever wanted, it ships as a separate flag-gated curator tool, never an automatic migration.

**No-break guarantee:** `write_story` keeps accepting inline `citations` on every beat (unchanged contract — they route to the inline tier). `write_story` v2 *additionally* accepts the `{ artifactId }` form, resolving those into `segment_citations`/`story_artifacts` in the same transaction. The reader merges both tiers (`hydrateStory`) for display. Nothing the MCP client sends today breaks.

**Undo-safety (the precise `patches.ts` change — locked):**
- Extend `StorySnapshot` to `{ story; segments; storyArtifacts: StoryArtifactRow[]; segmentCitations: Record<segmentId, SegmentCitationRow[]> }`.
- `readStorySnapshots` (line 42) additionally selects the story's `story_artifacts` and each segment's `segment_citations`.
- `restoreStory` (line 87) re-inserts those join rows after the story + segments (coercing no timestamps — joins have none).
- `moment_artifacts` cascades on `nodes` delete; capture it in the **`delete_node` inverse** alongside the existing node/edge capture (it hangs off the moment, not the story) so a moment-restore brings its artifact links back.
- This is a **snapshot extension only** — `captureStories` runs *before* the delete commits (line 63 comment), the engine still treats stories/artifacts as opaque payload on the restore op. New data-layer test `verify:artifact-undo`: create moment → register artifacts → write a story citing them → delete the moment → undo → assert artifacts, `moment_artifacts`, `story_artifacts`, and `segment_citations` all round-trip; redo drops them again.

**Rollout order (maps to S2.1–S2.5):** S2.1 tables + backfill (`0016`) → S2.2 join writes in `write_story` v2 + curation CRUD → S2.3 `register_artifact` MCP tool (or fold artifact creation into `apply_patch`) → S2.4 artifact-card + browse + canvas lens (reads `moment_artifacts`) → S2.5 `search_artifacts` (FTS5).

---

## Open / deferred

- **Vector / embedding retrieval** — deferred behind the unchanged `search_artifacts` contract; revisit only when keyword recall provably misses, and even then store-and-scan before any index. Hosted path: `pgvector`. (Parked next to D.1.)
- **ANN index (HNSW/IVF)** — hosted/large-corpus only (~10k+ vectors). Not a Core concern.
- **Retiring the inline `citations` cache** — only once the reader reads exclusively from joins and the corpus is the system of record; a future ADR if ever.
- **AI artifact *suggestion* aggressiveness** — product/UX question (PRD open question), not schema. Schema supports it either way (curator confirms suggested rows via the same CRUD).
- **`register_artifact` vs folding into `apply_patch`** — **RESOLVED (founder, 2026-06-12): standalone `register_artifact`.** `apply_patch` is the graph-Patch path; folding artifact creation in would pull reference data into the undo/redo invariant it is deliberately kept out of (Decision 7). Artifacts are written by direct CRUD.
- **`source` ↔ multiple artifacts richer modeling** (editions, sub-collections) — out of scope; `sources` is flat for now.

---

### Founder input — resolved (2026-06-12)

1. **`sourceType` on artifacts in addition to `reliability`** — **YES.** Genre (`sourceType`) and provenance distance (`reliability`) are orthogonal; artifacts carry both (Decision 4).
2. **The `node.metadata.citations` seed pass** — **DEFERRED.** Not in `0016`; ships later as a flag-gated curator tool if wanted (see Migration & rollout → Backfill).
3. **`register_artifact` standalone vs `apply_patch` fold** — **STANDALONE** (see Open / deferred).
4. **Decision 8 citation storage** — **single-home-per-citation** (no inline/normalized duplication); see Decision 8.
