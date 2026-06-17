# ADR 0004 — Shared entities: one canonical node placed on many timelines

- **Status:** Accepted (founder sign-off via plan approval, 2026-06-16). Phase 2 of "decouple nodes & timelines."
- **Date:** 2026-06-16
- **Deciders:** founder (locked the three forks below via AskUserQuestion) · engineering (design + adversarial pressure-test).
- **Scope:** The data-model decoupling only — an `entities` table (canonical content), `nodes.entityId` (placement → entity link), an `entity_patches` per-entity undo stack, the `loadGraph` read overlay, a `place_entity` graph op + MCP/UX, and the entity page's "appears on" aggregation. **Builds on:** Phase 1 (the full-screen entity page at `/timelines/$id_/nodes/$nodeId`), ADR [0003](./0003-projects-container.md) (owner-scoping pattern), the Patch engine (`src/lib/db/patches.ts`).
- **Explicitly NOT in scope:** orphan-entity garbage collection; per-placement content overrides (same entity, different dates/size per timeline); sharing edges or stories across timelines; renaming the `entities` table away from the `entity` NodeType collision.

---

## Context

A node is structurally bound to exactly one timeline (`nodes.timelineId` NOT-NULL FK, `schema.ts:242`) and that node IS both the entity's identity and its placement handle. The Patch invariant — one logical edit = one atomic, **per-timeline**, undoable Patch (`patches` keyed by `timelineId + seq`, `schema.ts:278`) — is built on that one-node-one-timeline assumption. Stories (`stories.momentId`), edges (`edges.sourceId/targetId`), and artifacts (`moment_artifacts.momentId`) all FK to `nodes.id`.

The founder wants the knowledge-graph realization: a canonical entity (e.g. "Charles Darwin") exists once, can appear on many timelines, and editing it propagates everywhere; the entity page aggregates every timeline it appears on. Phase 1 shipped the view; Phase 2 is the data model.

**Three forks the founder locked (AskUserQuestion, 2026-06-16):**
1. **True shared content** (not copy-on-add).
2. **A separate, per-entity undo stack** for content edits — independent of the canvas's per-timeline ⌘Z.
3. **Full scope** — data model + propagation + entity-page aggregation + `place_entity` MCP op + a rich in-canvas "add existing entity" picker.

**Hard constraints (verified against code, not assumed):** Postgres-portable (`text` ids via `newId`, JSON via `text({mode:'json'})`, time via `integer({mode:'timestamp_ms'})`); owner-scoped fail-closed (`ownerId` FK, guarded at entry points, `db/*` trusts its caller); the Patch invariant is sacred; migrations are additive (nullable-add + correlated backfill + sole-user fallback, **no NOT-NULL rebuild** — mirror 0019/0020).

---

## Decision

### D1 — Keep `nodes` as the PLACEMENT table; add `entities` for canonical CONTENT (the overlay model).
Reject the destructive rename (`nodes` → new `entities` + `placements`, rewriting every FK). Instead: `nodes` stays the per-timeline placement (same ids → `edges`/`stories`/`moment_artifacts` FKs untouched, **zero FK migration**); a new `entities` table holds canonical content; `nodes.entityId` (nullable FK) links a placement to its content. *Justification:* the destructive path rewrites the entire data layer and every FK; the overlay path is the additive 0019/0020 pattern and keeps the single `nodeRowToGraphNode` mapper.

### D2 — `entities` owns CONTENT; `nodes` owns PLACEMENT.
Entity: `type, title, summary, startInstant, endInstant, precision, metadata` (citations/images/size/color/subtype/location/lat/lng/geoScope), owner-scoped. Node keeps its content columns as a **cache/fallback** (NOT NULL stays satisfied; never the read source when `entityId` is set) and owns only `timelineId, entityId, lane/laneHint`. *Justification:* dates/visual identity are canonical to the entity (a person's lifespan is the same on every timeline); lane is the one genuinely per-timeline layout bit.

### D3 — Content reads resolve via an OVERLAY inside `loadGraph`, field-by-field (R8 + R9).
`loadGraph` LEFT JOINs entities and returns rows whose content is already resolved: entity value when `entityId` is set, else the node's cache. Resolve **inside `loadGraph`**, not only in `nodeRowToGraphNode` — `query_timeline`, `get_node`, `graphSummary`, `layout-report`, and the canvas scale all read raw row fields and would serve stale cache otherwise. Merge metadata **field-by-field**: `lane`/`laneHint` always from the placement, content metadata from the entity (never blob-replace). `nodesByIds` (public-story loader, bypasses `loadGraph`) gets the same overlay (R12). A null `entityId` falls back to node content, so legacy/test bare-node inserts keep working untouched.

### D4 — Two separate mutation systems.
- **Graph patches** (existing `patches`, per-timeline, canvas ⌘Z): `add_node` (creates entity + placement together), `place_entity` (NEW — add an existing entity as a placement), `delete_node` (removes the PLACEMENT only), edges, lane edits.
- **Entity content edits** (NEW `entity_patches`, per-entity undo): `editEntity` updates the entity row → propagates to all placements **for free** via the D3 overlay (no fan-out writes).

*Justification:* the founder chose a separate undo stack; the overlay makes propagation a read-time concern, so content edits never fan out and never touch the per-timeline stack.

### D5 — `place_entity` is a distinct GraphOp; `add_node`'s entity-deleting inverse is CONDITIONAL (R3/R4/R5).
`place_entity`'s inverse deletes only the placement, never the entity. `add_node` co-creates an entity + placement; its inverse deletes the entity **only if** it now has exactly one placement (this one) and no extra `entity_patches` — if the entity was since placed elsewhere (`place_entity`), undo deletes only the placement (it has become legitimately shared). The entity's `entity_patches` are discarded only when the entity itself is deleted. The conditional decision is made at **apply time** (like `captureStories`), not baked into a static inverse.

### D6 — Restoring a placement with a dangling `entityId` falls back to cache, never FK-violates (R1).
Makes deferred orphan-GC and undo-after-entity-delete safe: if a restored placement's `entityId` points to a missing entity, null it and read from the cache columns.

### D7 — `editEntity`/`undoEntity`/`redoEntity` invalidate + emit to EVERY timeline holding a placement (R10/R11).
`SELECT DISTINCT timelineId FROM nodes WHERE entityId = E` → invalidate `['graph', tid]` and `emitTimelineEvent` for each, stamping events with `maxAppliedSeq(tid)` (not the entity seq — different keyspace) so SSE clients don't rewind. *Justification:* a shared edit is visible on N timelines; invalidating only the active one leaves B/C (incl. signed-out public viewers) stale indefinitely.

### D8 — The op/save layer forks content edits on entity-backed nodes to `editEntity` (R13).
In `mcp/ops.ts` and the in-app `NodeDetailPanel` Save: a content-field edit on an entity-backed node routes to `editEntity` (entity stack + propagation); only `lane`/layout stays a per-timeline graph patch. `update_node`'s content fields are deprecated (warn + route); a new `update_entity` MCP tool is the explicit content path.

### D9 — Delete = placement-only; orphans are allowed (GC deferred).
Deleting a node removes that timeline's placement; the entity survives if used elsewhere, and becomes an orphan (zero placements) otherwise. Orphans are safe (D6), still have an entity page, and can be re-placed. GC is a later concern.

### D10 — Naming: keep `entities` despite the `entity` NodeType collision.
An `entities` row backs ANY node type (event/entity/period/concept) — it is "canonical node content," not the `entity` type. Documented here; not renamed, to match founder vocabulary.

---

## Schema (DDL sketch)

```
entities:        id (pk), owner_id (fk user), type, title, summary,
                 start_instant, end_instant, precision, metadata (json),
                 created_at, updated_at
nodes:           + entity_id (text, nullable, fk entities)   -- the only node change
entity_patches:  id (pk), entity_id (fk entities, cascade), owner_id (fk user),
                 seq (monotonic per entity), summary, ops (json EntityOp[]),
                 inverse_ops (json), status ('applied'|'undone'), created_at
GraphOp union:   + place_entity { entityId, ref? } ; add_node op carries a baked entity row
```

Migration `0026` (additive): create `entities` + `entity_patches`, add `nodes.entity_id` (nullable, indexed); backfill one entity per existing node (copy content, set `entityId`, `ownerId` via node→timeline-owner FK traversal + sole-user fallback); **no NOT-NULL rebuild**.

---

## Consequences / verification

- **Behavior preserved:** existing timelines unchanged (1:1 backfill); the per-timeline Patch engine + canvas ⌘Z untouched for structural edits; bare-node fallback keeps every `verify:*` script green without edits.
- **New truth:** `verify:entities` proves place-on-2-timelines → edit → propagate → entity-undo → delete-one-placement-keeps-entity on a throwaway DB.
- **The two-stack interaction is provably safe** because the only shared dependency (a patch inverse referencing an entity) is protected by D5/D6.

## Deferred / open
Orphan GC; per-placement content overrides; cross-timeline edges/stories; the `entities`-vs-`entity` rename.
