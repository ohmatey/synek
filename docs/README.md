---
project: "Synek"
updated: 2026-06-12
---

# Synek — Documentation

Standardized docs structure (crew-managed, see `/docs-ops`). Migrated from the legacy `.can/` directory on 2026-06-12 — `git log --follow` preserves history across the move.

## TLDR

- **Strategy:** [product/product-strategy.md](product/product-strategy.md) — positioning, personas, the bets table (system of record for the Bet Council), and the lovable gate.
- **Roadmap:** [product/roadmap.md](product/roadmap.md) — NOW / NEXT / LATER / Deferred; the offline source of truth Sal renders from `.sector137/state.json`.
- **PRDs:** [product/prd/](product/prd/README.md) — the story layer (S1–S4), map (VIS), nav (NAV), connection (KEYS).
- **ADRs:** [engineering/adr/](engineering/adr/README.md) — locked technical decisions; PRDs reference ADRs as the data-model source of truth.

## Domains

| Dir | Owner | Contents |
|---|---|---|
| [product/](product/) | Margot | Product strategy, roadmap, PRDs |
| [engineering/](engineering/) | Kael | ADRs, technical plans |
| [ux/](ux/) | Wren | Research, personas, design reviews (empty — seeded on first engagement) |
| [project/](project/) | Sal + Mira | Pipeline state notes; work queue lives in `.sector137/state.json` |
| [workflows/](workflows/) | Sal | Cross-cutting process docs, decision log |
| [sales/](sales/) | Harlan | **Deferred** — scope guardrail: no GTM/pricing work until the core is undeniable |

## Conventions

Every doc: TLDR up top, ACTION PLAN near the end, metadata header, cross-links by relative path. ADRs are immutable once Accepted. Date-stamped reports: `{type}-{topic}-{YYYY-MM-DD}.md`.
