# Decision log

Newest first. ADR-worthy decisions link their ADR; the rest live here.

| Date | Decision | Where |
|---|---|---|
| 2026-06-12 | ADR 0001 **Accepted**; citations are **single-home-per-citation** (artifact-backed → `segment_citations` only; unregistered one-off → inline JSON only; no duplication, no bulk backfill). `register_artifact` standalone; seed pass deferred. S2.1–S2.5 building | [ADR 0001](../engineering/adr/0001-sources-artifacts-schema.md) → Decision 8 |
| 2026-06-12 | NEXT.5 verb-system PRD written; chosen as the S2-parallel track (Tier 1 = different `NodeDetailPanel` region); Talk-to (verb #1) active | [prd/next5-verb-system.md](../product/prd/next5-verb-system.md) |
| 2026-06-12 | Do **not** parallelize Postgres/Docker (NEXT.4) with S2 — S2.1's FTS5 migration is SQLite-only; sequence after S2 lands | [roadmap](../product/roadmap.md) → NEXT.4 |
| 2026-06-12 | Docs migrated `.can/` → `/docs/` (crew-standard layout); `.can/` retired | this log |
| 2026-06-12 | Primary persona: history/learning enthusiasts; second wave: analysts (gated on Living Timelines). Lovable gate: outside users returning unprompted | [product-strategy.md](../product/product-strategy.md) |
| 2026-06-12 | S2 sources/artifacts normalized schema design | [ADR 0001](../engineering/adr/0001-sources-artifacts-schema.md) |
| 2026-06-11 | S2.1–S2.4 promoted from deferred to active NEXT (artifact-reuse trigger) | [roadmap](../product/roadmap.md) → NEXT.1 |
| 2026-06-11 | S2.5 retrieval: FTS5 lexical first; embeddings/vector deferred (hosting-aware) | [roadmap](../product/roadmap.md) → S2.5 |
| 2026-06-09 | Live canvas: SSE chosen over polling/WebSocket; polling kept as fallback | [roadmap](../product/roadmap.md) → NOW.3 |
| 2026-05-25 | Story-layer pivot: canvas = map, stories = product | [prd/README.md](../product/prd/README.md) |
