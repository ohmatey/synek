---
project: "Synek"
owner: Margot (product) · founder
updated: 2026-06-17
status: Active — system of record for the Bet Council (/sector137:bets)
links: [roadmap.md, prd/README.md, ../engineering/adr/README.md, ../engineering/adr/0005-cull-public-discovery.md, stories-first-pivot.md]
supersedes: "2026-06-12 strategy (local-first, single-user, history-enthusiast framing — retired by founder 2026-06-14, then posture partly restored to local-first by the 2026-06-17 pure-app cull, ADR 0005)"
---

# Synek — Product Strategy

## TLDR

- **Positioning:** Synek is a **local-first app for creating immersive, serialized stories** — build a world once (timeline, entities, globe), grow it a chapter at a time with your own AI (your MCP client or a local model) or the optional in-app key-gated agent, and publish it as responsive, SEO-ready pages. Anyone downloads it and runs it locally; **deploy it to the cloud to share publicly.** Realscript is one integration (brand + social distribution), not the headline.
- **The unit of value is now the story, not the timeline.** Timelines, entities, and the globe are creation and navigation surfaces — the supporting cast. A Project is the top-level container.
- **Primary persona (now):** the digital-story creator / serial worldbuilder — building a living, serialized world, owning their data locally, and publishing to a digital audience when they choose to.
- **Posture (2026-06-17 pure-app cull, ADR 0005):** **local-first pure app** — no landing page, no public discovery feed; the root `/` is the workspace. **Cloud is a deploy mode**, not a separate product. The cloud infrastructure (multi-tenant per-user isolation, open signup + email verification/reset, BYO encrypted OpenRouter key, Fly deploy) is all **built** and powers that deploy mode; the optional key-gated in-app agent and per-story public sharing (`/s/$slug`) are unchanged. The lovable-gate "deferred until gate fires" framing is obsolete.
- **The bets table below is the system of record.** Status changes happen here first.

---

## Positioning

One sentence: *Synek is a local-first app for creating immersive, serialized stories — build a world once, grow it a chapter at a time with your own AI, run it on your own machine, and deploy it to share.*

The structural identity: you open a Project, you read and continue Stories. The timeline, the globe, the entity cards are lenses on that story's world — they exist to make the story navigable and inhabited, not to be the destination themselves.

**Synek stands alone.** Anyone can download it, run it locally against their own MCP client or local model, and build a world without an account or a server. Deploying it to the cloud unlocks the multi-tenant + public-sharing surface (below) — that's an *option*, not the identity.

The Realscript relationship is a **strong integration and a dogfooding wedge** (bets B7/B8), not the headline. Realscript ships short-form/storyboard content at velocity; Synek is where long-running, world-anchored, serialized work lives. Shared brand (Realscript's brand API themes a Synek project). Shared distribution (Synek hands a finished story to Realscript's social scheduler). Shared component surface (Synek is Realscript's first external consumer of the immersive-story component library, proving the contract on a different stack). Because Synek is a separate repo on a different stack, every integration it consumes is a real external-contract test — an internal monorepo app could never produce this signal. But a creator who never touches Realscript is fully served.

The MCP inversion persists and deepens: when no in-app key is configured, the user's own MCP client (Claude Desktop / Code, or any OpenAI-compatible local-model endpoint) is the brain, Synek is the canvas. When a key is present, the same in-app agent loop runs over the same tool registry. One surface, two callers — BYO or hosted, identical tool contract.

**What is retired:** the "Claude's spatial memory / private research canvas" framing. The old positioning assumed a user building for themselves. The new positioning assumes a creator building for an audience — the world is the artifact, and publication is the exit condition.

---

## Personas

**Primary — the digital-story creator / serial worldbuilder.** Builds a living, growing world and publishes it serially to a digital audience. Nonfiction-first (real history, sourced and grounded), but the fiction roadmap (P4, project kind flag) is in view. Their loop: open a Project → read the latest story → extend the world (add nodes, events, entities via MCP client or in-app agent) → write the next chapter → publish it to `/s/$slug` → schedule it to social via Realscript. They return because the world is alive and the audience is watching. They cite. They curate. They grow.

What "return" looks like for this persona: they come back to write the *next* chapter, not to revisit what they already built. The timeline and globe are navigation tools — ways to orient before writing. The story is the destination.

JTBD (top 3):
1. Build a world once and grow it without losing coherence — the graph + patch history is the coherence layer.
2. Publish that world in a format the internet can read — responsive, SEO-indexed, shareable via `/s/$slug`.
3. Keep the world current with new research and events — citations, artifacts, scheduled chapters.

**Adjacent — the Realscript marketer.** Builds brand-forward campaign narratives using Realscript's content velocity. Discovers Synek via the Realscript integration (brand theming → project theme; scheduled story → Realscript social). Lower overlap day-to-day; higher overlap at the brand and distribution seams. They are not the primary persona but they validate the companion positioning.

**Note — the history enthusiast / private researcher.** Still a valid use case. The artifact grounding moat (B4), the globe, the citation tooling — all serve this user. But they are not the persona Synek is built for. We do not add friction to serve them, but we do not build features specifically for private-research-with-no-audience. The creator loop (build → publish → grow audience) is the axis. A researcher who publishes is inside the primary persona.

**Explicit non-persona (for now):** teams, enterprise, workspaces. Still deferred — Phase 2 is per-user isolation; multi-user collaboration is beyond this horizon.

---

## North Star

**A creator opens Synek, reads the latest chapter of their serialized world, writes the next one with their own AI, and publishes it to an audience that found it via a shared link.** The globe, the timeline, and the entities are the world they're writing into.

Every roadmap item earns its place by serving this loop: world-building → story-writing → publishing.

---

## Shipped reality (reconciliation with CLAUDE.md and prior strategy)

The 2026-06-12 strategy doc was written when the product was local-first, single-user, with no in-app AI, no public sharing, and a lovable gate gating everything. Multiple items it called "Deferred" are now shipped. This section is the canonical reconciliation.

| Item | Prior status | Actual status |
|---|---|---|
| Posture | Deferred cloud (lovable gate) → cloud-first (2026-06-14) | **Local-first pure app (2026-06-17, ADR 0005)** — cloud-first was reversed; cloud is now a *deploy mode*. The cloud infra below is still built and powers it |
| Optional in-app key-gated agent | Out of scope | **Shipped** — `src/lib/agent/`, OpenRouter function-calling loop, same tool registry as MCP (`local-120`) |
| Multi-tenant per-user isolation | Deferred | **Shipped** — per-user `ownerId` on all owned rows, owner-scoped reads at all entry points, BYO encrypted OpenRouter key (`user_settings`, AES-GCM), Fly deploy (`local-123`) |
| Public sharable stories | Deferred | **Shipped** — `/s/$slug` SSR OG + mobile reels reader, `timeline.isPublic` gate, ShareStoryButton, growth CTA (`local-119-ish`) |
| Per-user BYO OpenRouter key | Deferred | **Shipped** — `user_settings.openRouterKeyEnc`, `AgentKeyCard` in `/api-keys` |
| Open signup + email verification/reset | Deferred | **Shipped** — Resend integration, `src/lib/auth/email.ts` |
| Lovable gate as gating mechanism | Active | **Obsolete** — the gate was designed for "do we build hosting?" The hosting is built. Measurement still matters (B1 instrumentation) but as a product signal, not an unlock gate |

The scope guardrail in CLAUDE.md is updated to reflect this reality. What remains deferred: billing/metering, workspaces/teams, and the fiction-world basemap (P4).

**2026-06-17 revision (pure-app cull, ADR 0005):** the 2026-06-14 *cloud-first* posture was reversed to **local-first pure app**. The cross-user public Explore discovery feed (shipped 2026-06-16) and the dead marketing landing page were **deleted**; the root `/` is the signed-in workspace. Per-story sharing (`/s/$slug`) was **kept**. Cloud (multi-tenant, signup, Fly) is unchanged underneath — it is now framed as the *deploy mode* and the public-sharing/acquisition surface, not the default.

---

## Bets

System of record. Columns: validation signal, kill condition, instrumentation.

| ID | Bet | Why we believe it | Validation signal | Kill condition | Status | Instrumentation |
|---|---|---|---|---|---|---|
| **B1** | **The MCP inversion** — no AI in-app by default; user's own MCP client is the brain when no key is set; the optional in-app agent is the progressive enhancement, not the default | Zero marginal cost on the BYO path; the in-app agent reuses the same tool surface (no lock-in); both paths write to the same canvas | Outside users connect their own client via setup without hand-holding; in-app agent path is discovered and used when key is configured | Setup friction kills >half invited cohort before first canvas; in-app agent path never used even when key is present | **Live — architecture shipped; both paths in production** | Setup completion vs. drop-off (self-report + `self_host_heartbeat`); `mcp_tool_called` per transport (MCP vs. agent runner) |
| **B2** | **"Watch it build" is the wow** — live side-by-side (MCP client) or in-app agent SSE creates instant want | Live SSE canvas shipped; side-by-side is visceral in a way screenshots aren't; in-app agent produces the same effect without a second window | Demo recording published; viewers ask "how do I get this" unprompted | Recording lands flat — views but no asks | **Built, unproven** — 60-second recording is still owed | Asks/shares per channel |
| **B3** | **Stories are the product** — the story is the unit of value; without it Synek is a tidy diagram; with it, Synek is a creator's publishing tool | Stories-first repositioning (2026-06-14, founder); story reader, casts, covers, narration, public reader, beat widgets all shipped; the sharable story is the acquisition loop | Creator-persona users (publishing audience) return to write the next chapter unprompted; `/s/$slug` pages drive inbound ("how do I make one of these?") | Returners only look at the graph and never write or publish a story | **Core — repositioned as the primary bet (2026-06-14); measuring** | PostHog: `write_story` calls, story publish rate, `/s/$slug` traffic; qualitative interview |
| **B4** | **Artifact grounding is the moat** — register a source once, cite it everywhere; the gap between Synek and "just ask Claude" | Stories without sources are plausible fiction; reuse turns citations into a compounding corpus; ships as `register_artifact` / `search_artifacts` | Claude re-cites registered artifacts in later sessions; artifacts accumulate across projects | Artifacts registered once and never re-cited or browsed across sessions | **Active build** — S2.1–S2.5, ADR 0001 | `mcp_tool_called` on `search_artifacts` / `register_artifact`; re-citation rate |
| **B5** | **The verb system drives expansion** — every node offering its obvious next move turns viewing into growing | Copy-prompt machinery shipped; canvas computes its own gaps (`get_layout_report`); Tier 1 verbs reuse existing PromptSpec machinery at low cost | Verb copy-rates show repeated use; expand-family verbs produce patches | Verbs sit uncopied after Tier 1 ships | **Planned** — NEXT.5 Tier 1 | `PromptSpec.analytics` copy events (wired) |
| **B6** | **The publish/share loop drives acquisition — on the hosted instance** — a creator publishes a story; their audience finds `/s/$slug`; inbound ask is "how do I make this?" | The sharable story page is built; SSR OG + mobile reader + "Make your own" CTA are shipped; each public story is a free acquisition event. **Post-cull (ADR 0005): this is a CLOUD-MODE bet** — `/s/$slug` only reaches the public internet from a deployed instance, so the hosted instance is the acquisition surface; local-first is the on-ramp/ownership mode | Inbound "how do I get this" asks traced to `/s/$slug` referrers; week-2 signups via organic share (on the hosted instance) | Public stories are viewed but don't convert; no organic "make your own" traction; OR local users never deploy to share so the loop never starts | **Built, unproven** — organic traffic and conversion untested; now explicitly gated on cloud deployment | PostHog (hosted): `/s/$slug` traffic source; signup source; referral path; local→deploy conversion |
| **B7** | **The dogfooding wedge** — Synek as Realscript's first external customer hardens Realscript's public API contracts (brand, scheduler, components) in ways an internal app never can | A separate-stack consumer on a different runtime (Bun/TanStack vs. pnpm/Next) exposes cross-stack bugs and contract gaps that co-located code would never surface | Brand API integration ships (P2) and finds at least one contract gap; scheduler integration ships (P6); component extraction (P7) surfaces a framework-coupling bug | Integration is too thin to produce signal — Synek just wraps Realscript without exercising real contract edges; or operating discipline collapses (building Synek features *to* test Realscript instead of building what Synek needs) | **Structural** — standing operating discipline; P2 is the first live test | Count of contract gaps surfaced per integration phase; subjective: does Realscript's API harden measurably from each Synek integration? |
| **B8** | **Nonfiction grounding is a competitive moat vs. pure fiction tools** — citations, artifacts, primary sources, and geoScope make Synek stories trustworthy in a way AI-generated content is not | The creator persona (nonfiction-first) needs credibility signals; fiction users have many tools; grounded-nonfiction worldbuilders have almost none | Creators cite and ground their work; `search_artifacts` reuse rate is high; audience engagement is higher on cited stories | Creators skip citations; sourcing is friction, not value | **Assumption** — nonfiction-first is the 2026-06-14 locked stance; testing begins at P1 | Citation rate per story; `register_artifact` use in first session; qualitative: does grounding feel like a feature or a chore? |

**Council cadence:** review on ask; any status change lands here first.

---

## Scope

### In scope (shipped or committed)

- Local-first pure app — the default; anyone downloads and runs it locally with their own MCP client / local model. No landing page, no public discovery feed; root `/` is the workspace (ADR 0005)
- Cloud as a deploy mode — the same codebase deployed multi-tenant; the public-sharing / acquisition surface
- Optional key-gated in-app agent (`OPENROUTER_API_KEY`) — progressively enhancing the BYO-client path
- Multi-tenant per-user isolation — open signup, email verification/reset, per-user BYO OpenRouter key (encrypted at rest) — powers the cloud deploy mode
- Public sharable stories — `/s/$slug` SSR OG + mobile reels reader (public reach requires a deployed instance)
- The MCP tool surface as the single write path (both transports)
- The Patch invariant
- Projects container (P1 — committed, Kael ADR in progress as of 2026-06-14)
- Serialized stories with scheduled chapters (P3)
- Realscript brand integration via HTTP (P2)
- Conversational entities (P5 — promoted from H.1 deferred)
- Social distribution via Realscript scheduler (P6)
- Nonfiction-first grounding: citations, artifacts, `geoScope`, sourcing
- Fiction-world projects (P4) — designed in via `projects.kind` flag; basemap parameterization is roadmapped, not built

### Still deferred

- Billing / metering of agent + image usage (Phase 3)
- Workspaces, teams, roles, enterprise SSO/audit logs
- The fiction basemap itself (P4 — `projects.kind` flag designed in from P1, but non-Earth globe and canon-bible storage are roadmap)
- Component extraction to a framework-neutral package (P7)
- Vector search / embeddings (FTS5 first per prior decision)
- Weekly email digest, server-side image generation, realtime SSE on public pages
- Public discovery / browsing of whole workspaces — the cross-user Explore feed shipped 2026-06-16 then was **culled 2026-06-17** (ADR 0005); deferred again. Per-story share links (`/s/$slug`) are the only public surface

### Operating discipline

The in-app agent stays **optional** — with no key configured, the BYO-client local-first default is fully intact. Never build a Synek feature *to* test Realscript — exercise Realscript's surfaces as a byproduct of building what Synek's creator user needs.

---

## The phased roadmap

Source of record: `docs/product/stories-first-pivot.md` §6.

- **P1 — Project container**: `projects` table, `timelines.projectId`, resource project-scoping, MCP `create_project`/`list_projects`, project-scoped reads, migration/backfill. Stories as default lens at project level. Owner: Kael (ADR) → build.
- **P2 — Realscript brand integration**: brand HTTP client → `projects.theme`; "Use a Realscript brand" picker; theme inheritance.
- **P3 — Serialized stories + morning-chapter loop**: story `kind: serialized`, chapters as ordered stories under a series, scheduled per-story agent run.
- **P4 — Worlds + parameterized globe**: `projects.world` basemap param, Earth + fiction template, `GlobeLens`/`GlobeMiniWidget` basemap refactor, fiction canon-bible storage.
- **P5 — Conversational entities**: live chat grounded in entity + time window; promotes verb S3.4 "Talk to {entity}" to a real conversation.
- **P6 — Social distribution**: Realscript scheduler HTTP client; "Share to social" from a published story; media format decision.
- **P7 — Component extraction**: lift proven immersive-story components into a framework-neutral package; Synek is the first consumer, then Realscript.

---

## ACTION PLAN

1. **Formalize P1 (Project container)** — Kael's ADR (in progress); Margot PRD per phase once the ADR lands. This is the foundational re-center everything else hangs off.
2. **Record the 60-second demo (B2)** — the creator positioning changes what the recording shows: not "Claude builds a Stoicism diagram" but "a creator publishes a world." The recording should end on the `/s/$slug` page, not the canvas.
3. **Instrument B3 + B6** — configure PostHog on the hosted instance to track `write_story` calls, story publish rate, and `/s/$slug` traffic source. The publish/share loop (B6) is the acquisition bet; it can't be measured without telemetry on the public page.
4. **Run P2 (brand integration)** — the fastest proof of the companion positioning; validates the Synek↔Realscript link against a real Realscript brand API endpoint.
5. **Bet Council reviews after P1 lands** — update B3/B6/B7 statuses with first real signal.

---

## Change log

### 2026-06-17 — Pure-app cull (founder; posture patch, ADR 0005)

**Posture:** OLD (2026-06-14) — cloud-first, fully functional self-hosted. NEW — **local-first pure app**; cloud is a *deploy mode*, not the default. Anyone downloads and runs it locally with their own MCP client / local model.

**Removed:** the cross-user public **Explore discovery feed** (shipped 2026-06-16) and the dead marketing **landing page**; the root `/` is now the signed-in workspace. **Kept:** per-story sharing (`/s/$slug`) and all cloud infra (multi-tenant, signup, Fly) — reframed as the deploy/acquisition mode.

**Positioning:** the lead sentence re-leads as a **standalone** local-first story tool; **Realscript demoted** from headline ("companion app to Realscript") to one integration / dogfooding wedge (B7/B8). Persona, North Star, and bets B1–B8 otherwise unchanged.

**Bets:** **B6 (publish/share → acquisition) reframed as a CLOUD-MODE bet** — `/s/$slug` only reaches the public internet from a deployed instance, so acquisition happens on the hosted instance; local-first is the on-ramp. New kill-condition added: local users never deploy, so the loop never starts. "Public browsing of whole workspaces" returns to deferred.

**Scope:** "What does 'local models' mean" resolved to the **BYO MCP client** path (the MCP inversion) — no in-app local inference was added; the agent runner is untouched.

**Decision record:** [ADR 0005](../engineering/adr/0005-cull-public-discovery.md) (founder via AskUserQuestion, 2026-06-17).

### 2026-06-14 — Stories-first repositioning (founder, locked)

**Positioning:** OLD — "Synek is Claude's spatial memory; timeline-first knowledge canvas; no AI in-app; local-first." NEW — "Synek is the companion app to Realscript for creating immersive, serialized stories for the digital world; Projects-first; cloud-first; optional in-app agent."

**North Star:** OLD — 60-second Stoicism recording (Claude left / canvas right, watch it build). NEW — creator opens a Project, writes the next chapter of their serialized world with their AI, publishes it to an audience.

**Personas:** OLD — primary = history/learning enthusiast (private research, builds for themselves); second wave = analyst/Watcher. NEW — primary = digital-story creator / serial worldbuilder (builds for an audience, publishes serially); Realscript marketer as adjacent; history enthusiast retained as a use case, not the persona.

**Bets:** OLD B1–B7 kept and reframed; B1 (MCP inversion) updated to reflect shipped in-app agent as progressive enhancement; B3 (stories) elevated from "one bet among several" to the core bet; B6 (publish/share loop) added; B7 (dogfooding wedge) added; B8 (nonfiction grounding as moat) added. Prior B6 (persona sequencing) and prior B7 (local→hosted seam) retired into structural architecture notes.

**Scope guardrail:** OLD — cloud/SaaS/teams/billing/hosted models/public sharing deferred until lovable gate fires. NEW — those items are reconciled against shipped reality: cloud-first, multi-tenant, public sharing, and in-app agent are IN; billing/metering and teams/workspaces remain deferred.

**Lovable gate:** Retired as a gating mechanism for scope. The gate was designed to unlock hosting; hosting is shipped. Measurement (B1 instrumentation, `self_host_heartbeat`) is retained as a product signal.

**Decision record:** `docs/product/stories-first-pivot.md` (founder, 2026-06-14).
