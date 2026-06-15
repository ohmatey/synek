---
project: "Synek"
track: "Cinematic stories-first home (P1)"
status: "proposed (2026-06-14)"
authors: ["Margot (product)", "Wren (UX — design source of truth)"]
updated: 2026-06-14
issues: ["local-127 (this PRD/build)", "local-125 (Projects container — dependency)", "local-126 (move affordances)"]
links: [../../ux/cinematic-home.md, ../stories-first-pivot.md, ../product-strategy.md, ../roadmap.md, ../../engineering/adr/0003-projects-container.md]
---

# Cinematic Stories-First Home

> **One-line promise:** the creator opens Synek and the first thing they see is their best
> story rendered like a movie poster, with the path to continuing it — and a single click on a
> project chip re-themes the whole page to that world.

**Status:** proposed. Design source of truth is `docs/ux/cinematic-home.md` (Wren); this PRD
resolves Wren's open questions, fixes the slice-1 scope boundary, ties the work to the bets,
and maps it onto issues `local-125/126/127`. Build depends on the Projects container
(`local-125` / ADR 0003) landing first.

---

## 1. Context / Why now

The signed-in home is a file browser: a flat, paginated list of timelines with a search bar
and a public/private filter (`src/routes/index.tsx` → `SignedIn` → `TimelinesSection`). That
served the retired posture — *"Synek is Claude's spatial memory, a private research canvas."*
It does not serve the locked persona.

The stories-first repositioning (founder, 2026-06-14, `stories-first-pivot.md`) inverts the unit
of value from the **timeline** to the **story**, and makes a **Project** the top-level container
that holds many stories, timelines, entities, and resources. The home is where that inversion
becomes visible. A creator who builds serialized, world-anchored stories and publishes them to an
audience should land on a surface that says *"here is your world, here is the next chapter, press
play"* — not a directory listing.

The North Star (`product-strategy.md`): *a creator opens a Project, reads the latest chapter of
their serialized world, writes the next one, and publishes it.* The home is the front of that
loop. Everything cinematic exists to pull the creator (who is also the first viewer of their own
work) toward **continue** and **publish**.

This is **P1 / NOW** (`roadmap.md`), the third of three issues that constitute the Projects slice:
`local-125` (the container), `local-126` (move affordances), and `local-127` (this home). It is the
strongest single home-surface investment in bet **B3** (stories are the product) and the launchpad
for bet **B6** (the publish/share loop drives acquisition).

---

## 2. Goals & Non-goals

**Goals**

- **G1 — Story is the hero.** The home leads with one featured story rendered cinematically
  (full-bleed cover, scrim, title/hook/cast, Play). Not a card in a grid — a poster.
- **G2 — The next action is inevitable.** From the hero and the rows, "Play" and "Continue
  writing" are the loudest affordances; the path to the next chapter is one click.
- **G3 — Project is the page-level filter.** A slim project rail re-scopes the entire page
  (hero + every row) to one project, URL-backed (`?project=<slug>`), deep-linkable, back-safe.
- **G4 — Browse by row, not by page.** Stories and timelines live in horizontal scroll
  carousels, reusing the public story-card visual language, so the home reads as a reel of a
  living world rather than a paginated index.
- **G5 — Organize without leaving home.** A creator can move a timeline (and its stories/
  entities) between projects from a card overflow menu, with an undo toast (the `local-126`
  affordance, surfaced here).
- **G6 — Day-one grace.** A brand-new creator (one backfilled "My first project", no stories)
  lands on a directive empty state, not a wall of empty categories.

**Non-goals (slice 1) — explicit cuts**

- **In-app story generation from the home.** Stories are authored by the user's MCP client or
  the optional key-gated in-app agent via `write_story`. The home navigates to those surfaces;
  it does not add a new generation entry point.
- **The "Continue" row, the "Cast & entities" row, hero rotation arrows, and bulk move.** All
  **fast-follow within P1** (§10) — they need either a freshness signal, a new cross-timeline
  entity query, or multi-select chrome that slice 1 doesn't ship. The hero's per-item
  *secondary* "Continue" CTA still ships (§5); the *row* does not.
- **A `/projects/$slug` route.** The home *is* the project view, filtered by the rail (ADR 0003
  D11; Wren §11). No new route in slice 1.
- **Project-level sharing / public project page.** Sharing stays per-timeline (`timeline.isPublic`
  + `/s/$slug`), untouched (ADR 0003 D11).
- **SSE / live updates on the home.** Polling is acceptable for slice 1 (§6, open to Kael); the
  canvas keeps SSE, the home does not need it to ship.
- **Cross-timeline shared entities.** Deferred at the data layer (ADR 0003). An entity belongs to
  its timeline; moving the timeline moves the entity.

---

## 3. Personas / JTBD

**Primary — the digital-story creator / serial worldbuilder** (`product-strategy.md`). Builds a
living, nonfiction-first world and publishes it serially to a digital audience. On the home, their
jobs:

1. **Re-enter the world fast.** "Show me where I am — the world I'm actively building — so I can
   pick up the next chapter without hunting." → the hero + the leading story row.
2. **Survey what they've made.** "Let me see my stories and timelines at a glance, grouped by the
   project I'm in." → the carousels + the project rail.
3. **Keep the world organized as it grows.** "I started a second project; let me move this timeline
   into it." → move-to-project (`local-126`).
4. **Get to publishing.** "This story's ready — share it." → the hero/card Share action into the
   existing `ShareStoryButton` flow.

What "return" looks like for this persona (strategy doc): they come back to write the *next*
chapter, not to revisit what they built. The home must make "continue" louder than "browse."

**Adjacent — the Realscript marketer.** Lands here via brand-themed projects (P2, future). The
hero's project-theme inheritance is the seam that will make their branded world feel coherent;
slice 1 just reserves it (theme inheritance, §6). Not a slice-1 target, but the design must not
preclude it.

**Note — the history enthusiast / private researcher.** Still a valid user; the home doesn't add
friction for them, but it is not designed around private-research-with-no-audience. A researcher
who publishes is inside the primary persona.

---

## 4. User stories & acceptance criteria

Acceptance criteria are the slice-1 (must-ship) contract. Fast-follow items are called out in §10
and are **not** acceptance criteria for this issue.

- **US1 — Cinematic hero.** The home renders a full-bleed hero (`56–70vh` desktop, `50vh` mobile)
  for the featured story: cover image with bottom scrim, eyebrow (`PROJECT · TIMELINE`), title,
  one-line hook, up to 4 cast chips (`+N more`), beat-count + est. read time, and a primary
  **Play** CTA. No cover → branded `--color-accent-story` (amber) wash, not a placeholder image.
  *Accept:* with a featured story present, the hero shows title + hook + Play; Play opens the
  in-app reader at `/timelines/$id?story=$storyId`.
- **US2 — Featured selection rule.** The featured story is the **most-recently-updated story with a
  cover image** in the active project scope; if none has a cover, the most-recently-updated story
  overall (branded wash). No auto-rotation in slice 1.
  *Accept:* the deterministic rule above picks the hero; switching the project re-picks within
  scope.
- **US3 — Project rail filters the page.** A slim full-width rail between `AppHeader` and the hero
  shows an **All** chip (when `projects.length > 1`) + one chip per project + a **New project**
  link. Selecting a chip sets `?project=<slug>` and narrows the hero **and every row** to that
  project; **All** (or absent param) restores the cross-project view. Selection does **not**
  navigate away from `/`.
  *Accept:* clicking a chip updates `?project=`; hero + rows re-scope; reload + back button
  preserve the selection; an invalid/foreign slug silently falls back to All (not a 404).
- **US4 — "Your stories" row.** A horizontal scroll carousel of all stories in scope, sorted
  `updatedAt` desc. Each story card: 16:9 cover (or story-soft tint), title (2-line clamp), hook
  (1-line clamp), `● N beats · ~X min`, a Play button, and a `[···]` overflow menu.
  *Accept:* every story in scope appears as a card; clicking the card body / Play opens the reader;
  the row scrolls horizontally (CSS scroll-snap) with desktop arrow buttons hidden on touch.
- **US5 — "Timelines" row.** The existing `TimelinesSection` card, adapted into a horizontal
  carousel and project-scoped. Clicking a card navigates to `/timelines/$id`.
  *Accept:* timelines in scope render as cards in a scroll row; click opens the canvas; the row
  respects the project filter.
- **US6 — Move to project.** Each story card and timeline card `[···]` menu contains "Move to
  project…" (shown only when `projects.length > 1`), opening a project picker. Selecting a target
  reassigns the item optimistically and shows an **undo** toast. For a timeline, its stories and
  entities move with it; the toast names the timeline and entity count. (Backed by `local-126`'s
  `moveTimelineToProject` RPC.)
  *Accept:* with 2+ projects, "Move to project…" reassigns a timeline; the home re-scopes; the
  undo toast reverses it; with one project the action is hidden.
- **US7 — New-creator empty state.** A creator with the backfilled default project and no
  stories/timelines sees a reduced-height (`40vh`) branded hero — *"Your world starts here. Build a
  timeline, write a story, and publish it to the world."* — with **New timeline** and (if no API
  key exists) **Connect MCP** CTAs. No carousel rows render.
  *Accept:* zero-content owner sees the directive empty state with both CTAs; no empty row
  skeletons; "Connect MCP" only when no key exists (absorbs the current `ConnectCta`).
- **US8 — Has-timelines-no-stories state.** When the scope has timelines but no stories, the hero
  shows a status line (`N timelines · 0 stories`) over the branded wash with *"Write your first
  story — open a timeline and let your AI tell it,"* CTA "Open [timeline]." The "Timelines" row
  still renders.
  *Accept:* the state renders without looking broken; the next step (open a timeline) is the
  obvious CTA.
- **US9 — Empty project state.** Selecting a freshly created, empty project narrows the whole home
  to *"'[Project]' is empty. Add a timeline to get started"* + a "New timeline in this project"
  CTA that passes `projectId` to `createTimeline` (ADR 0003 D7 write path).
  *Accept:* an empty project shows the directive narrow state; the CTA creates a timeline scoped to
  that project.
- **US10 — New project.** The rail's "New project" link opens a `NewProjectDialog` (mirrors
  `NewTimelineDialog`): name → create (and optionally copy a build prompt). On create, the rail
  shows the new chip and the home filters to it.
  *Accept:* creating a project adds its chip, selects it, and shows the empty-project state.
- **US11 — Responsive.** Mobile (`<640px`): rail is horizontally scrollable (All chip pinned
  first); hero `50vh`, Play full-width; cards `calc(100vw − 32px)` showing a sliver of the next
  (reels feel); arrow buttons hidden. Desktop: hero `56–70vh`; 3–4 story cards visible with a
  partial 5th.
  *Accept:* the home is usable and on-spec at mobile, tablet, and desktop breakpoints per Wren §8.
- **US12 — Accessibility & motion.** The rail is a labeled control group; chips are
  toggle/selected controls with visible focus; carousels are keyboard-scrollable and arrow buttons
  are real `<button>`s with labels; all motion (hero fade/slide, chip fill, card hover, toast)
  respects the global `prefers-reduced-motion` reset (Wren §9).
  *Accept:* keyboard navigation reaches the rail, hero CTAs, and every card; reduced-motion
  collapses transitions to instant; no information conveyed by motion alone.

---

## 5. Resolved open questions (decisions)

Wren raised six PRD-facing questions (`cinematic-home.md §12`). The three the task names are
resolved as **explicit decisions** below; the other three are also resolved so the PRD is
self-contained. Build-level questions (§13 in the design doc) are left to Kael (§6).

### DECISION 1 — "Continue" row freshness rule (Wren Q2)

**The "Continue" row is deferred to fast-follow; when it ships, the freshness signal is
`updatedAt` within a rolling 21-day window, newest first — NOT a fixed 14-day window and NOT
"last N opened."**

Reasoning:
- The persona writes serially. A 14-day window drops a creator who publishes one chapter every
  two-to-three weeks — exactly the cadence the serialized-stories roadmap (P3) assumes. 21 days
  covers a fortnightly+ rhythm with slack, without letting the row fill with months-old work.
- "Last N opened" requires a new `lastOpenedAt` write on every story open — net-new tracking and a
  schema/event seam slice 1 doesn't have. `updatedAt` already exists on every story
  (`write_story`/`apply_patch` bump it) and needs zero new instrumentation. A time window over an
  existing column is the cheapest honest signal.
- "Updated" (the world was *changed*) is a better proxy for "in progress" than "opened" (merely
  *looked at*) for a creator persona — they return to write, not to re-read.
- This is a fast-follow specifically because it's a trivial implementation once the row design is
  final (`updatedAt >= now − 21d`, reuse the story card). It does **not** gate slice 1.

### DECISION 2 — Hero secondary CTA copy (Wren Q1)

**The hero shows two secondary actions: "Continue writing" (pen icon) and "Share." The secondary
creation CTA copy is "Continue writing" — not "Edit," not bare "Continue."**

Reasoning:
- "Continue" alone is ambiguous between *continue reading* (which is what **Play** already does)
  and *continue building*. The persona's job here is authoring, so the verb must name authoring.
- "Edit" is the wrong register — it implies fixing a finished thing, not growing a living world.
  The persona's mental model is *the world continues*, so "Continue writing" matches their word.
- "Continue writing" opens the **creator flow** (`/timelines/$id?view=stories` with the story
  pre-selected), distinct from **Play** which opens the **reader flow** at
  `/timelines/$id?story=$storyId`. Two verbs, two flows, no overlap with Play.
- "Share" opens the existing per-story share flow (`ShareStoryButton` / `ShareDialog`), surfacing
  bet B6's publish loop from the home. It shows only when the story's timeline is the owner's.
- Copy is final for slice 1; revisit only if creator interviews surface confusion (tracked as a
  qualitative check, not a blocker).

### DECISION 3 — "Continue writing" secondary-CTA visibility rule (Wren Q4)

**Show "Continue writing" in the hero whenever the viewer is the owner (always, for owned
stories). Drop the `beatCount < 5` "feels unfinished" heuristic.**

Reasoning:
- A serialized world is *never* finished by definition — the persona always intends a next
  chapter. Gating the authoring CTA on a beat-count threshold tells a creator with a rich 6-beat
  story "you can't continue this," which contradicts the entire serialized premise.
- Beat count is a poor proxy for "in progress": a deliberately short published reel and an
  abandoned stub both have few beats; a thriving serialized story has many. The signal doesn't
  separate the cases it claims to.
- The honest gate is **ownership**, not length: a viewer can always **Play**; only the owner can
  **Continue writing**. That is the rule. (Slice-1 home is owner-only anyway — the signed-in
  dashboard — so in practice the CTA is always present; the ownership gate is the durable rule for
  when shared/embedded views arrive.)

### DECISION 4 — "Continue" vs "Your stories" redundancy for small catalogs (Wren Q5)

**When the "Continue" row ships (fast-follow), suppress it whenever `storyCount <= 4`. Below that,
"Your stories" is the only stories row.**

Reasoning:
- "Continue" (recent-21-day) and "Your stories" (all, `updatedAt` desc) are sorted on the same key
  and will show identical leading cards. With a small catalog the two rows are nearly the same
  cards stacked twice — visual debt, no navigational gain.
- The threshold is `<= 4` (not `<= 3`) to match the desktop row's "3–4 cards visible" target
  (Wren §8): below the point where a single row scrolls, a second row of the same items is pure
  duplication. At 5+ stories, "Your stories" begins to scroll and "Continue" earns its place by
  surfacing the actively-worked subset above the full catalog.
- Slice 1 ships only "Your stories," so this rule has no slice-1 effect; it's the fast-follow
  contract so the "Continue" row lands without re-litigating redundancy.

### DECISION 5 — Entity-row scope (Wren Q6)

**When the "Cast & entities" row ships (fast-follow), include `person | org | place` only. Exclude
`concept` and `work` in slice 1's first cut.**

Reasoning: `person/org/place` are the visual, chip-able inhabitants of a world (avatar slot, type
badge). `concept` is abstract and reads poorly as a chip; `work` is borderline. Start with the
three that earn a visual chip; widen only if creators ask. This row is fast-follow regardless (it
needs the cross-timeline `listEntities` query, §6), so the decision is the contract, not a slice-1
deliverable.

### DECISION 6 — Hero rotation arrows (Wren Q3)

**No hero prev/next arrows in slice 1; deferred to fast-follow, gated on a creator having 5+
stories with covers.** The single deterministic featured pick (US2) is correct for the small
catalogs slice 1 targets; the "Your stories" row is the manual browse path. The `CinematicHero`
component should reserve no permanent layout space for arrows (avoid chrome for an unbuilt
feature), but its props shape should allow an optional `onPrev/onNext` later without a rewrite —
a build note for Kael, not a slice-1 requirement.

---

## 6. Architecture / implementation notes

Design detail and the full component reuse map live in `cinematic-home.md` §10. Highlights and the
product-side contracts:

- **Dependency:** this builds on `local-125` (Projects container, ADR 0003). It needs `projects`,
  `timelines.projectId`, `listProjects`, `createProject`, and the `?project` filter on
  `listTimelines`. Do not start the home build before the container migration (`0020`) and its
  server fns land.
- **Net-new components (Wren §10):** `ProjectRail`, `CinematicHero`, `HomeContentRow`, `StoryCard`,
  `NewProjectDialog`, `MoveToProjectPopover`. Reused/extended: `AppHeader` (unchanged),
  `ConnectCta` (absorbed into the hero empty state), `RowMenu` (+ "Move to project…"),
  `NewTimelineDialog` (+ optional `projectId`), `SignedIn` (rewritten to rail + hero + rows),
  the public reader's cast chips / cover treatment, shadcn `Button` / `DropdownMenu` / `Badge`.
- **No new design tokens** (Wren §10) — every color maps to an existing token; the amber hero
  fallback is the existing `--color-accent-story`.
- **Move RPC (`local-126`):** `moveTimelineToProject(timelineId, targetProjectId, ownerId)` —
  a direct owner-scoped CRUD update of `timelines.projectId`, **not** a Patch (ADR 0003 D9).
  Stories inherit via their timeline (no separate story-move at the data layer). Lives in
  `src/lib/server/projects.ts` per the ADR checklist.
- **`?project` validation:** soft fallback to "All" on an unknown/foreign slug (never a 404).
  Recommend `validateSearch` + a data-layer existence/ownership check (Wren Q-Kael 3). Product
  contract: an invalid project param must degrade silently, not error.
- **Theme inheritance in the hero:** the hero should reflect the project's theme when set
  (`projects.theme`, ADR 0003 D5). Resolve `timeline.theme ?? project.theme ?? defaults` at read
  time. Slice 1 leaves `projects.theme` null for all projects, so this is a no-op now but must be
  wired so P2 (Realscript brand) is additive.
- **Freshness (slice 1):** polling via TanStack Query `refetchInterval` (~30s) is sufficient; SSE
  on the home is out of scope (§2). Left to Kael per `cinematic-home.md §13.5`.

Genuinely build-level questions (home query structure for entities, RPC file placement, SSE
vs. polling) are Kael's, enumerated in `cinematic-home.md §13`. This PRD does not pre-empt them.

---

## 7. Slice-1 scope boundary (must-ship vs. fast-follow)

Mirrors Wren's §14 boundary exactly so design and product agree on the line.

**Must-ship (slice 1 / `local-127`):**

- Project rail (chips + "All" + "New project")
- Cinematic hero with featured story (cover/wash + eyebrow + title + hook + cast + Play +
  "Continue writing" + "Share")
- Hero empty states (new creator · has-timelines-no-stories · empty project)
- "Your stories" row (the leading creator-facing carousel)
- "Timelines" row (the adapted `TimelinesSection` carousel)
- `?project=` URL param filtering hero + all rows, deep-linkable, soft-fallback on bad slug
- Move-to-project on story and timeline cards (single item; backed by `local-126`)
- Responsive (mobile reels / tablet / desktop) + a11y + reduced-motion

**Fast-follow (P1.x, before P2):**

- "Continue" row (DECISION 1 + DECISION 4 — 21-day window, suppressed at `storyCount <= 4`)
- "Cast & entities" row (DECISION 5 — `person/org/place`; needs cross-timeline `listEntities`)
- Hero rotation arrows (DECISION 6 — at 5+ covered stories)
- Bulk move (multi-select in the toolbar)
- `AppHeader` project breadcrumb in the canvas chrome (Wren §11)

---

## 8. Success metrics

Tied to the bets (`product-strategy.md`). Rides existing PostHog seams plus a small set of new
home events.

**B3 — Stories are the product (primary):**
- **New event `home_hero_play_clicked { project_id, story_id }`** and **`home_story_card_clicked
  { project_id, story_id }`** — the home becomes a measurable on-ramp into the reader. Target:
  ≥50% of returning home sessions reach a story (hero or card) before opening a bare timeline.
- Plays/completions continue on the reader's existing `story_started` / `story_completed`. Read
  alongside the stories-view denominator (`story_view_opened`).

**B6 — The publish/share loop drives acquisition (launchpad):**
- **New event `home_share_clicked { project_id, story_id, source: 'hero' | 'card' }`** — the home
  is a new entry point into the share flow; this distinguishes home-initiated shares from
  in-canvas shares. Read against `/s/$slug` traffic and signup source.

**Project-as-filter adoption (this surface's own signal):**
- **New event `home_project_filter_selected { project_id }`** — does the rail get used once a
  creator has 2+ projects? Low usage with high multi-project counts signals the filter is
  invisible (enrich the rail), not that projects are unwanted.
- **New event `home_move_to_project { from_project_id, to_project_id }`** — the organize gesture
  (`local-126`) actually used from the home.

**Engagement guardrail:** "Continue writing" clicks vs. "Play" clicks from the hero — if "Play"
dominates by an order of magnitude even for owners, the authoring path is mis-weighted and the
secondary CTA needs more prominence (a copy/placement revisit, not a revert).

*Recommended fast-follow events (not slice-1 acceptance):* `home_new_project_created`,
`home_continue_row_card_clicked`, `home_entity_chip_clicked`.

---

## 9. Bets note

Advances **B3** (primary — the home makes the story the literal first thing a creator sees, not a
list of timelines) and is the launchpad for **B6** (secondary — Share surfaces in the hero and on
cards, feeding the publish/share acquisition loop). It is the home-surface expression of the locked
stories-first repositioning.

Side-bet recorded for the Bet Council: **"cinematic-home-leads-to-continue > file-browser-home."**
Kill signal: returning creators land on the cinematic home but still navigate primarily to bare
timelines (low `home_hero_play_clicked` + low `home_story_card_clicked`, high direct timeline
opens) — in which case the response is to enrich the hero/story signal (covers, better featured
selection, the "Continue" row), **not** to revert to the file-browser home.

The home also indirectly sets up **B6**'s measurement: it is the first place a creator can both
*read* their published story and *re-share* it, so it instruments the share entry point the public
`/s/$slug` page can't see.

---

## 10. Risks / open questions

- **Hero needs a cover to feel cinematic; covers are optional.** A creator with no covers gets the
  branded amber wash for every state, which is intentionally tasteful but flattens the "movie
  poster" promise. *Mitigation:* the featured-selection rule (US2) biases toward covered stories;
  the seed data and onboarding should encourage a cover on the first story. Not a blocker — the
  wash is a designed fallback, not a broken state. *Risk owner:* watch `home_hero_play_clicked` by
  has-cover vs. no-cover; if no-cover heroes convert far worse, prioritize a cover-prompt nudge.
- **Dependency latency on `local-125`.** The home cannot ship until the Projects container and its
  server fns land. *Mitigation:* build the home against the project RPCs as soon as the migration
  is green; the rail can render a single default-project chip on day one (matches the backfill).
- **Two read paths for the project filter must stay consistent.** The home query and the MCP
  `list_timelines` both gain an "if project, filter; else all" branch (ADR 0003 negative
  consequence). *Mitigation:* one shared filter helper; `verify:projects` already asserts the
  filter behavior.
- **Move-to-project transitivity may surprise.** Moving a timeline silently moves its stories and
  entities. *Mitigation:* the undo toast names the entity count ("Timeline 'X' (and N entities)
  moved to Y") and is reversible (Wren §6). Revisit if creators report confusion; it's the correct
  model given cross-timeline shared entities are deferred (ADR 0003).
- **Build-level questions are Kael's** (`cinematic-home.md §13`): home query structure for the
  entity row, `moveTimelineToProject` file placement, `?project` validation location, hero theme
  inheritance via `resolveTimelineTheme`, and polling-vs-SSE. This PRD takes product positions
  where they affect UX (soft fallback on bad slug; polling acceptable; theme inheritance must be
  wired even if no-op) and otherwise defers to Kael's review.

---

## 11. Fast-follows

"Continue" row (21-day, suppressed `<= 4`) · "Cast & entities" row (`person/org/place`) · hero
rotation arrows (5+ covered stories) · bulk move · `AppHeader` project breadcrumb in the canvas ·
home-initiated story share analytics depth · cover-prompt nudge for cover-less heroes.

P2 dependency seam: the hero's `project.theme` inheritance is the hook the Realscript brand
integration (P2) lands on — slice 1 wires it inert so P2 is additive.
