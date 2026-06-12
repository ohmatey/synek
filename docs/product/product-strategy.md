---
project: "Synek"
owner: Margot (product) · founder
updated: 2026-06-12
status: Active — system of record for the Bet Council (/sector137:bets)
links: [roadmap.md, prd/README.md, ../engineering/adr/README.md]
---

# Synek — Product Strategy

## TLDR

- **Positioning:** Synek is **Claude's spatial memory** — the place your research lives, visually and permanently. The app holds no AI; your MCP client is the brain, the canvas is the artifact.
- **Primary persona (now):** history/learning enthusiasts — people who love grounded, time-anchored narrative. The stories layer (S1–S4) is built for them.
- **Second wave (later):** analysts mapping industries — living timelines that stay current (the Watcher). Gated behind LATER.2; nothing built for them yet beyond schema seams.
- **Lovable gate:** ≥3 of ~10 invited outside users return in week 2+ **unprompted**. Until it fires, no hosting, no billing, no GTM.
- **The bets table below is the system of record** — the Bet Council reads it; status changes happen here first.

## Positioning

One sentence: *you talk to Claude about a topic; a timeline builds itself beside the conversation — with faces, eras, and stories you can tap into — and it's still there next month.*

The structural inversion is the identity: every competitor embeds a model; Synek deliberately doesn't. The user's own Claude does the thinking and **writes** via MCP (`apply_patch`, `write_story`); Synek stores, renders, and remembers. That makes Synek complementary to Claude rather than competitive with it, keeps marginal cost at zero, and makes "your data, your machine, your model" true by construction.

## Personas

**Primary — the history/learning enthusiast.** Researches topics for the love of it (Stoicism, the space race, a war, a movement). Wants the map to feel *inhabited* (VIS) and the moments to open into grounded narrative (S1 stories, S2 citations, S3 perspectives). Their loop: ask Claude → watch the canvas build → wander it → read stories → come back and deepen it. Everything in NOW + NEXT serves this loop.

**Second wave — the analyst mapping an industry.** Maps competitors, model releases, funding events; needs the timeline to *stay current* (LATER.2 Living Timelines / the Watcher persona). Strong willingness-to-pay later, but their core need is agentic upkeep, which the scope guardrail defers. **Discipline:** we note analyst pull when it appears (asks, use-cases) but build nothing Watcher-specific until the enthusiast core passes the gate. The same substrate (canvas, patches, artifacts) serves both — that's what makes the sequencing safe.

**Explicit non-persona (for now):** teams. Single-user, local-first, by design.

## North Star

The 60-second screen-recording: **Claude on the left, Synek on the right; "map Stoicism for me"; the canvas populates live — faces, eras, a story on tap.** Every roadmap item earns its place by serving that recording ([roadmap](roadmap.md) → North Star). NOW is shipped; the recording itself is still owed and is the next milestone.

## The lovable gate

> **Gate:** of ~10 invited outside users who complete setup, **≥3 return in week 2 or later without prompting** (a session they initiated, not a reply to a nudge).

- "Return" means opening their own timeline or building a new one — not clicking a link we sent that day.
- **Measurement is honest-mode:** invited instances are self-hosted and ship with no PostHog key, so telemetry is blank by default. The gate is measured by direct conversation + self-report, optionally upgraded by LATER.3 (opt-in telemetry). Do not silently add tracking to invited builds.
- **What the gate unlocks when it fires:** the Hosting horizon (roadmap) leaves Deferred — accounts, hosted canvas, metered services, Harlan's domain opens.
- **What firing does NOT mean:** dropping local-first. Local stays the free tier / discipline; hosted is the upgrade.
- Prerequisite to even run the experiment: the demo recording (B2) and a setup flow outsiders survive (B1's `bun run setup`).

## Bets

System of record. Columns: validation signal (what moves it to *validated*), kill condition (what moves it to *killed/parked*), instrumentation (how we'd see it).

| ID | Bet | Why we believe it | Validation signal | Kill condition | Status | Instrumentation |
|---|---|---|---|---|---|---|
| **B1** | **The MCP inversion** — no AI in-app; the user's Claude is the brain and Synek is its spatial memory | Zero marginal cost, no key management, complements rather than competes with Claude; already proven mechanically (Claude sources images, writes stories) | Outside users connect their own client via `bun run setup` without hand-holding | Setup friction kills >half the invited cohort before first canvas | **Live** — architecture shipped; outsider-survivability untested | Setup completion vs. drop-off in invite cohort (self-report) |
| **B2** | **"Watch it build" is the wow** — the live side-by-side demo creates instant want | Live SSE canvas + visual warmth shipped; the side-by-side is visceral in a way screenshots aren't | Demo recording published; viewers ask "how do I get this" unprompted | Recording lands flat — views but no asks | **Built, unproven** — recording owed | Asks/shares per channel where it's posted |
| **B3** | **Stories make it a product** — narrative is why people return; without it Synek is a tidy diagram | The pivot thesis (2026-05-25); story reader, casts, covers, narration all shipped | Returning users open/play stories on week-2+ sessions | Returners only look at the map and never tap a story | **Shipped, measuring** | PostHog canvas events (own instance); cohort interviews |
| **B4** | **Artifact grounding is the moat** — register a source once, cite it everywhere, recall it next session; the gap between Synek and "just ask Claude" | Stories without sources are plausible fiction; reuse turns citations into a compounding corpus | Claude re-cites registered artifacts in later sessions (`search_artifacts` hits anchoring new work) | Artifacts get registered once and never re-cited or browsed | **Active build** — S2.1–S2.5, [ADR 0001](../engineering/adr/0001-sources-artifacts-schema.md) | `mcp_tool_called` on `search_artifacts` / `register_artifact`; re-citation rate |
| **B5** | **The verb system drives expansion** — every node offering its obvious next move ("Talk to", "Expand around this") turns viewing into growing | Copy-prompt machinery is shipped and cheap; the canvas already computes its own gaps (`get_layout_report`) | Verb copy-rates show repeated use; expand-family verbs produce patches | Verbs sit uncopied after Tier 1 ships | **Planned** — NEXT.5 Tier 1 | `PromptSpec.analytics` copy events (wired) |
| **B6** | **Persona sequencing** — win enthusiasts first; analysts arrive via the same substrate when Living Timelines unlock | Enthusiast loop needs no agentic infra; analyst value rides on artifacts + patches that B3/B4 build anyway | Gate passes with enthusiasts **and** analyst pull accumulates unbuilt (inbound asks for Watcher use-cases) | Enthusiasts don't return but analyst asks dominate → resequence, analysts first | **Assumption** | Log analyst asks in the decision log; gate result |
| **B7** | **Local-first has a clean hosted upgrade** — every BYO seam (key, DB, bus) is the local shape of a managed service | Schema is Postgres-portable; SSE protocol survives a shared bus; PromptDialog's copy-button becomes a Run-button | NEXT.4 (Postgres/Docker bridge) lands without schema rewrites | A hosted shape requires tearing out a Core decision | **Structural** — standing design rule | ADR review on every seam decision |

**Council cadence:** review on ask ("how are our bets doing?"); any status change lands here + a decision-log line.

## Scope guardrail (unchanged)

Cloud/SaaS, teams, billing, hosted models, proactive agents, integrations, public sharing stay **Deferred** ([roadmap](roadmap.md) → Deferred) until the gate fires. Build hosting-*aware*, not hosting-*first*.

## ACTION PLAN

1. **Finish S2 (B4)** — the active build: ADR 0001 → schema + `register_artifact`/`search_artifacts` + artifact UX (S2.1–S2.5).
2. **Record the 60-second demo (B2)** — NOW is shipped; this is the missing artifact. Includes the owed live in-browser pass.
3. **Run the gate experiment (B1 + gate)** — invite ~10 people who match the primary persona; track setup survival and week-2 unprompted return.
4. **Ship verb Tier 1 (B5)** — the node-panel action row; let copy-rates prioritize Tier 2/3.
5. **Bet Council reviews after each of the above** — update statuses here.
