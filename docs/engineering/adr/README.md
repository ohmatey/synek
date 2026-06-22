# Architecture Decision Records

Locked technical decisions for Synek. An ADR captures **one decision**, the context that forced it, and the consequences we accept — so it is not re-litigated. PRDs (`../../product/prd/`) reference ADRs by path as the source of truth for any data-model or architecture choice.

**Status lifecycle:** `Proposed` → `Accepted` → (`Superseded by NNNN` | `Deprecated`). An ADR is immutable once Accepted; a changed decision gets a *new* ADR that supersedes the old one.

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-sources-artifacts-schema.md) | Sources / artifacts normalized schema (S2 — artifact grounding) | Accepted |
| [0002](./0002-ssrf-egress-guard.md) | Server-side egress SSRF guard | Accepted |
| [0003](./0003-projects-container.md) | Projects: a top-level container above timelines | Proposed |
| [0004](./0004-shared-entities.md) | Shared entities (placements + canonical content overlay) | Proposed |
| [0005](./0005-cull-public-discovery.md) | Cull public discovery — root `/` is the workspace | Accepted |
| [0006](./0006-serialized-stories.md) | Serialized stories: series, chapters, the next-chapter loop | Proposed |

## Conventions

- Filename: `NNNN-kebab-title.md` (zero-padded, monotonic).
- Sections: **Status · Context · Decision · Schema (if any) · Consequences · Alternatives considered · Migration & rollout · Open / deferred**.
- Data-model ADRs cite the actual `src/lib/db/schema.ts` shapes they extend and the next free Drizzle migration number — they do **not** generate the migration (design-only).
