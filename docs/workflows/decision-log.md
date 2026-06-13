# Decision log

Newest first. ADR-worthy decisions link their ADR; the rest live here.

| Date | Decision | Where |
|---|---|---|
| 2026-06-13 | **LATER.3 telemetry built** — opt-in `self_host_heartbeat` (count self-hosted installs: hashed `install_id` + `version` + `db_backend`; default OFF, fires only on `SYNEK_TELEMETRY=1` + a key). Greenlit **ahead of the LATER gate** — Sal triage recommended *park* (the gate is deliberate self-report; first true vendor phone-home); founder chose *build*. `install_id` = derived `sha256(BETTER_AUTH_SECRET)` — **no migration, no 2nd boot-seam DB connection** (deviated from the spec's persisted-random-id); PostHog `phc_` ingest key baked into the image (public/write-only by design, not a secret leak). Registered to **B1** instrumentation; lovable-gate self-report upgrade **deferred** (gate stays self-report) | [roadmap](../product/roadmap.md) → LATER.3 |
| 2026-06-12 | VERBS-T2 **complete** (gap + lane + era invitations); collapse-mode fill affordance shipped (the `TimeRuler` break marker); **`invitation_shown` impression event** added so canvas-verb copy-RATE (not just count) is measurable (bet B5). HeroPreview ghost-fill *loop* deliberately **not** built — `LiveTimeline` is a one-shot pixel-positioned mock, a faithful loop isn't cheap, and `AliveCanvasSection` already demonstrates it; folds into the live browser pass (local-62) | [prd/next5-tier2-alive-canvas.md](../product/prd/next5-tier2-alive-canvas.md) |
| 2026-06-12 | ADR 0001 **Accepted**; citations are **single-home-per-citation** (artifact-backed → `segment_citations` only; unregistered one-off → inline JSON only; no duplication, no bulk backfill). `register_artifact` standalone; seed pass deferred. S2.1–S2.5 building | [ADR 0001](../engineering/adr/0001-sources-artifacts-schema.md) → Decision 8 |
| 2026-06-12 | VERBS-T2 PRD written (gap invitations = "alive canvas", the demo centerpiece + landing-page link). Build gated on Tier 1 copy-rates **or** the demo (B2) — demo override deliberate. Shared dead-zone rule (`dead-zones.ts`) for canvas + `layout-report`; ghost = a `gap` React Flow node type | [prd/next5-tier2-alive-canvas.md](../product/prd/next5-tier2-alive-canvas.md) |
| 2026-06-12 | NEXT.5 Tier 1 verb batch **shipped** (registry + NodeVerbBar + ⌘K verbs-at-top); one `verb_prompt_copied` event keyed by `verb_id` | [prd/next5-verb-system.md](../product/prd/next5-verb-system.md) |
| 2026-06-12 | NEXT.5 verb-system PRD written; chosen as the S2-parallel track (Tier 1 = different `NodeDetailPanel` region); Talk-to (verb #1) active | [prd/next5-verb-system.md](../product/prd/next5-verb-system.md) |
| 2026-06-12 | Do **not** parallelize Postgres/Docker (NEXT.4) with S2 — S2.1's FTS5 migration is SQLite-only; sequence after S2 lands | [roadmap](../product/roadmap.md) → NEXT.4 |
| 2026-06-12 | Docs migrated `.can/` → `/docs/` (crew-standard layout); `.can/` retired | this log |
| 2026-06-12 | Primary persona: history/learning enthusiasts; second wave: analysts (gated on Living Timelines). Lovable gate: outside users returning unprompted | [product-strategy.md](../product/product-strategy.md) |
| 2026-06-12 | S2 sources/artifacts normalized schema design | [ADR 0001](../engineering/adr/0001-sources-artifacts-schema.md) |
| 2026-06-11 | S2.1–S2.4 promoted from deferred to active NEXT (artifact-reuse trigger) | [roadmap](../product/roadmap.md) → NEXT.1 |
| 2026-06-11 | S2.5 retrieval: FTS5 lexical first; embeddings/vector deferred (hosting-aware) | [roadmap](../product/roadmap.md) → S2.5 |
| 2026-06-09 | Live canvas: SSE chosen over polling/WebSocket; polling kept as fallback | [roadmap](../product/roadmap.md) → NOW.3 |
| 2026-05-25 | Story-layer pivot: canvas = map, stories = product | [prd/README.md](../product/prd/README.md) |
