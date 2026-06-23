---
project: "Synek"
owner: Wren (design)
updated: 2026-06-23
status: Active — the WHAT/HOW of Synek's design system; brand styles as applied
links: [design-principles.md, cinematic-home.md, ../product/product-strategy.md, ../../CLAUDE.md]
---

# Synek — Design System Doc

## TLDR

- The applied design system: **tokens, typography, layout, component patterns, motion, and IA** as actually shipped. The WHY lives in [design-principles.md](design-principles.md); this is the WHAT/HOW.
- **Stack:** shadcn/ui (new-york, Radix + CVA) on **Tailwind v4**, semantic tokens in `@synek/ui` (`packages/ui/src/theme/tokens.css`), `cn()` in `src/lib/utils.ts`, toasts via `sonner`. Canvas is React Flow (`@xyflow/react` v12), client-only.
- **Accent system:** story = amber `--color-accent-story`, era = teal `--color-accent-era`, applied as *carriers* (text/border/small fills), never colored perimeters.
- **Layout spine:** two-level IA — home `/` (project rail + cinematic hero + content rows, deep-linked via `?project=<slug>`) and canvas `/timelines/$id` (the immersive viewer). Public reader at `/s/$slug`.
- **No new tokens for new surfaces** — compose the existing palette and the shipped patterns (`psr-cast-chip`, scrim, `segmentSurface`, `segmentSurface` rail chips).

---

## 1. Brand styles as applied

### Color tokens

Colors live as semantic CSS variables in `packages/ui/src/theme/tokens.css`, aliased onto shadcn's `--background`/`--primary`/etc. and switched by `[data-theme]` via `ThemeProvider`. Both light and dark are defined; values below are dark / light.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--color-accent-story` | `#e0a458` | `#b87716` | **The story accent (amber).** Hero fallback wash, story-card tints, story chrome, Play affordances. The brand's signature color. |
| `--color-accent-story-text` | `#e0a458` | `#8a560f` | AA-contrast text variant of the story accent (light-mode text darkens for contrast). |
| `--color-accent-era` | `#45b8ac` | `#2f9389` | **The era accent (teal).** Period/era ribbons, era spans, time-axis era markers. Decoupled from influence purple. |
| `--color-accent-era-text` | `#45b8ac` | `#176a5f` | AA-contrast text variant of the era accent. |
| `--color-fg-secondary` | — | — | Secondary foreground — hooks, supporting copy, eyebrow detail. |
| `--color-fg-muted` | — | — | Muted foreground — eyebrows, read-time/beat-count metadata, separators. |
| `--color-bg-base` | — | — | Page base background; the rail and hero sit on this. |
| `--color-bg-surface` | — | — | Raised surface — cards, chips, panels. |

shadcn aliases (`--primary`, `--ring`, `--xy-*`, `--story`, `--chart-4`) are re-declared on top of the brand palette — when introducing a theme, the aliases must be re-baked (see [strata-timeline-themes](../../) lesson: `--primary`/`--ring`/`--xy-*` must be re-declared per scheme).

**Carrier-accent rule:** accents are applied to text, borders, and small `color-mix` fills — never as a colored border around a neutral body. Node bodies stay neutral with a hover lift; the accent identifies type. Era uses a `3px` left border and `color-mix(in oklab, var(--color-accent-era) 22–42%, transparent)` fills.

### Typography

- **Body:** the system stack (no custom body font) — prioritizes readability and zero-FOUT local-first loading.
- **Display:** `var(--font-display, inherit)` — unset by default, so headings inherit the system stack. A project/timeline/story **theme** can set a curated display font, which the hero title and `.story-title` inherit (`src/styles.css:167`). Theme fonts are the only typographic customization surface.
- Eyebrows: ~`12px`, uppercase, tracked, `--color-fg-muted`. Titles: `32px` desktop / `22–24px` mobile, `font-weight: 600`. Hooks: `15px`, `--color-fg-secondary`.

---

## 2. Layout system

### Page shell

The home (`src/routes/index.tsx` → `ProjectsWorkspace`) is a vertical stack:

```
AppHeader  (auth · Projects nav · settings)
─────────────────────────────────────────────
Project context  (project rail / ProjectHero per ?project)
─────────────────────────────────────────────
Cinematic hero   (featured story, full-bleed, 56–70vh)
─────────────────────────────────────────────
Content rows     (horizontal carousels — stories, timelines, entities)
```

The canvas (`src/routes/timelines.$id.tsx`) is a full-width client-only React Flow surface — the viewer. Position is data-owned: x from `instantToX` (date), y from `LANE_Y` (type lane); nodes non-draggable.

### Spacing & shape

- Cards: `rounded-xl`, `border border-border/60`, `bg-card` with a subtle `bg-gradient-to-b from-foreground/[0.04]` top sheen (the `TimelinesSection` card shape).
- Hero: `min-height: 56vh; max-height: 70vh` desktop, `60vh` tablet, `50vh` mobile.
- Rail: slim `40px`, translucent backdrop (`backdrop-blur-sm bg-background/80`), z-elevated so the hero cover bleeds underneath it (the `psr-head` approach).

### Responsive breakpoints

| Tier | Width | Hero | Cards per row viewport |
|---|---|---|---|
| Mobile | < 640px | 50vh, no eyebrow, full-width Play | 1 card `calc(100vw − 32px)` (reels feel) |
| Tablet | 640–1024px | 60vh | ~2 story cards (`~280px`) |
| Desktop | > 1024px | 56–70vh | 3–4 cards + partial 5th; 6–8 entity chips |

---

## 3. Design patterns (shipped)

### Scrim treatment

Text-over-image legibility uses a bottom gradient scrim, reused from `psr-cover` in `PublicStoryReader`:

- Dark: `linear-gradient(to top, rgba(8,9,12,0.92) 0%, rgba(8,9,12,0.60) 40%, transparent 75%)`
- Light: `rgba(250,251,252,0.88) → transparent`

Cover images use `object-fit: cover` anchored `object-position: center top` (keeps faces visible on portrait crops). No cover → branded `--color-accent-story` amber wash over `--color-bg-base` (a tone, never a placeholder image).

### `psr-cast-chip`

Small pill rendering a story cast member (node-backed or name-only), from `PublicStoryReader`. Reused in the hero cover and story cards; max 4 visible with a "+N more" overflow.

### `segmentSurface`

The active/selected surface treatment (from `TimelinesSection`): filled background at the accent color ~15% opacity with an accent border and accent text. Used for the active project-rail chip and segmented toggles. The only accent touch on the rail — everything else is `--color-bg-surface` / `--color-fg-secondary`.

### `segmentSurface` story rows

Per-beat story rendering uses a `segmentSurface`-style panel for the active beat. The immersive reader drives the canvas lens per beat (globe ↔ timeline, `story_segments.lens`).

### Carousel rows

Pure-CSS horizontal scroll: `overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch`, cards `scroll-snap-align: start`. No JS carousel. Desktop-only `ChevronLeft`/`ChevronRight` ghost arrows (`scrollBy({behavior:'smooth'})`), hidden under `@media (hover: none)`. Story/timeline cards `min-width: 240px; max-width: 320px`; entity chips `min-width: 140px` fixed.

### Card overflow menu

A `[···]` shadcn `DropdownMenu` on each card carries rare actions (Open canvas, Share, Move to project…, Delete). The card face stays uncluttered — primary action (Play/Open) only. "Move to project…" is conditionally rendered when `projects.length > 1`.

### Reversible-action confirmation

Cheap, reversible actions (move-to-project) confirm via an **undo toast** (`sonner`), not a pre-confirmation dialog. Destructive/irreversible actions (Delete) require a confirm.

---

## 4. Motion guidelines

From [cinematic-home.md §9](cinematic-home.md). Philosophy: alive but not anxious — motion serves arrival and discovery, never distraction. No hero auto-rotation; manual control only.

| Element | Motion | Duration | Easing | Reduced-motion |
|---|---|---|---|---|
| Hero image fade-in (project switch) | `opacity 0→1` | 300ms | `ease-out` | instant |
| Hero content slide-up | `translateY(12px)→0` + opacity | 280ms | `cubic-bezier(0.22,0.61,0.36,1)` | instant |
| Project chip active state | background fill | 160ms | `ease` | instant |
| Card hover lift | `translateY(-2px)` + shadow | 180ms | `ease-out` | none |
| Move toast | slide in from bottom | 200ms | `ease-out` | instant |
| Carousel scroll | `scroll-behavior: smooth` | native | — | `auto` |

The global `prefers-reduced-motion` reset in `styles.css` (≈lines 45–54) collapses all `animation-duration`/`transition-duration` to `0.01ms` — **no per-component overrides**. Don't animate: hero auto-rotation, loading skeletons (static gray fill, no shimmer), or chip selection scale (color change only — scale reads as "activating something dangerous").

---

## 5. Information architecture

Two-level navigation, no new route needed (per the cinematic-home proposal and ADR 0005's per-story-sharing decision):

- **Level 1 — home `/`** (`ProjectsWorkspace`, auth-gated, owner-scoped): project rail + cinematic hero + content rows. Filtered by `?project=<slug>` (TanStack Router `validateSearch` + `useSearch`; unknown/foreign slug soft-falls-back to "All", never 404s). Bare `/` = projects-list; `?project=<slug>` = that project's `ProjectHero` + rows. Login lands here.
- **Level 2 — canvas `/timelines/$id`**: the immersive viewer. Project context surfaces in the AppHeader; the canvas reads `timelines.projectId` only to resolve the breadcrumb.
- **Public — `/s/$slug`**: the no-auth, mobile, widget-rich `PublicStoryReader` (per-story sharing; gated on `timeline.isPublic`). SSR OpenGraph for link previews.
- **Public — `/p/$slug`**: owner-scoped project-handle resolver → `/?project=<slug>`.

**Culled (ADR 0005, 2026-06-17):** no landing page, no cross-user Explore/discovery feed. The root is the workspace. Sharing narrows to "share a link," not "browse a feed."

### Content row taxonomy

| # | Row | Contents | Rule |
|---|---|---|---|
| 1 | Continue | stories `updatedAt` < 14 days, newest first | hidden if none recent |
| 2 | Your stories | all stories, `updatedAt` desc | primary creator row |
| 3 | Timelines | timelines in scope | world-building surface |
| 4 | Cast & entities | `person`/`org`/`place` nodes in scope | hidden if none; ghost-chip empty state |

---

## 6. Influences

- **Netflix / cinematic streaming home** — the hero-then-rows shape and movie-poster cover treatment. *Adapted, not copied:* Synek's home is also a creation surface (Play sits beside Continue/Edit), and there is **no autoplay rotation** — the creator has few enough stories that manual navigation wins.
- **Linear / Notion** — the node design language: neutral bodies, restrained accent carriers, hover lift, no colored perimeters (the carrier-accent rule).
- **shadcn/ui (new-york)** — the component baseline (Radix primitives + CVA), Tailwind v4 semantic tokens.
- **Immersive map/globe storytelling** — the per-beat lens choreography (globe ↔ timeline camera moves driven by the story, `story_segments.lens`).

---

## 7. Component reuse map

The cinematic home shipped composing existing pieces (full map in [cinematic-home.md §10](cinematic-home.md)):

- **Reuse as-is:** `AppHeader`, `psr-cast-chip`, `psr-cover` scrim, `Badge`, shadcn `Button`/`DropdownMenu`, the token palette, the global reduced-motion reset.
- **Net-new (thin):** `CinematicHero`, `HomeContentRow`, `StoryCard`/`EntityCard`/`TimelineCard`, `ProjectCard`/`ProjectHero`, `NewProjectDialog`, `MoveToProjectSubmenu`.
- **No new design tokens** — every color/radius/shadow/spacing maps to an existing `@synek/ui` token.

---

## Change Log

| Date | Change |
|---|---|
| 2026-06-23 | Initial design-system doc established (Wren). Tokens, layout, patterns, motion, and IA extracted from the shipped product, `@synek/ui` tokens, and `CLAUDE.md`. |
| 2026-06-14 | **Cinematic stories-first home proposal** ([cinematic-home.md](cinematic-home.md)) — established the two-zone home (project rail + cinematic hero + content rows), the scrim/`psr-cast-chip`/`segmentSurface` reuse patterns, carousel mechanics, move-to-project affordance, motion guidance (§9), and two-level IA. The structural basis for §2, §3, §4, and §5 above. |
