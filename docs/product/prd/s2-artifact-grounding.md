---
phase: S2
title: "Artifact grounding (the moat)"
status: "S2.0 shipped (inline citations, 2026-06-10); S2.1–S2.5 building (ADR 0001 accepted 2026-06-12)"
era: "Story Layer (the pivot)"
updated: 2026-06-12
---

# S2 — Artifact grounding (the moat)

> **Tap any sentence, see the letter it came from.** Every story beat traces to a primary source — a tablet, a diary entry, a photograph, a shopping list. This is the layer that makes the stories feel *real*, and the one a generic-AI competitor will skip.

## Why this phase, why now

Stories without sources are plausible fiction. **First-class artifacts are the defensibility gap**: Synek becomes the place where primary-source grounding lives, navigably, permanently — not just in the model's context window.

The **reuse trigger (2026-06-11):** the product wants artifacts that can be registered once and cited across many beats, stories, and future builds. Claude should be able to pull a prior artifact back in on the next session. That's the exact condition S2.0's PRD set as the gate for the normalized model. S2.1–S2.5 move from deferred to **active NEXT**, ordered after ⌘K (NEXT.2, already shipped).

Grounding built second (right after the story spine) means every subsequent phase — multi-POV (S3), witness (S4) — inherits it for free. Grounding built late means re-grounding everything.

> One inline "this detail comes from Tablet 291" is worth more trust than any "powered by AI" disclaimer.

## The experience

- In the reader, beats carry a quiet **citation affordance** — "from: *Claudia Severa's birthday invitation*". Tap it → an **artifact card**: transcript, translation, image, source, and a **reliability note** ("primary, contemporaneous" vs "secondary, 200 yrs later").
- A new **artifact-first browse**: a library of artifacts, each linking back to the stories it anchors. Navigate the past through the objects that survived it, not only through time.
- When Claude generates or regenerates a story, it is **handed pre-registered artifacts by id** and grounds each beat in them — naming which artifact each beat draws from.
- **Cross-session recall**: Claude can `search_artifacts` to pull a prior registered artifact back into a new build and re-ground new work. This is the reason artifacts become first-class, not a later bolt-on.

## Goals

- Model sources and artifacts as first-class, reusable reference data.
- Let a story anchor on artifacts, and let each beat cite the artifact(s) it draws from.
- Feed registered artifacts into `write_story` so grounding is produced, not bolted on.
- Surface grounding inline in the reader; add artifact-first browse.
- Enable lexical recall (`search_artifacts`) so artifacts stay referenceable across sessions.

## Non-goals (explicitly deferred)

- **Multiple POVs** → S3. **Interior monologues** → S4.
- **Automated source ingestion / web crawling / scraping** — out of scope. Artifact entry is **manual or AI-suggested-then-confirmed**, never auto-harvested.
- **Users / saved sources / engagement signal** → deferred (requires multi-user posture).
- **Vector / semantic search** — not the default for S2.5 (see Phasing below and ADR 0001).

---

## S2.0 — what shipped (the seam)

`write_story` beats took an optional `citations: { title, url?, quote? }[]`, persisted as a JSON column on `story_segments`. Migration `0012`, 2026-06-10. This is the **forward-compatible seam** the S2.1 backfill reads from — nothing is lost. Backfill mechanics are in ADR 0001.

---

## Phasing & sequencing

S2 depends on **S1** (stories, segments, `story_segments.citations` seam). Sub-phases are ordered; each is the precondition for the next.

**Ordering note:** S2.1–S2.5 ship after NEXT.2 (⌘K, already built). S2.5 (`search_artifacts`) will eventually extend the ⌘K palette as an additional result source — the NAV PRD has a forward-link seam for this.

---

### S2.1 — First-class `sources` + `artifacts` tables

Introduce the two reference-data tables. BCE-safe `dateInstant` (epoch-ms, negative = BCE, reusing the existing `instant + precision` domain model). Reliability note per source. One-shot backfill reads `story_segments.citations` JSON, upserts `sources`/`artifacts` rows (dedupe by url/title), so slice-1 inline citations aren't lost.

**Done when:** a source and an artifact can be created and retrieved via the data layer; the backfill runs without data loss; typecheck clean; the inline `story_segments.citations` column is retained as a cache (not dropped) until S2.2 normalizes it.

---

### S2.2 — `story_artifacts` + `segment_citations` join tables

The **reuse layer**: composite-PK joins that let one artifact anchor many beats and many stories. An artifact can now be queried back to every story it grounds.

Depends on S2.1 (the artifact rows must exist before the joins can reference them).

**Done when:** an artifact registered in S2.1 can be linked to multiple story segments via `segment_citations`; querying an artifact returns all stories that reference it; composite PKs enforce no-duplicate joins; typecheck clean.

---

### S2.3 — Grounded generation (`write_story` v2 + `register_artifact`)

A new **standalone** `register_artifact` MCP tool writes `sources`/`artifacts` rows (and an optional `moment_artifacts` link) so Claude can register a reusable artifact and immediately cite it in the same session. It is **not** folded into `apply_patch` — artifacts are reference data, kept off the graph-Patch/undo path (ADR 0001, Decision 7).

`write_story` v2 takes, per beat citation, **one of two forms** (single-home-per-citation, Decision 8): `{ artifactId, excerptUsed? }` for an artifact-backed citation (→ `segment_citations` join) **or** `{ title, url?, quote?, sourceType? }` for an unregistered one-off mention (→ inline JSON, the shipped path). The two are unambiguous, and existing inline-only calls keep working — no contract break. Beats with no citation stay uncited (honest).

Depends on S2.2 (the join tables must exist before artifact-backed citations can be written by id).

**Done when:** a `write_story` call mixing `artifactId` and inline citations round-trips — artifact-backed → `segment_citations` (+ `story_artifacts`), inline → the JSON column — and both surface merged in `getStoryForMoment`; uncited beats show nothing; undo/redo of the moment preserves all citation links; an unknown `artifactId` is warned, not fatal; typecheck clean; data-layer test covers the round-trip.

---

### S2.4 — Artifact UX

Two surfaces:

1. **Reader citation affordance** — tap a beat sentence → artifact card (transcript, translation, image, source, reliability note). Uncited beats show nothing.
2. **Artifact-first browse** — library/grid of artifacts (filter by type), each linking to the stories it anchors. Artifacts with a `dateInstant` may optionally render as a canvas lens — see open questions.

Curation: a lightweight artifact/source editor (manual add, AI-suggest-then-confirm). Minimal — this is a tool for the curator, not a CMS.

Depends on S2.3 (artifact ids must exist and be resolvable before the card can render them).

**Done when:** tapping a cited beat reveals the artifact card with transcript, reliability note, and source attribution; the artifact browse lists all artifacts and links to their anchored stories; add-artifact form accepts a title, type, transcript, and optional image; typecheck + build clean.

---

### S2.5 — Artifact recall (`search_artifacts` MCP tool)

FTS5 lexical search over `artifacts.title` + `transcript` (+ `translation`). Returns compact matching rows so Claude can recall a prior artifact by keyword and re-ground new work in a later session.

**Why lexical, not vector:** the app has no model. Embeddings would require a BYO provider key and break the "no AI in-app" inversion — Claude supplies all semantic judgment, Synek supplies storage and retrieval. At single-user Core scale (dozens to hundreds of artifacts), FTS5 is sufficient. The hosted upgrade path is `pgvector` (schema is already Postgres-portable); add embeddings only when keyword recall provably misses. Full technical rationale: [ADR 0001 — Sources/Artifacts schema](../../engineering/adr/0001-sources-artifacts-schema.md).

Depends on S2.1 (FTS5 index lives on the `artifacts` table). Forward-links to NAV (⌘K palette can add artifact results as a second source once this ships).

**Done when:** `search_artifacts` returns ranked artifact rows matching a keyword query; results are compact enough to include in an MCP context without blowing the window; Claude can retrieve a previously registered artifact in a new session and reference it in a subsequent `write_story` call; typecheck clean.

---

## Data model

Sources and artifacts are **reference data** — direct CRUD, not graph Patches. The schema introduces five tables: `sources` (provenance metadata, reliability note), `artifacts` (the primary-source objects themselves, with BCE-safe `dateInstant + precision`, transcript, translation, image, attributed person), `story_artifacts` (story-level anchor/reference/background join), `moment_artifacts` (artifact ↔ moment/node — the direct link that powers artifact-first browse and the canvas lens, since a moment can hold artifacts *before* any story is written, so the link can't be derived from `story_artifacts`), and `segment_citations` (beat-level citation join with the excerpt used). Artifacts with a `dateInstant` can be placed on the timeline axis using the existing `instantToX` helper.

Citations follow **single-home-per-citation** (ADR 0001, Decision 8): an artifact-backed citation lives only in `segment_citations`; an unregistered one-off mention lives only in the inline `story_segments.citations` JSON. No duplication, and therefore **no bulk backfill** — old inline citations are already in their correct (unregistered) tier.

Data model and all schema decisions — column names, enums, the FTS5 index definition, the moment-link decision, the citation-storage model, and the reliability taxonomy — live in the authoritative spec:

**[ADR 0001 — Sources/Artifacts schema](../../engineering/adr/0001-sources-artifacts-schema.md)**

Do not embed DDL here. The PRD owns the product intent; the ADR owns the data model.

---

## Open product questions

1. **`register_artifact` standalone vs. folded into `apply_patch`? — RESOLVED (founder, 2026-06-12): standalone.** Artifacts are reference data, kept off the graph-Patch/undo path; `apply_patch` stays graph-only (ADR 0001, Decision 7 + Open/deferred).

2. **How aggressive is AI artifact suggestion in S2?** Start: Claude suggests from its own knowledge, curator confirms — no external fetch. The question is whether the suggestion affordance lives in the curation UI (explicit "suggest artifacts for this moment" action) or surfaces automatically when a story is generated without citations. Explicit is safer for S2; automatic is the goal for S3+.

3. **Artifact-first browse: library grid vs. canvas lens first?** The canvas lens (artifacts with `dateInstant` placed on the timeline) is powerful but more complex. For S2.4 v1, lean toward the library grid as the primary surface and treat the canvas lens as an optional enhancement — cuts risk and the grid validates the browse pattern before adding spatial complexity.

4. **Reliability taxonomy — RESOLVED (ADR 0001, Decision 4).** A structured enum (`primary` / `secondary` / `tertiary`, the provenance-distance axis used to rank/filter) **plus** an optional free-text `reliabilityNote` for nuance. Kept distinct from the *already-shipped* genre enum `CITATION_SOURCE_TYPES` (`primary`/`scholarship`/`data`/`press`) — genre and provenance are orthogonal (a `press` source can be `primary` or `tertiary`), so artifacts carry both. The reader card surfaces both axes.

---

## Dependencies

- **S1** (stories, segments, `story_segments.citations` seam) — S2 extends the generation flow and reader.
- **ADR 0001** (Kael) — sources/artifacts schema; backfill mechanics; FTS5 index; reliability taxonomy; moment-link decision. S2.1 cannot start until the ADR is finalized.
- **NAV / ⌘K** (already shipped) — S2.5 `search_artifacts` is the next result source for the palette; the seam is already in the NAV PRD.
- **S3** (multi-POV) — depends on S2; grounding makes multiple POVs honest.
