---
title: Cinematic Stories-First Home — UX Design Proposal
owner: Wren (design) → Margot (PRD #local-127) → Kael (build)
status: PROPOSAL — awaiting founder/Margot/Kael review
date: 2026-06-14
linked-issues: local-125 (Projects container), local-126 (Move affordances), local-127 (Margot PRD)
linked-adr: docs/engineering/adr/0003-projects-container.md
---

# Cinematic Stories-First Home

> Stories are the product. The home should feel like walking into a world, not a file browser.

---

## 1. Design Intent

The old home was a file browser with a search bar. A list of timelines, paginated, filtered by public/private. That served the "private research canvas" posture. It doesn't serve a creator who builds serialized stories and publishes them to an audience.

The new home has one job: **make the creator's best story the first thing they see, and make the path to continuing it feel inevitable.** Everything else — timelines, entities, resources — is the supporting cast, visible but subordinate.

The Netflix parallel is useful but not exact. Netflix optimizes for passive consumption. Synek's home must also be a creation surface — the creator is also the primary viewer of their own work, and the actions "continue this story" and "open this timeline" live side-by-side with "play."

The design anchor: **cinematic gravity at the top, practical navigation below.**

---

## 2. Layout — Overall Page Structure

The home route (`src/routes/index.tsx` → `SignedIn`) becomes a two-zone layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  AppHeader  (unchanged — auth, nav, settings)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PROJECT RAIL  (horizontal chips — "All" + each project name)  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░  HERO — featured story (full-bleed, 56–70vh)             ░  │
│  ░  [ cover image ]  [ title · hook · cast chips · Play ]   ░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                                                 │
│  ROW: "Continue" (stories in progress — most recent first)     │
│  ──────────────────────────────────────────────────────────    │
│  [card] [card] [card] [card] >                                 │
│                                                                 │
│  ROW: "Your stories"                                           │
│  ──────────────────────────────────────────────────────────    │
│  [card] [card] [card] [card] >                                 │
│                                                                 │
│  ROW: "Timelines"                                              │
│  ──────────────────────────────────────────────────────────    │
│  [card] [card] [card] >                                        │
│                                                                 │
│  ROW: "Cast & entities"                                        │
│  ──────────────────────────────────────────────────────────    │
│  [chip] [chip] [chip] [chip] >                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Each zone is described in detail below.

---

## 3. Project Rail — The Page-Level Filter

### Placement

A **slim horizontal rail** (40px tall) pinned **between the AppHeader and the hero**, full-width. Not a sidebar — a sidebar adds permanent chrome and makes the empty-project state awkward. A horizontal rail collapses gracefully to a single chip ("My first project") and grows naturally as projects accumulate.

```
All  ·  My First Project  ·  Roman Republic  ·  + New project
```

### Anatomy

- **"All" chip** — default selected state; shows every story/timeline/entity across all projects. This is the day-one experience before the user creates a second project — the rail reads as a single branded identity, not a navigation burden.
- **Per-project chips** — each renders the project `title` (truncated at ~20 chars with a tooltip for the full name). Selection is a single click. No expand/collapse, no accordion.
- **"+ New project" button** — text link, not a chip, at the far right. Opens a `NewProjectDialog` (mirrors `NewTimelineDialog` in shape — two steps: name → copy a build prompt / or open empty).
- **Active chip** — filled background using `--color-accent-primary` at 15% opacity with a `--color-accent-primary` border (matches the `segmentSurface` treatment already in `TimelinesSection`). Text goes `--color-accent-primary`. This is the only accent touch on the rail — everything else stays at `--color-bg-surface` / `--color-fg-secondary`.
- **Rail background** — `--color-bg-base`, no border top/bottom; the hero's cover image bleeds underneath it visually, so the rail must be `z-index` elevated with a translucent backdrop (`backdrop-blur-sm bg-background/80`) so it reads as chrome not content. Follows the `psr-head` header approach in `PublicStoryReader`.

### Interaction model

Selecting a project:
1. Narrows the **hero** to that project's most-recently-updated story with a cover image (falls back to most recent story if none has a cover).
2. Narrows **all rows** to show only items belonging to that project.
3. **Does not navigate** — the URL gains a `?project=<slug>` search param (uses TanStack Router's `validateSearch` + `useSearch`, the pattern already in `timelines.$id.tsx`). Deep-linkable and back-button-safe.
4. The rail chip updates to "active" state instantly (optimistic — no loading state on the chip itself).

"All" restores the full cross-project view. `?project` param absent = "All."

### Empty state — one project (day one)

When a creator has only "My first project" (the migration-backfilled default from ADR 0003):

- The rail shows only: `My first project  ·  + New project`
- No "All" chip — it's implied when there's one project. One chip is still a chip — it sits selected and branded, hinting at the feature without making an empty category obvious.
- This avoids the "why am I looking at navigation for one thing" confusion that sidebars and tab bars create when they have a single item.

When the user creates a second project, "All" appears automatically (React-rendered; no special-case logic beyond `projects.length > 1`).

---

## 4. Hero — Featured Story

### Intent

The story cover should feel like a movie poster, not a card. Large, immersive, cinematic. The cover image bleeds full-width; the title/hook float over a gradient scrim at the bottom. The "Play" button is unavoidable.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   [cover image — object-fit: cover, full width, 56–70vh]       │
│                                                                 │
│                                                                 │
│                                                                 │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│ ░  gradient scrim (bottom 50% of the hero)                  ░  │
│ ░                                                           ░  │
│ ░   [EYEBROW — project name · timeline name]                ░  │
│ ░   [TITLE — story.title, large]                            ░  │
│ ░   [HOOK — story.hook, one line clamped]                   ░  │
│ ░   [cast chips — story.cast names, max 4 visible]          ░  │
│ ░                                                           ░  │
│ ░   [▶ Play]  [↗ Share]  [• Continue / Edit]               ░  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────────────────────────────────┘
```

### Visual treatment

- **Cover image**: the story's `coverImage.url`. `object-fit: cover`, anchored `object-position: center top` (biased top for portrait images — faces stay visible). When no cover image exists, the hero area renders a subtle gradient using `--color-accent-story` (amber, the brand's story accent) over `--color-bg-base` — same amber used for the story accent across the design system. Not a placeholder image; a branded tone.
- **Scrim**: `linear-gradient(to top, rgba(8,9,12,0.92) 0%, rgba(8,9,12,0.60) 40%, transparent 75%)` in dark mode. Light mode: `rgba(250,251,252,0.88)` to `transparent`. The gradient is the same depth-of-field trick the `psr-cover` panel uses; reuse the exact approach.
- **Height**: `56vh` minimum, `70vh` maximum (clamped with `min-height: 56vh; max-height: 70vh`). On mobile, reduce to `50vh`.
- **Eyebrow**: `12px`, `--color-fg-muted`, uppercase tracking. Format: "PROJECT · TIMELINE" using `·` separator (mirrors `psr-sep` in `PublicStoryReader`).
- **Title**: `32px` (desktop) / `24px` (mobile), `font-weight: 600`, white in dark mode / near-black in light mode. Clamp to 2 lines. Uses `var(--font-display, inherit)` — if the story's project has a theme font, the hero title inherits it (same rule as `.story-title` in `styles.css`).
- **Hook**: `15px`, `--color-fg-secondary`, 1 line clamped.
- **Cast chips**: small `psr-cast-chip`-style pills (reuse from `PublicStoryReader`). Max 4 visible; "+N more" if there are additional cast members.
- **Estimated read time + beat count**: `--color-fg-muted`, `12px`, single line below cast.
- **Primary CTA**: "Play story" — the `psr-play` button style (already in the public reader), adapted for in-app navigation: clicking opens the story in the in-app `StoryReader` rather than the public page (navigate to `/timelines/$id?story=$storyId`). Same visual weight as the public CTA for recognition consistency.
- **Secondary actions**: "Share" (opens `ShareDialog`, existing) and "Continue" (opens `timelines/$id?view=stories` with the story pre-selected — the creator flow, not the reader flow). "Continue" only shows if the creator is the owner and the story has fewer than 5 beats (a "feels unfinished" heuristic — open question for Margot).

### Hero rotation / featured selection

The featured story is the **most recently updated story with a cover image** in the current project filter scope. If no story has a cover image, the featured story is the most recently updated story overall (no cover image → branded tone background).

No auto-rotation (the Netflix carousel autoplay). Rotation adds implementation complexity and the creator has few enough stories that manual navigation via the rows below is the right pattern. Open question: add previous/next hero arrows? Recommendation: no — defer until the creator has 5+ stories (a future consideration, not a slice-1 feature).

---

## 5. Content Rows — The Carousels

Four rows beneath the hero, in this order:

### Row taxonomy and rationale

| # | Row label | Contents | Rationale |
|---|---|---|---|
| 1 | "Continue" | Stories with `beatCount >= 1` and `updatedAt` within the last 14 days, newest first | The creator's primary next action — pick up where they left off |
| 2 | "Your stories" | All stories, sorted `updatedAt` descending | Full story catalog; same data as the lens view inside the canvas |
| 3 | "Timelines" | All timelines in the current project scope | The world-building surfaces; creation path |
| 4 | "Cast & entities" | Entity nodes (type='person'|'org'|'place') across all timelines in scope | The inhabitants of the world; creation + navigation anchor |

Notes:
- Row 1 ("Continue") is hidden if no story was updated in the past 14 days. The "Your stories" row then takes the primary slot.
- Row 4 ("Cast & entities") is shown only when at least one timeline has entity nodes. Empty = hidden. Empty state is handled per-row with a ghost chip "+Add your first entity" — not a full empty state (the full empty state is reserved for the entire page, described in §7).
- A ">" "See all" link at the row tail navigates to the project-filtered canvas view for that content type (e.g., `?view=stories&project=roman-republic`).

### Card anatomy

**Story card** (rows 1 and 2):
```
┌──────────────────────┐
│  [cover image]       │  ← 16:9, rounded-xl, object-fit: cover
│                      │     no image → story-soft tint
├──────────────────────┤
│  Story title         │  ← font-medium, 2-line clamp
│  Hook text           │  ← text-xs, muted, 1-line clamp
│  ● N beats  ~X min   │  ← text-xs, muted
│  [▶ Play]  [···]     │  ← Play button + overflow menu
└──────────────────────┘
```

The overflow menu (`[···]`) on a story card contains:
- Open canvas
- Share
- Move to project... (see §6 — move affordances)
- Delete (danger, requires confirmation)

**Timeline card** (row 3):
Reuses the existing `TimelinesSection` card shape (`rounded-xl border border-border/60 bg-card bg-gradient-to-b from-foreground/[0.04]`). Adds a "Move to project..." option in the existing `RowMenu`. The card is functionally identical — clicking navigates to `/timelines/$id`.

**Entity chip** (row 4):
Smaller than a card — a horizontal pill with the entity name, its type badge (person/org/place/work), and a small avatar slot (entity image if one exists in node metadata). Clicking navigates to the timeline that contains the entity and opens its `NodeDetailPanel`. These are NOT cards — they're chips that overflow horizontally. The row scrolls, not wraps.

### Carousel mechanics

Each row is a **horizontal scroll container** (`overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch`). No JS-driven carousel — pure CSS scroll snap. Cards are `scroll-snap-align: start`.

Card widths:
- Story cards: `min-width: 240px; max-width: 320px` (responsive: `calc(100vw - 48px)` on mobile so first card reads as "this will scroll").
- Timeline cards: same as story cards.
- Entity chips: `min-width: 140px` fixed.

Arrow buttons (desktop only, hidden on touch): `ChevronLeft` / `ChevronRight` ghosted at the row edges. Clicking scrolls by one card width. Implemented with `scrollBy({ behavior: 'smooth' })`. Hidden via CSS `@media (hover: none)` (the existing `prefers-reduced-motion` global in `styles.css` collapses `scroll-behavior` to `auto` already — no additional hook needed).

Reduced motion: smooth scrolling degrades to instant via the existing global `styles.css` rule (`scroll-behavior: auto !important` under `prefers-reduced-motion: reduce`). Arrow chevrons remain functional; they just don't animate.

---

## 6. Move-to-Project Affordance (issue local-126)

### Design goal

A creator with 2+ projects needs to reassign items without going into the canvas and hunting through settings. The affordance must be discoverable but must not make the home feel cluttered with meta-navigation.

### Where it lives

**On card overflow menus** — not on the card face. The three-dot `[···]` menu on each story card, timeline card, and entity chip contains a "Move to project..." action at the bottom of the list, above "Delete."

This is the right placement because:
- Move is a rare operation (done once per item, not repeatedly).
- Putting it in an overflow menu keeps the card face clean — the primary action (Play/Open) stays uncluttered.
- The overflow menu is already present in the timeline card's `RowMenu.tsx` (`onRename`, `onDelete`) — this extends an existing pattern rather than inventing new chrome.

### Single-item move flow

```
[···] → "Move to project..."
           ↓
  [popover/dialog — list of the user's other projects]
     ○ My First Project  (current — dimmed)
     ● Roman Republic
     ● British Empire
     [+ New project]
           ↓
  Select project → instant reassignment (optimistic)
  Toast: "'The Fall of the Republic' moved to Roman Republic"
         [Undo]
```

The confirmation is the **undo toast, not a pre-confirmation dialog**. The move is cheap and reversible; a confirm dialog would add friction to an already-rare action. The "Undo" link in the toast is the escape hatch — it fires the reverse assignment.

Implementation note for Kael: the move operation is a PATCH to `timelines.projectId` (or, for stories, transitively via their timeline). It's not a Patch-engine operation (ADR 0003 D9 confirms project CRUD is metadata). A single server RPC `moveTimelineToProject(timelineId, targetProjectId, ownerId)` covers the timeline case; stories inherit via their timeline, so there's no separate story-move operation at the data layer.

### Bulk move

On desktop, the TimelinesSection toolbar currently has no multi-select. Bulk move is **deferred to a follow-up** — slice 1 should ship single-item move via the card overflow. The design seam for bulk is: add a "Select" toggle to the toolbar that puts cards into a checkbox selection mode, then surfaces a "Move selected to..." batch action. Flagged as a fast-follow, not a blocker.

### Entity move

An entity node belongs to a timeline, which belongs to a project. You can't move an entity independently — you move its timeline, and the entity moves with it. The "Move to project..." action on an entity chip moves the **entity's parent timeline**. The toast says: "Timeline '[timeline name]' (and N entities) moved to [project]." This is the correct model given ADR 0003's "cross-timeline shared entities are deferred" decision — there's no entity-level project assignment in slice 1.

---

## 7. Empty States

### New creator — no timelines, no stories (day one)

```
┌─────────────────────────────────────────────────────────────────┐
│  [PROJECT RAIL: "My first project  · + New project"]           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│          ┌──────────────────────────────────────┐              │
│          │                                      │              │
│          │   [branded tone — accent-story wash] │              │
│          │                                      │              │
│          │    Your world starts here.           │              │
│          │    Build a timeline, write a story,  │              │
│          │    and publish it to the world.      │              │
│          │                                      │              │
│          │    [+ New timeline]  [Connect MCP]   │              │
│          └──────────────────────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- The hero zone renders at reduced height (`40vh`) with the branded amber wash (same fallback as a story without a cover image, but intentionally cropped so the full height isn't wasted).
- The CTA is "New timeline" (the primary creation action) and "Connect MCP" (if no API key has been created — mirrors the existing `ConnectCta` in `SignedIn.tsx`). These two CTAs replace the ConnectCta that currently lives outside the main content.
- No carousel rows are rendered. The home is clean and directive, not a grid of empty states.

### Has timelines but no stories

The hero renders the project's timelines count as a status line: "1 timeline · 0 stories." The featured story slot shows the branded tone background with "Write your first story — open a timeline and let your AI tell it." CTA: "Open [timeline name]."

This state shouldn't feel broken — it should feel like the next step is obvious.

### Project-filtered, but project is empty

When a creator clicks a project chip that has no content yet (just created a new project), the whole home narrows to:

```
"[Project name]" is empty.
Add a timeline to get started.
[+ New timeline in this project]
```

The "+" action creates a timeline directly scoped to this project (passes `projectId` to `createTimeline` — the ADR 0003 D7 write-path contract).

---

## 8. Responsive Behavior

### Mobile (< 640px)

- **Project rail**: horizontally scrollable chips, no wrapping. Same CSS scroll-snap as the content rows. The "All" chip is always visible without scrolling (it's first); project chips scroll right.
- **Hero**: `50vh` height, no eyebrow line (too small). Title at `22px`, hook hidden if it would push the cast chips below the fold. Play button full-width at the bottom of the scrim.
- **Content rows**: cards are `calc(100vw - 32px)` wide — nearly full-screen, showing a sliver of the next card as a scroll hint. One card per "screen." This is the mobile reels pattern — the home feels like a reel of content, not a grid.
- **Row headers**: row label on the left, "See all" link on the right — same row, `justify-between`. Font size `13px`.
- **Arrow buttons**: hidden (`@media (hover: none)` — touch devices don't need them).

### Tablet (640px–1024px)

- Hero at `60vh`.
- 2 story cards per row "viewport" (card width ~`280px`).
- Project rail wraps to two lines if more than ~6 projects (rare in slice 1, but design for it).

### Desktop (>1024px)

- Hero at `56–70vh` as described.
- 3–4 story cards visible per row, partial 5th as scroll affordance.
- Entity chips 6–8 visible.

---

## 9. Motion Guidance

### Philosophy

The home should feel **alive but not anxious**. Motion serves arrival (the hero loads in gracefully) and discovery (scrolling into a new card feels responsive). It never distracts.

### Transitions

| Element | Motion | Duration | Easing | Reduced-motion fallback |
|---|---|---|---|---|
| Hero image fade-in (on project switch) | `opacity: 0 → 1` | 300ms | `ease-out` | instant |
| Hero content slide-up (on project switch) | `translateY(12px) → 0` + `opacity` | 280ms | `cubic-bezier(0.22,0.61,0.36,1)` (same as `react-flow__node`) | instant |
| Project chip active state | background fill | 160ms | `ease` | instant |
| Card hover lift | `translateY(-2px)` + `box-shadow` | 180ms | `ease-out` | none (no hover effect) |
| Move-to-project toast | slide in from bottom | 200ms | `ease-out` | instant |
| Carousel arrow scroll | `scrollBehavior: smooth` | browser-native | — | `auto` (global reset) |

The global `prefers-reduced-motion` reset in `styles.css` (lines 45–54) already collapses all CSS `animation-duration` and `transition-duration` to `0.01ms`. No component-level overrides are needed — the existing global handles it.

### What NOT to animate

- **Hero auto-rotation**: no. Manual control only (see §4).
- **Row loading skeleton → content**: no skeleton animation (the existing `story-list-card.is-skeleton` uses a static gray fill, not a shimmer). The global motion reset would kill the shimmer on reduced-motion devices anyway, leaving a flash. Static skeletons are simpler and more accessible.
- **Project chip selection**: color change only, no scale transform. Scale on navigation chips reads as "I'm activating something dangerous," not "I'm filtering."

---

## 10. Component Reuse Map

### Reuse as-is (zero net-new code)

| Component | Where it comes from | How it's reused |
|---|---|---|
| `AppHeader` | `src/components/home/AppHeader.tsx` | Unchanged — sits above the project rail |
| `ConnectCta` | `src/components/home/SignedIn.tsx` | Absorbed into the hero empty state (not a standalone section) |
| `RowMenu` | `src/components/home/RowMenu.tsx` | Extended with "Move to project..." item |
| `NewTimelineDialog` | `src/components/home/NewTimelineDialog.tsx` | Used as-is; also extended to accept a `projectId` prop |
| Story card thumbnail + body | `src/components/canvas/StoriesView.tsx` (`.story-card-thumb`, `.story-card-body`, `.story-card-hook`) | Direct style reuse — story card row items are the `StoriesView` card, detached from the canvas and widened |
| Cast chips | `src/components/public/PublicStoryReader.tsx` (`.psr-cast-chip`) | Reused in hero cover treatment |
| `psr-updated` + live dot | `PublicStoryReader.tsx` | Reused in hero eyebrow for "updated X ago" |
| Cover image treatment | `psr-cover-art` in `PublicStoryReader.tsx` | Hero uses the same `object-fit: cover` approach, scaled up |
| `Badge` | `src/components/ui/badge.tsx` | Story depth tier, entity type labels |
| `Button` (shadcn) | `src/components/ui/button.tsx` | All CTAs |
| shadcn `DropdownMenu` | `src/components/ui/dropdown-menu.tsx` | Card overflow menus |
| Token palette | `packages/ui/src/theme/tokens.css` | All colors referenced by CSS var, no new tokens needed |
| `segmentSurface` CSS class string | `TimelinesSection.tsx` line 48 | Project rail chip surface treatment |
| Scroll behavior global reset | `styles.css` (lines 45-54) | Carousel reduced-motion handling — inherited, not reimplemented |

### Adapt / extend (light modification)

| Component | Modification |
|---|---|
| `TimelinesSection` | Accepts `projectId?` prop; filters `listTimelines` by it when present. Wraps in a carousel row instead of a paginated grid. Row header replaces the section `<h2>`. |
| `RowMenu` | Add "Move to project..." item between "Rename" and "Delete" — conditionally rendered when `projects.length > 1`. |
| `NewTimelineDialog` | Accept optional `projectId` prop; pass to `createTimeline`. |
| `SignedIn` | Rewritten: replaces `<ConnectCta /> <TimelinesSection />` with the new page structure (rail + hero + rows). ConnectCta logic absorbed into the hero empty state. |

### Net-new (new components or significant new CSS)

| What | Notes |
|---|---|
| `ProjectRail` | Horizontal chip row with "All" + per-project chips + "New project." State: selected projectId (`useSearch` for URL sync). Thin — ~80 lines. |
| `CinematicHero` | Hero panel with cover image, scrim, title/hook/cast, Play/Share/Continue CTAs. Receives a `StorySummary` (same type as `listStories` returns) + the project's theme. ~120 lines. |
| `HomeContentRow` | Generic row wrapper: label + "See all" link + horizontal scroll container. Accepts `children`. ~40 lines. |
| `StoryCard` | The story card for the carousel rows — adapts the `story-list-card` shape from `StoriesView.tsx` into a 16:9 card with cover image. ~60 lines. |
| `EntityChip` | Horizontal entity pill for the "Cast & entities" row. Thin. |
| `MoveToProjectPopover` | The project-list popover triggered by "Move to project..." — renders the user's projects as a radio list. Calls `moveTimelineToProject` RPC on select. ~80 lines. |
| `NewProjectDialog` | Mirrors `NewTimelineDialog`. Two-step: name → confirmation/copy-prompt. |
| Hero empty-state (inline) | Inside `CinematicHero`, conditional render when no story exists — branded wash + "Your world starts here" + CTAs. Not a separate component. |

### No new design tokens

Every color, radius, shadow, and spacing used in this design maps to an existing token in `packages/ui/src/theme/tokens.css`. The `--color-accent-story` amber is the hero fallback background tint — it already exists. No new `--color-*` variables needed for slice 1.

---

## 11. Information Architecture — Two-Level Navigation

The ADR (0002, D11) explicitly keeps sharing per-timeline and adds no project-level route in slice 1. The home becomes two-level without requiring a new route:

**Level 1 (home `/`):** the project rail + hero + rows. URL: `/?project=roman-republic`.
**Level 2 (canvas `/timelines/$id`):** unchanged. The project context is visible in the AppHeader via an eyebrow or breadcrumb: "Roman Republic · Timeline: The Fall of the Republic." Clicking the project name goes back to `/?project=roman-republic`.

This breadcrumb in the AppHeader is **the only change to the canvas's chrome** as part of this proposal. It's a single line addition. The canvas does not need to know the full project structure — it reads the `timelines.projectId` to resolve the project name for the breadcrumb.

No `/projects/$slug` route ships in slice 1. The home *is* the project view, filtered by the rail.

---

## 12. Open Questions for Margot (PRD #local-127)

1. **Hero "Continue" vs. "Edit" CTA:** should the secondary hero CTA be "Continue this story" (opens the in-app writer/prompt dialog) or "Edit" (opens the canvas)? The persona is a creator — "Continue" is the word they use, but it's ambiguous between "continue reading" and "continue writing." Recommendation: "Continue writing" with the pen icon, but needs copy validation with a real creator.

2. **"Continue" row — 14-day freshness window:** the proposal uses 14 days as the "recently worked on" threshold. Is this right? A creator who publishes one chapter per week would always see their work in "Continue." A creator who binge-builds and then disappears for a month wouldn't. What's the right window — or should it be "last N stories opened" instead of a time window?

3. **Featured hero rotation — manual nav arrows?** The proposal defers this. If the creator has 5+ stories, they may want to see more than one in the hero without scrolling to the "Your stories" row. Worth deciding before build so the hero component can reserve layout space for prev/next arrows without a rewrite.

4. **"Continue" secondary CTA visibility rule:** the proposal shows "Continue" in the hero CTA only when `beatCount < 5`. Is beat count the right signal, or is `updatedAt` freshness a better proxy for "still in progress"?

5. **Stories row vs. no stories row — does "Continue" + "Your stories" create redundancy?** If "Continue" is the most-recent-14-days stories and "Your stories" is all stories, a creator with a small catalog will see the same cards twice. Should "Continue" be hidden when `storyCount <= 3` (everything fits in "Your stories")?

6. **Entity row scope — which entity types?** The proposal includes `person|org|place|work`. Should `concept` nodes also appear here? They're less visual and harder to represent as a chip. Recommendation: `person|org|place` only in slice 1.

---

## 13. Open Questions for Kael (build)

1. **Home query structure:** the cinematic home needs four separate data fetches per project filter: (a) featured story + its beats/cast/cover, (b) stories list, (c) timelines list, (d) entity nodes across timelines. The current `listTimelines` and `listStories` server fns exist. What's the right approach for (d) — a new `listEntities(ownerId, projectId?)` server fn that runs across all timelines in scope, or a denormalized endpoint? Performance-sensitive on large projects.

2. **MoveTimelineToProject RPC:** the move affordance needs a `moveTimelineToProject(timelineId, targetProjectId, ownerId)` server fn and matching UI. This is a direct CRUD update (not a Patch). Does it live in `src/lib/server/timelines.ts` or the new `src/lib/server/projects.ts` (per ADR 0003 checklist step 6)? Recommend `projects.ts` since it's a project-scoped operation.

3. **`?project` URL param — canonical validation:** the project rail uses `?project=<slug>`. If a slug doesn't exist or doesn't belong to the owner, the home should silently fall back to "All" (not a 404). Where does this validation live — in the route's `validateSearch` or in the data layer? Recommend `validateSearch` with a soft fallback.

4. **Theme inheritance in the hero:** the hero should reflect the project's brand theme if one is set (`projects.theme`). The `resolveTimelineTheme` function is currently timeline-scoped. Either (a) extend it to accept a nullable `project.theme` as fallback and call it from the home with `null` as the timeline override, or (b) create a lightweight `resolveProjectTheme(project)` variant. Recommend (a) since the hero is timeline-less.

5. **Carousel data freshness — SSE or polling?** The canvas uses SSE for live updates. The home doesn't need live updates at launch, but if a creator has the home open while their MCP client is building a timeline, they'd benefit from seeing new story cards appear. Is polling (e.g., 30s `refetchInterval` on TanStack Query) sufficient for slice 1, or does the home need SSE?

---

## 14. Slice-1 Scope Boundary

This proposal covers the full design. For the actual P1 build, the recommended minimal shippable slice is:

**Must-ship (P1 / local-127):**
- Project rail (chips + "All" + "New project" button)
- Hero with featured story (cover image + title + hook + cast + Play CTA)
- Hero empty state (new creator)
- "Your stories" row (the most important creator-facing row)
- "Timelines" row (the existing `TimelinesSection` adapted to a horizontal carousel)
- URL `?project=` param for filtering
- Move-to-project on timeline cards (single item, no bulk)

**Fast-follow (P1.x / before P2):**
- "Continue" row (requires tracking `lastOpenedAt` or using `updatedAt` — trivial once the row design is final)
- "Cast & entities" row (requires the `listEntities` cross-timeline query)
- Hero rotation arrows
- Bulk move
- AppHeader breadcrumb (project name in canvas chrome)

The fast-follow items don't require design decisions — they're straightforward implementations of what's already specified above.

---

*Proposal written: 2026-06-14. Wren Glasswork, Experience Architect.*
*Next: Margot → PRD #local-127. Kael → review open questions 1–5 and flag blockers.*
