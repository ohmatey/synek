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
- **Layout spine:** two-level IA — home `/` (stories-first workspace: cinematic hero for new creators, else a "Your library" action bar + **Recently updated → Series → Timelines → Entities** rows) and canvas `/timelines/$id` (the immersive viewer). Public reader at `/s/$slug`. **Projects are invisible plumbing** (ADR 0007) — no project surfaces in the UI; `projectId` still scopes data. **Brands** are a first-class entity (a "Brand kits" library row), referenced by stories/series via a `BrandPicker`.
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

- **Level 1 — home `/`** (`ProjectsWorkspace`, auth-gated, owner-scoped): **two states** — (a) *truly empty account* → `CinematicHero` (full-bleed wash, "New story" primary CTA, "New series" secondary CTA, "start with a timeline" text link, connect-MCP nudge when no API key, three story starters); (b) *populated account* → `LibraryActions` action bar ("Your library" heading + New story / New series / New timeline / Brand kits chip buttons) + content rows. Projects are invisible plumbing (ADR 0007) — no project surfaces in the UI.
- **Level 2 — canvas `/timelines/$id`**: the immersive viewer. Project context surfaces in the AppHeader; the canvas reads `timelines.projectId` only to resolve the breadcrumb.
- **Public — `/s/$slug`**: the no-auth, mobile, widget-rich `PublicStoryReader` (per-story sharing; gated on `timeline.isPublic`). SSR OpenGraph for link previews.
- **Public — `/p/$slug`**: owner-scoped project-handle resolver → `/?project=<slug>`.

**Culled (ADR 0005, 2026-06-17):** no landing page, no cross-user Explore/discovery feed. The root is the workspace. Sharing narrows to "share a link," not "browse a feed."

### Content row taxonomy

| # | Row | Contents | Rule |
|---|---|---|---|
| 1 | Recently updated | stories + timelines merged, `updatedAt` desc, max 12 | always shown when content exists (temporal "what changed" feed) |
| 2 | Series | serialized seasons, `updatedAt` desc | hidden if none; `SeriesCard` poster with draft vs. published states |
| 3 | Timelines | all timelines in scope | world-building substrate row |
| 4 | Cast & entities | `person`/`org`/`place` nodes in scope | hidden if none; `EntitiesDisclosure` (aria-expanded toggle) |

---

## 6. Influences

- **Netflix / cinematic streaming home** — the hero-then-rows shape and movie-poster cover treatment. *Adapted, not copied:* Synek's home is also a creation surface (Play sits beside Continue/Edit), and there is **no autoplay rotation** — the creator has few enough stories that manual navigation wins.
- **Linear / Notion** — the node design language: neutral bodies, restrained accent carriers, hover lift, no colored perimeters (the carrier-accent rule).
- **shadcn/ui (new-york)** — the component baseline (Radix primitives + CVA), Tailwind v4 semantic tokens.
- **Immersive map/globe storytelling** — the per-beat lens choreography (globe ↔ timeline camera moves driven by the story, `story_segments.lens`).

---

## 7. Brand system (first-class entity, ADR 0007)

Brands are reusable workspace-level kits, not folded into a project. The pattern: **library → picker → one-shot seed**.

- **`BrandLibraryDialog`** (`src/components/brand/BrandLibraryDialog.tsx`): list → inline editor navigation. Two modes within one Dialog: the list (create / set-default / edit / delete) and the editor (Identity · Visual · Voice tabs, name field). Back-arrow in the dialog header returns to the list. A "Default" badge + `Check`/`Star` toggle for the workspace-default kit.
- **`BrandPicker`** (`src/components/brand/BrandPicker.tsx`): compact `DropdownMenu` trigger (Palette icon + truncated name + chevron). Lists owner's kits; "No brand" clears the link. Reused in the story dialog and the series detail page. When the list is empty, no inline creation path exists (open design issue — recommendation: add a "New brand" item at the bottom).
- **Brand application model:** one-shot seed via `deriveThemeFromBrand` (`src/lib/theme/deriveThemeFromBrand.ts`) — maps palette → five accent slots, font family → nearest curated `ThemeFont`, `visualAesthetic` → `imageStyle`, `brandAttributes` → `mood`. Returns `null` when the kit has nothing visual (caller leaves existing theme untouched). After seeding, the theme is freely editable; the brand reference persists for voice.
- **Resolution cascade:** `story.brandId ?? series.brandId ?? project.brandId`. Voice is live (applied at prompt-build time); theme is seeded once on apply.
- **`SeriesCard` states:** draft series card has an inert cover (no `href`), a "Draft" label in `text-muted-foreground`, and a `ShareSeriesButton` icon as the publish affordance. Public series card has an `<a>` cover linking to `/sr/$slug` and an "Open season" primary action. Both carry `BookOpen` (view series detail) and `PenLine` (write next chapter prompt) icon buttons.

## 8. Season page layout (`/sr/$slug`)

The public, no-auth series season page. Prefix: `.sj-*` (jacket), `.sb-*` (spine), `.public-series`.

- **Two-panel grid (desktop, committed fb8eee5):** CSS grid `360px 1fr` — LEFT rail (`.sj-jacket` + `.sb-spine`, pinned) beside RIGHT reader (`.public-series-reader`, sticky/full-height). The rail does not scroll with the reader. Single "Begin reading" amber CTA in the jacket; no competing CTA in the reader itself. CTA label updates to "Continue reading" once the reader has advanced past beat 0 (`safeIndex > 0`).
  - `.sj-jacket`: cover image (`object-fit: cover; object-position: center top`) or amber fallback wash (`--color-accent-story`). Title (`h1`, display font), italic hook tagline, season meta ("Season · N chapters · updated X ago"), amber "Begin reading" CTA button.
  - `.sb-spine`: TOC beneath the jacket in the same rail. Roman-numeral `.sb-num` (display font, amber), `.sb-title`, `.sb-hook` (truncated, `max-width: 46ch`), `.sb-dateline` (era teal text), `.sb-new` badge (uppercase amber, "NEW · Nd AGO" for the most recent chapter). Draft chapters at `opacity: 0.62` with a `.sb-status-draft` pill. TOC hover: `.sb-row-btn:hover` = 7% amber wash; `.sb-row.is-active` = 10% amber wash for current chapter.
- **Mobile (single-column):** jacket band (full-width) stacked above reader. TOC moved to a bottom-sheet overlay (dimmed backdrop, close button, `aria-expanded` toggle, Esc + backdrop-click-to-close). "Chapters (N)" outlined toggle button in the jacket band opens the sheet. The inline spine is hidden on mobile.
  - **Mobile jacket height (resolved ec5b341):** the bulk wasn't the cover — the reader's `.psr-cover` was vertically *centered*, stranding the opener near the bottom of the reader frame. In series mode on mobile (`@media (max-width: 879px)`) the reader cover now `justify-content: flex-start` (clearing the absolute `.psr-head`), so the chapter-1 opener peeks right under the jacket band without scrolling. Desktop keeps the centered, balanced card. The shared `.sj-cover` is also capped at `42dvh` (was `55dvh`) so it leads rather than dominates.
- **Per-chapter openers + one CTA (resolved ec5b341):** picking a chapter from the spine/sheet now PREVIEWS it on its opener (cast / hook / time) rather than auto-starting; the single jacket CTA ("Begin/Continue reading") starts the shown chapter; finishing a chapter still auto-continues into the next (Netflix-style). Mechanically the reader takes `startImmediately` (mount-time play, for auto-continue) + `playSignal` (start the current chapter in place, for the jacket CTA), keyed per chapter so one chapter open stays one `public_story_opened` impression. This gives every chapter the same threshold moment as chapter 1 while keeping a single start control.

---

## 9. Component reuse map

The cinematic home shipped composing existing pieces (full map in [cinematic-home.md §10](cinematic-home.md)):

- **Reuse as-is:** `AppHeader`, `psr-cast-chip`, `psr-cover` scrim, `Badge`, shadcn `Button`/`DropdownMenu`, the token palette, the global reduced-motion reset.
- **Net-new (thin):** `CinematicHero`, `HomeContentRow`, `StoryCard`/`EntityCard`/`TimelineCard`, `ProjectCard`/`ProjectHero`, `NewProjectDialog`, `MoveToProjectSubmenu`.
- **No new design tokens** — every color/radius/shadow/spacing maps to an existing `@synek/ui` token.

---

---

## Change Log

| Date | Change |
|---|---|
| 2026-06-24 | **Season page Med findings resolved** (ec5b341). §8 updated: the mobile jacket-height issue (reader cover now top-aligns in series mode so the opener peeks under the jacket; `.sj-cover` capped at 42dvh) and the chapter-2+ opener-suppression trade-off (spine pick now previews each chapter on its opener; one jacket CTA starts it; auto-continue between chapters). Both prior "open design issues" are now closed. |
| 2026-06-24 | **Season page two-panel review** (Wren, UX review of fb8eee5). Rewrote §8 to reflect the shipped two-panel grid (desktop `360px 1fr`, mobile sheet-gated TOC). Removed the stale "known layout tension" note (resolved by the two-panel layout). Recorded two open design issues: mobile jacket-band height cap and the chapter-2+ opener suppression trade-off. |
| 2026-06-24 | **ADR 0007 — Stories-first + Brand Kits slice** (Wren, UX review). Updated §5 home IA to document the two-state populated/empty home (utility-first `LibraryActions` bar on populated accounts; `CinematicHero` for truly-empty). Updated content row taxonomy to match shipped rows (Recently updated / Series / Timelines / Entities). Added §7 Brand system (library → picker → one-shot seed pattern, `BrandLibraryDialog`, `BrandPicker`, `SeriesCard` states, `deriveThemeFromBrand`). Added §8 Season page layout (`.sj-*` / `.sb-*`, container-width tension flagged as open issue). Renumbered Component reuse map → §9. |
| 2026-06-23 | Initial design-system doc established (Wren). Tokens, layout, patterns, motion, and IA extracted from the shipped product, `@synek/ui` tokens, and `CLAUDE.md`. |
| 2026-06-14 | **Cinematic stories-first home proposal** ([cinematic-home.md](cinematic-home.md)) — established the two-zone home (project rail + cinematic hero + content rows), the scrim/`psr-cast-chip`/`segmentSurface` reuse patterns, carousel mechanics, move-to-project affordance, motion guidance (§9), and two-level IA. The structural basis for §2, §3, §4, and §5 above. |
