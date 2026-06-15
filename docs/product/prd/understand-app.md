# PRD — The "Understand" internal app + measurement taxonomy

**Status:** Proposed (roadmap **M.1–M.6**) · 2026-06-14
**Owner:** Margot (product) · Kael (eng) — analytics spine already exists (PostHog)
**Purpose:** Instrument the product to answer two questions **before** we set a price:
(1) *which audience activates* under BYO vs managed, and (2) *what the value-add is
worth* (retention + engagement). This is **measurement, not billing** — seat + BYO
billing is Stripe per-seat, flat. The same metrics become the **assumptions** in the
CFO financial model (`docs/finance/synek-financial-model.xlsx`), so guesses get
replaced by measured numbers over time.

## Non-goals
- **No usage-based billing.** No NATS billing pipeline, no Stripe meters.
- **Not a product.** Internal-only admin surface, owner/admin-gated.
- **No new analytics vendor.** Reuse the existing PostHog spine
  (`src/lib/posthog/{client,server}.ts`, opt-out + key-gated).

## Architecture
- **Behavioral (buckets M.1–M.4):** PostHog events → PostHog funnels/cohorts. Mostly
  *configuration*, plus a handful of new `capture()` calls. `distinct_id` =
  Better Auth user id (already unifies client + server).
- **Quantitative (M.5 + the per-user table):** a small **usage ledger** table (the
  billing-ledger design from the metering discussion, **repurposed** for product
  intel + fair-use + COGS). Append-only; dedupe by event id.
- **The Understand app (M.6):** an internal route (e.g. `/admin/understand`, gated to
  an `isAdmin` flag) that reads the ledger + PostHog's API/exports and renders three
  views. No fancy charting lib needed for v1 — a table + two simple charts.

```
usage_ledger {
  event_id     TEXT UNIQUE,   -- idempotency / dedupe
  owner_id     TEXT,          -- the user (FK to user)
  ts           INTEGER,       -- epoch ms
  metric       TEXT,          -- 'agent_run' | 'agent_tokens' | 'image_gen' | 'storage_bytes' | 'bandwidth_bytes'
  quantity     INTEGER,       -- tokens, images, bytes, …
  your_cost_cents INTEGER,    -- OUR COGS (OpenRouter/image/host) — the margin number
  segment      TEXT,          -- 'byo' | 'managed' (which SKU produced it)
  cycle_id     TEXT,          -- billing/measurement period bucket
  raw          TEXT           -- JSON: model, request id, etc.
}
```

## Event taxonomy (the 5 buckets)

Reuse existing `ClientEvent`s where they exist; new ones marked **(new)**. Properties
are `snake_case`; every event carries `distinct_id = userId`.

### M.1 — Activation funnel  *(the pivotal bucket)*
Ordered steps; the **key-connection drop-off** is the single most important number.
- `signup` **(new)** `{ source }`
- `key_connected` **(new)** `{ provider: 'openrouter'|'anthropic'|'managed', segment }` — **or** `managed_seat_started` for the no-key path
- `timeline_created` **(new)** `{ timeline_id }`
- `story_written` **(new, server)** `{ timeline_id, story_id, beats }` (emit from `write_story`)
- `story_shared` *(exists)* `{ story_id }`

### M.2 — Retention cohorts
- `app_opened` **(new)** `{ }` (session start; PostHog autocapture pageviews may suffice)
- `created_this_week` — derived in PostHog from any create/write event (cohort, not a raw event)
- Existing engagement events below all feed weekly-active.

### M.3 — Engagement depth (value-add proxies)
- `story_started` / `story_completed` *(exist)* `{ timeline_id, story_id, beats }`
- `public_story_opened` *(exists, wire on the `/s/$slug` route)*
- `agent_run_completed` **(new, server)** `{ model, prompt_tokens, completion_tokens, total_tokens, steps, tool_calls, segment }` — from `src/lib/agent/runner.ts` (currently only sums `total_tokens`; emit the breakdown)
- `mcp_tool_called` *(exists, server — `register` wrapper)* — already per-tool with `ownerId`
- `widget_rendered` **(new)** `{ kind }` (timeline/globe/entity) — value signal for the publishing thesis

### M.4 — Viral loop (the GTM)
- `story_shared` *(exists)* — supply side
- `public_story_opened` *(exists)* — demand side; add `{ referrer, slug }`
- `signup` with `{ source: 'shared_story', slug }` — **attribution**: the join that yields the **viral coefficient** = signups-from-shares ÷ shares.

### M.5 — Your-side costs (COGS even under BYO)
Written to the **usage ledger**, not PostHog:
- managed-tier inference (`agent_tokens`, `image_gen` with `your_cost_cents` from the provider's reported cost)
- `storage_bytes`, `bandwidth_bytes`, image storage — periodic rollups
- Purpose: real per-user, per-segment COGS → margin per seat → fair-use cap calibration.

## M.6 — The Understand app: three views
1. **Per-user table** — one row per owner: segment, seat status, `timelines`, `stories`,
   `shares`, `public opens driven`, `agent runs`, **your COGS (¢)**, last-active,
   D30-retained. Sortable. This is the "who's valuable, who's expensive, who drives
   acquisition" view.
2. **Retention cohorts** — weekly signup cohorts × weeks-since-signup retention grid.
   The seat-SaaS health chart.
3. **Acquisition funnel** — `share → public open → signup` with the viral coefficient,
   **and** the M.1 activation funnel with the **key-connection drop-off** called out.

## Sequence
1. Wire the **new `capture()` calls** (M.1–M.4) — small, cheap, mostly server-side at
   existing write points (`write_story`, `runner.ts`, the `/s/$slug` loader).
2. Add the **usage ledger** table + write managed-tier COGS (M.5).
3. Build the **Understand app** route (M.6) — table first, then the two charts.
4. Run **free** on the dev/prosumer wedge; read activation + retention + viral.
5. Feed measured numbers into the **CFO model**; set one seat price from value +
   comparables; raise it as data proves worth.

## Tie to the financial model
Every assumption cell in the spreadsheet has a source metric here:
`signups/mo → M.4 + funnel`, `activation % → M.1`, `monthly churn → M.2`,
`managed COGS/user → M.5`, `viral coefficient → M.4`. The Understand app is the
instrument that turns the model from a guess into a forecast.
