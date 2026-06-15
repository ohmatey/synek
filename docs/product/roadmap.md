---
project: "Synek"
owner: Margot (product) · conducted via /sal
updated: 2026-06-14
status: Active — reflects the stories-first repositioning
supersedes: "the local-first / 'Claude's spatial memory' NOW-NEXT-LATER roadmap (pre-2026-06-14); prior prose preserved in git history"
links: [product-strategy.md, stories-first-pivot.md, ../engineering/adr/0003-projects-container.md]
---

# Synek Roadmap

> **Synek is the companion app to Realscript for creating immersive, serialized stories for the digital world.** Build a world once (timeline, entities, globe), grow it a chapter at a time with your own AI, and publish it — responsive, SEO-ready `/s/$slug` pages, scheduled to social via Realscript. **Stories are the product; timelines, entities, and the globe are creation + navigation surfaces.**
>
> **Strategy · personas · bets:** [product-strategy.md](product-strategy.md) (system of record). **Decision record for this pivot:** [stories-first-pivot.md](stories-first-pivot.md). **Projects architecture:** [ADR 0003](../engineering/adr/0003-projects-container.md). **Work queue:** `.sector137/state.json` (`#local-N`).
>
> **Posture:** cloud-first, fully functional self-hosted, progressively enhanced. Multi-tenant per-user isolation, the optional key-gated in-app agent, and public sharable stories are **SHIPPED** — the old "deferred until the lovable gate fires" framing is **retired** (the gate survives only as product signal, not as a scope gate).

---

## North Star

> A creator opens a **Project**, says *"write the next chapter,"* watches their world grow a beat at a time, and **publishes** it — a cinematic story page that pulls a reader in, with a "make your own" trail back to Synek.

The old north star (a 60-second Stoicism canvas build) is retired as the headline. The live canvas build remains a *supporting* wow; the destination is now the published, shared story.

---

## The spine — 7 phases

Horizon mapping: **P1 = NOW** · **P2–P3 = NEXT** · **P4–P7 = LATER**. Detail per phase lives in `stories-first-pivot.md §6` and the PRDs under `prd/`.

### P1 — Projects + the stories-first home  ·  NOW

The foundational re-center. A **Project** becomes the top-level container holding many stories, timelines, entities, and resources.

- **Projects container** (`#local-125`) — `projects` table; nullable `projectId` on `timelines`/`artifacts`/`sources`; migration 0020 copying the proven 0019 nullable+backfill shape (no NOT-NULL rebuild); `db/projects.ts`; server RPCs; MCP `create_project`/`list_projects`/`get_project` + `ctx.projectId`; minimal projects UI. Per [ADR 0003](../engineering/adr/0003-projects-container.md).
- **Move affordances** (`#local-126`) — UI + server to move things (timelines, stories, entities, resources) **in and out of** projects (reassign / organize).
- **Cinematic stories-first home** (`#local-127`) — Netflix-style: featured stories as **cinematic hero experiences**; beneath them **horizontal scroll rows** (carousels) of entities and timelines; **clicking a project filters the whole page**. Wren design → Margot PRD → build.

Done when: a creator can group their work into Projects, reorganize across them, and land on a cinematic, project-filterable home that leads with stories.

### P2 — Realscript brand integration  ·  NEXT

Dogfood Realscript's brand export from the outside. Pull tokens/voice via the brand HTTP API (`/api/v1/brands/{id}/theme.css|tokens|kit`) or `@realscript/brands` SDK → apply onto `projects.theme` (timelines inherit/override). Proves the brand contract for an external consumer; gives every Project a coherent identity.

### P3 — Serialized stories + the morning-chapter loop  ·  NEXT

The headline magic. A story becomes a **series of chapters**; a scheduled per-story run asks the agent to *write the next chapter* — pulling from existing entities/periods/citations and **enriching** the timeline + globe as it goes. Reuses the proposed-Patch review model (preserves the Patch invariant). Depends on a scheduling/cron seam. (Nonfiction-first: enrichment = web research + citation.)

### P4 — Fiction worlds + the generated globe  ·  LATER

`projects.kind = 'fiction'` (the flag ships in P1, inert). Adds a **parameterized globe basemap** — Earth, plus **generated / template fictional worlds** (Harry Potter, Lord of the Rings). "Lore references" replace citations; canon-consistency replaces sourcing. Separate ADR (globe-basemap parameterization).

### P5 — Conversational entities  ·  LATER

"Talk to a character within a time period" — a live in-app chat surface grounded in an entity + a time window (what they could plausibly know). Promotes the shipped verb-system "Talk to {entity}" copy-prompt into a real conversation. Home: the deferred `H.1 conversations` schema.

### P6 — Social distribution  ·  LATER

Hand a published story to Realscript's **scheduler** (`POST /api/schedules`, `x-internal-service-key`) for TikTok/YouTube/Instagram. Media decision: post the cover image + `/s/$slug` link, or render the reel to video. Dogfoods the scheduler contract; closes the create→publish→distribute loop.

### P7 — Shared component extraction  ·  LATER

Extract the proven immersive-story components into a **framework-neutral React + Tailwind-v4 package** (zero Next imports) that both Synek and Realscript consume. Synek is the **first external consumer** — the extraction flushes out the cross-stack issues (`next/*`, RSC, workspace deps) an internal app never would.

---

## Shipped foundation (what the pivot rides on)

> Built + verified at the data layer (typecheck + build + contract tests). A live in-browser UI pass remains owed (`#local-62` — Claude Preview can't hydrate the dev server).

- **MCP inversion** + **optional key-gated in-app agent** (`src/lib/agent/`, one shared tool registry) — the BYO-client default plus the OpenRouter "Run" path.
- **Patch invariant** — one logical edit = one atomic undoable Patch.
- **Canvas** (React Flow, client-only), **globe lens** (d3-geo orthographic, Earth), **timeline themes**, **verb system** (Tier 1 + Tier 2 alive-canvas).
- **Stories layer** — `write_story`, the docked + public reader, **Stories view** (third lens), narration + auto-play, per-beat live widgets.
- **Artifact grounding (S2)** — `sources`/`artifacts` + `register_artifact`/`search_artifacts` (the moat).
- **Public sharable stories** — `/s/$slug`, SSR OpenGraph + Twitter cards, mobile reels, live per-beat widgets.
- **Multi-tenant Phase 2** — per-user isolation, open signup + email verify/reset (Resend), per-user BYO encrypted OpenRouter key, Fly.io deploy.
- **Analytics** — opt-out PostHog (client + MCP), key-gated; opt-in self-host heartbeat.

---

## Monetization model + instrumentation (M) — measure before pricing

> **Founder-locked model (2026-06-14).** Money is **not** made on tokens. Two SKUs over the same value-add (persistence + structure + visualization + publishing — the memory-and-output layer Claude/Codex can't give you):
> - **BYO seat (devs/prosumers)** — bring your own Claude/Codex/OpenRouter subscription; pay a seat for access. **~Zero inference COGS** to us.
> - **Managed seat (non-tech creators)** — we provide inference, bundled into a **considerable** subscription priced so COGS is a comfortable fraction. The "they can't BYO" wall **is** the monetization (convenience premium, no substitute). One CFO guardrail: a **fair-use cap** on this seat (a ceiling, not a billing meter) so a runaway user can't erode margin.
> - **Open source = pure distribution.** Self-hosters/tinkerers spread it; zero revenue expectation. The money is the managed creator seat.
>
> **Discipline: you cannot price what you haven't measured.** Ship the instrumentation, run free, read the distribution, *then* set one seat price (seat pricing is value-based and forgiving — recoverable if wrong). The financial model (CFO spreadsheet) consumes these same metrics as its assumptions — measured numbers replace guesses over time. Spec: [understand-app.md](prd/understand-app.md). Queue ids TBD (Sal to assign).

The five measurement buckets (priority order). Each is a PostHog funnel/cohort + (where quantitative) a row in the usage ledger:

- [ ] **M.1 — Activation funnel** — `signup → key connected → first timeline → first story → first share`. **Watch the key-connection drop-off above all** — it's the single number that proves/kills the BYO-for-devs vs managed-for-creators split.
- [ ] **M.2 — Retention cohorts** — D1/D7/D30 return, weekly-active, "created something this week." The lifeblood of seat SaaS (not usage). Churn is the model's most sensitive driver.
- [ ] **M.3 — Engagement depth (value-add proxies)** — timelines created, stories written, stories shared, public-story opens, agent runs, widgets used. Reveals *which* features correlate with retention → that's what the seat is worth.
- [ ] **M.4 — Viral loop (the GTM)** — `share → public open → signup attributed to a share`. The **viral coefficient** is the number that says whether the funnel compounds. Feeds new-signup growth in the model.
- [ ] **M.5 — Your-side costs** — the bits we pay even under BYO: hosting, storage, image storage, bandwidth, plus managed-tier inference. So real (small) COGS behind each seat is known per user.
- [ ] **M.6 — The "Understand" internal app** — a small **internal-only** admin surface (not a product), reading PostHog + a repurposed usage ledger. Three views: **(a)** per-user table (engagement × your-cost × stickiness × shares-driven), **(b)** retention cohort chart, **(c)** the share→open→signup funnel + the key-connection drop-off. This *is* the "pricing dashboard to first understand." Full spec: [understand-app.md](prd/understand-app.md).

**NB — do NOT build the NATS billing pipeline.** Seat + BYO billing is Stripe per-seat (flat), no meters. The usage ledger here is for **product intelligence + fair-use + COGS visibility**, not billing. The NATS event stream stays a *later* concern (component extraction), not a billing dependency.

---

## Deferred — still out of scope

- **Billing / metering** of agent + image + scheduler usage (the cloud rollout's Phase 3).
- **Teams / workspaces / roles**, enterprise SSO / audit logs.
- **Proactive cloud-cron industry-mapping agent / signal ingestion** as an in-app service (the client-side keeper is the `/synek:watch` plugin skill; the per-timeline local variant is the dormant **L — Living Timelines**, `#local-50`).
- **Witness mode (S4)**, multi-POV (S3) deepening, generated node illustrations (`#local-68`) — pre-pivot story-layer extensions, revisited only if the new creator loop pulls them in.

---

## Reconciliation note (for Margot)

The pre-pivot **NOW critical path** predates this strategy and needs reconciling against it:
- `#local-61` (record the 60-second **Stoicism canvas** demo) — the North Star's protagonist moved to the *published story*, not the canvas build. Re-scope or retarget.
- `#local-63` (lovable-gate experiment) — the gate no longer gates scope (hosting shipped). Keep as product signal or retire.
- `#local-70` release **"v0.1.0 — Grounded core + demo"** — its exit criteria (B2/B4) are pre-pivot; rescope the release around P1 + the new North Star.

Flagged in state note `#local-128`. These are Margot's calls — left intact pending her pass, not unilaterally closed.
