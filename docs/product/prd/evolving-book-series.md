---
project: "Synek"
track: "P3 — Serialized stories / Evolving book UX"
status: "proposed (2026-06-22)"
authors: ["Wren (UX, design source of truth)", "Margot (product — see ADR 0006)"]
updated: 2026-06-22
issues: ["local-162 (public season page redesign)", "local-161 (in-app series detail — slice B)"]
links:
  - docs/engineering/adr/0006-serialized-stories.md
  - docs/product/prd/sharable-stories.md
  - docs/product/prd/cinematic-home.md
  - docs/ux/cinematic-home.md
  - src/routes/sr.$slug.tsx
  - src/components/public/PublicStoryReader.tsx
  - src/components/home/cinematic/SeriesCard.tsx
  - src/lib/theme/resolveTimelineTheme.ts
---

# Evolving Book — Series UX Design Proposal

> The whole pitch is "watch your world grow a chapter at a time." The interface should make that growth legible, beautiful, and impossible to mistake.

**Status:** proposed. Design source of truth is this document. Engineering hand-off targets ADR 0006
slices 4 (public page) and 5 (in-app series home). No code yet.

---

## 1. The Design Problem, Precisely Stated

The data model is right. A series has a title, chapters, a cover, a theme. The current `/sr/$slug`
page is a thin chapter-chip rail sitting above a `PublicStoryReader` instance. It works. It doesn't
feel like anything.

Four specific failures, in order of severity:

**1a. No jacket moment.** The series title is a 13px label above a chip row. A reader arriving
from a shared link has zero sense of what they're entering — no hierarchy, no weight, no identity.
The series and its chapters look identical to a single story. The cover image, if present, is
hidden behind the reader's own `psr-cover-art` panel (the first chapter's cover, not the series
jacket). The series has no presence.

**1b. Growth is invisible.** A 1-chapter draft and a 14-chapter living work render identically:
same chip row, same reader. There is no signal that you're entering something that is still
growing — no recency, no chapter count in context, no "latest chapter added 2 days ago." The
North Star promise — a world that grows before your eyes — is completely absent from the UI.

**1c. App metadata, not reading language.** The `psr-chip` row reads: `DEEP · ~4 MIN · 5 BEATS`.
Analytics chips in a reading artifact. A book would say none of these things on its cover. "Beats"
is a production term; the reader doesn't know what a beat is. This is the creator's vocabulary
spilling onto the audience surface.

**1d. The theme system is unused here.** `resolveThemeVars` produces a `--font-display` variable
the series page inherits, but `.psr-title` already uses `font-family: var(--font-display, inherit)`.
That should work — except the series-level jacket, the chapter TOC, and the season navigation
don't USE `.psr-title`. They use hardcoded 13px utility text. The display font is wired but dark —
the jacket spread is the one surface where it should sing, and it doesn't appear there at all.

The in-app series detail (local-161) doesn't exist yet. The only in-app series surface is
`SeriesCard` — a home carousel card with a chapter count and a `PenLine` icon button that opens
`PromptDialog`. Fine for discovery. Not a workspace.

---

## 2. Design Direction — The "Evolving Book" System

These two surfaces — the public season page and the in-app series detail — are the same book
seen from two sides: the audience sees the published artifact; the creator sees the growing
manuscript. They share a **design language** and differ only in what actions are available.

The metaphor is not "streaming service" (Netflix). It is a **living book**: a physical object
with a spine that lengthens, a jacket cover, chapter numbers, a sense of time and accumulation.
The reading experience should feel like sitting down with something that has weight, not tapping
through a feed.

### 2a. The shared language: seven primitives

**P1 — The jacket spread.** The book's front face. A large (full-bleed or 60–80% viewport height)
panel with: the series cover image; the series title in the display font at hierarchy-commanding
size (36–44px on desktop, 28–32px mobile); the hook as a subtitle; and a single "Begin reading"
or "Continue reading" CTA. This is the first thing a visitor sees on the public page. On the
in-app detail, it's the page hero. On the home carousel, the `SeriesCard` is already a small
jacket — the detail page just scales it up.

The jacket is where `--font-display` belongs. Title, hook, and chapter number labels all use it.
Body text and UI chrome use the system font. This is the exact distinction the theme system was
built for.

**P2 — The spine / table of contents.** An ordered list of chapters that SHOWS the book's growth.
Not pills. Not a horizontal chip rail that overflows off-screen. A **vertical list**, one row per
chapter, ordered top-to-bottom (Chapter I at top, latest at bottom), with:
- Chapter number as a roman numeral or ordinal in accent color, left-column
- Chapter title in the display font
- A one-line hook (subtitle) below the title, in muted text
- A thin time-thread — the earliest covered instant of that chapter — as a right-column dateline
- A recency marker on the latest chapter: "New · 2d ago"
- Status indicator (draft: locked/muted; published: readable)

The spine's visual weight grows as chapters accumulate. Chapter I through V looks like a short
story. Chapter I through XIV looks like a real book. That difference MUST be visible.

**P3 — Chapter openers.** When a chapter begins in the reader (the cover panel), the treatment
shifts from the generic `psr-cover` shell toward a book-page sensibility:
- Eyebrow: "Chapter II · Roman Republic" in small caps, accent color
- Chapter title: large, display font, no bold (weight comes from size + font)
- Hook: a single line of italic subtitle below the title
- Cast chips and depth metadata move to a quiet footer (not the dominant visual element)
- The "Play story" button is renamed to something that fits the metaphor: "Read" or "Begin chapter"
- Beat count is NOT shown on the cover. It's a production metric, not a reader metric. A book
  doesn't say "42 pages" on the front. It says nothing — and the reader discovers the length.

**P4 — Recency and growth signals.** These are load-bearing for the "evolving" promise:
- The spine marks the latest chapter with an accent-colored "New" badge + relative time
- The public page header shows: "Season · 14 chapters · last updated 2 days ago"
- The in-app detail shows: the frontier (ADR 0006 D8) — the latest chapter number and its date
- The `psr-live-dot` pulse (already exists) surfaces in the series-level header, not only
  inside the reader — the series itself is described as live
- If a chapter is a draft (unpublished), it renders in the spine as a locked, dimmed row on the
  in-app detail; it is invisible on the public page

**P5 — Page-turn continuation.** Between chapters, the transition should signal a page turn,
not a chapter-chip swap. Specifically: the "Next chapter" end-panel (already in `PublicStoryReader`
when `hasNext && onNext`) should be styled as a book-turn moment — the title of the next chapter
is shown ("Next: Chapter III · The Crossing of the Rubicon"), with the series jacket icon visible
in the background at low opacity. This is not a new component. It is a style pass on the existing
`psr-end` panel when `hasNext` is true, plus a `nextChapterTitle` prop passed from the season page.

**P6 — The theme as the book's identity.** Series theme (`series.theme ?? project.theme ?? defaults`)
already resolves into CSS vars via `resolveThemeVars`. The proposal is to apply those vars to
the JACKET and SPINE specifically, not only the reader:
- `--font-display` on the jacket title, spine chapter titles, chapter opener eyebrow + title
- `--color-accent-story` on the chapter number labels, the "New" badge, the "Begin reading" CTA
- `--color-accent-era` on the time-thread datelines in the spine
- The texture key (`theme.texture`) drives a subtle background pattern on the jacket spread
  (dots / grid / paper) — same as it does on the canvas via `.xy-background-pattern`

No new CSS variables. All of these are already emitted by `resolveThemeVars` and inherited by
the `.public-story` root. The gap is that the jacket and spine currently don't have elements
that consume `--font-display`. Adding those elements closes the gap.

**P7 — Reading vs. app language.** An editorial pass replacing production vocabulary:
- "beats" → never appears in the reader or public page
- "DEEP" depth chip → drop or render as a thin accent stripe on the chapter cover, not a pill
- "~4 MIN" stays on the chapter cover footer (reading time is reader-useful) but styled down:
  small, muted, no uppercase caps
- "Play story" / "Play" → "Read" or "Begin chapter" on chapter openers within a series context
- The `psr-head` in-reader label currently reads "Synek · [series title]" — when inside a
  series, change to "Synek · [series title] · Chapter [N]" so position in the book is always
  visible in the header

---

## 3. Surface A — Public Season Page (`/sr/$slug`)

### Current state (what exists)

File: `src/routes/sr.$slug.tsx` (116 lines). The page has:
- A `<nav class="psr-season">` with the series title (13px, 650 weight) + a horizontal
  `<ol>` of chapter chips (`.psr-season-chip`, pill-shaped, overflow-x scroll)
- A `<PublicStoryReader>` instance driven by `index` state — the chapter selector
- The series theme is applied via `resolveThemeVars` as inline `style` on the page root

What's missing: the jacket, the vertical spine, the growth signals, the page-turn metadata.

### Proposed layout

```
┌──────────────────────────────────────────────────────┐
│  Synek wordmark (top-left, links to /)               │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ░░░░░░░  JACKET SPREAD  ░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░  [cover image — full-width, 55dvh max]        ░  │
│  ░  [after cover: title + hook + series meta]    ░  │
│  ░  [Begin reading / Continue reading CTA]       ░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                                      │
│  SPINE / TABLE OF CONTENTS                           │
│  ┌────────────────────────────────────────────────┐  │
│  │  I   ·  The Beginning of Caesar's Rise         │  │
│  │        "From consul to conqueror…"             │  │
│  │                                         49 BCE │  │
│  ├────────────────────────────────────────────────┤  │
│  │  II  ·  The Crossing of the Rubicon            │  │
│  │        "A single decision, irrevocable…"       │  │
│  │                                         49 BCE │  │
│  ├────────────────────────────────────────────────┤  │
│  │  III ·  The Final Year  [New · 2d ago]         │  │
│  │        "The ides were not the end…"            │  │
│  │                                         44 BCE │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  READER (after chapter selection or "Begin reading") │
│  ┌────────────────────────────────────────────────┐  │
│  │  PublicStoryReader (existing, unchanged)        │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Growth CTA: "Make your own with Synek"             │
└──────────────────────────────────────────────────────┘
```

On mobile (< 600px): jacket spread takes full viewport height; spine scrolls below; reader
mounts below the spine on first "Begin reading" and the page scrolls down into it (smooth
behavior). Alternatively — and preferable — "Begin reading" keeps the current full-screen reader
modality but the page now has the jacket/spine visible BEFORE the reader is activated, so first-
time visitors understand what they're entering.

On desktop (≥ 600px): the existing `psr` max-width constraint (560px) centers the reader;
the jacket + spine live above it, full-width up to 720px (matching the existing `.psr-season`
max-width). No side-by-side layout change needed — this is a vertical stack, same as today.

### Component breakdown

**A1 — `SeriesJacket` (new, ~70 lines).**
A new sub-component in `src/components/public/SeriesJacket.tsx`. Not a page-level change — a
component the season page renders above the reader.

Props: `series: { title, hook, coverImage, theme }`, `chapters: PublicSeriesChapter[]`, `onBegin: () => void`.

Renders:
- The cover image at full width, `object-fit: cover`, `max-height: 55dvh`, with a scrim gradient
  fading to the page background at the bottom (same pattern as `psr-bleed::after`)
- Overlaid on the bottom half of the image: series title (display font, `clamp(28px, 5vw, 44px)`),
  hook (muted, 15–16px italic), a series meta line ("Season · N chapters · updated Xd ago"), and
  the primary CTA button
- No new image-loading logic; just an `<img>` with the existing `StoryImage` shape
- Applies `--font-display` via inherited var from the page root; no new JS

**A2 — `SeriesSpine` (new, ~80 lines).**
`src/components/public/SeriesSpine.tsx`. A `<nav>` with `aria-label="Table of contents"`.

Props: `chapters: PublicSeriesChapter[]`, `activeIndex: number`, `onSelect: (i: number) => void`,
`updatedAt: number`.

Renders a `<ol>` of chapter rows. Each row:
- `<button>` (keyboard-navigable, `aria-current` on active)
- Left: chapter number as roman numeral in accent color (`font-variant-numeric: tabular-nums`,
  `color: var(--color-accent-story)`) — uses a small utility `toRomanNumeral(n)` helper (≤20
  chapters: I–XX; > 20: arabic)
- Middle: chapter title (display font, 15–16px) + hook below (muted, 13px, 1-line clamp)
- Right: dateline from the chapter's `momentId` earliest instant, formatted as year via existing
  `formatInstant` utility; or empty if no covered instant is resolvable from the chapter's
  `PublicSeriesChapter` shape
- Latest chapter only: a "New" badge (`color: var(--color-accent-story)`) + `timeAgo(updatedAt)`
  (the existing `timeAgo` function from `PublicStoryReader.tsx` — extract to a shared util)

The spine REPLACES the existing `<nav class="psr-season">` entirely. Same data (chapters + index),
different treatment.

**A3 — Chapter opener enhancement (existing `psr-cover`, conditional extension).**
When the reader is driven from a season page (the `onNext` prop is present, which is already
the signal for "we're in a series"), the cover panel gets:
- A `data-in-series` attribute set by the parent
- CSS: `.psr-cover[data-in-series] .psr-eyebrow` renders "Chapter N · [series title]" eyebrow text
  above the chapter title
- The "Play story" button label changes to "Begin chapter" via a prop `ctaLabel?: string` on
  `PublicStoryReader`

The chapter number and series title are passed from the season page as a `chapterMeta?: { number: number; seriesTitle: string }` prop on `PublicStoryReader`. This is a two-line prop addition — no redesign.

**A4 — Next-chapter end panel (existing `psr-end`, enhancement).**
When `hasNext` is true and `onNext` is passed, the existing end panel shows "The story continues.
Next chapter →". The proposal adds a `nextChapterTitle?: string` prop to `PublicStoryReader`.
If provided, the end panel renders: eyebrow "End of Chapter N" + "Next: [nextChapterTitle]".
The season page computes `nextChapterTitle = chapters[safeIndex + 1]?.story.title` and passes it.
Zero new components.

**A5 — `timeAgo` extracted to a shared util.**
Currently defined in `PublicStoryReader.tsx` (lines 44–56). Both the jacket meta line and the
spine recency badge need it. Extract to `src/lib/time-ago.ts` (3 lines of change: delete the
inline definition, add the file, import in both consumers).

### SSR / OG implications

No changes. The existing `head()` function in `sr.$slug.tsx` already serves correct OpenGraph
tags from `series.title`, `series.hook`, and `series.coverImage`. The jacket spread just
renders those same values in the HTML body — SSR is unchanged.

The `SeriesJacket` is a pure presentational component with no server data beyond what the loader
already returns. The `SeriesSpine` similarly reads only the `chapters` array from the loader.

### Responsive + reduced-motion

- Jacket: cover image uses `max-height: 55dvh` on all breakpoints. On mobile (<600px) the
  text overlay sits in a `position: relative` block below the image, not overlaid. This avoids
  contrast issues on mobile where the image covers the full width with no safe white area.
  On desktop (≥ 600px), the text overlays the bottom 40% of the image with a gradient scrim.
- Spine: a single-column vertical list is inherently responsive. No breakpoint changes needed.
- `@media (prefers-reduced-motion: reduce)`: the `psr-live-dot` pulse animation is already
  suppressed (`animation: none` in the existing CSS). The jacket-to-reader scroll transition
  must use `scroll-behavior: auto` (not smooth) under reduced motion. A single media query
  on the `<html>` element already handles this if we use `scroll-behavior: smooth` at the
  page root — nothing new needed.

---

## 4. Surface B — In-App Series Detail (new route)

### What doesn't exist yet

There is no `/series/$id` route. The only in-app series surface is `SeriesCard` in the home
carousel — a card that opens the public `/sr/$slug` page for published series, or shows "Draft"
for unpublished ones. The creator has no workspace view of their series.

The "Write the next chapter" CTA in `SeriesCard` opens a `PromptDialog` with a `buildNextChapterPrompt`
spec. That is the right seam. The detail page puts that CTA in a larger context, with the chapters
visible alongside it.

### Route

`src/routes/series.$id.tsx`. Owner-only (authenticated, owner-scoped). Not a public surface.

Loader: a new `getSeriesDetail` server function in `src/lib/server/series.ts` that returns:
- Series meta (same `story_series` row: title, hook, cover, theme, status, isPublic)
- All chapters (draft AND published), ordered by `chapterNumber`, with status field
- The derived frontier from `get_series` (max chapterNumber, max covered instant)
- The project it belongs to (for breadcrumb navigation back to the project view)

Note: this is different from `getPublicSeries` which filters to `isPublic === true` chapters only.
The detail view shows all chapters including drafts.

### Proposed layout

```
┌──────────────────────────────────────────────────────┐
│  AppHeader (existing, unchanged)                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  BREADCRUMB: Project → Series title                  │
│                                                      │
│  ░░░  SERIES HERO (same jacket treatment as A1)  ░░░  │
│  ░  cover · title (display font) · hook           ░  │
│  ░  status badge + share control (owner-visible)  ░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                                      │
│  TWO-COLUMN LAYOUT (≥768px) / STACKED (<768px)       │
│  ┌─────────────────────┐ ┌────────────────────────┐  │
│  │  SPINE (left)       │ │  FRONTIER + ACTIONS    │  │
│  │  (same as public,   │ │  (right)               │  │
│  │  +draft chapters    │ │                        │  │
│  │  +publish controls) │ │  Frontier: "Chapter 3  │  │
│  │                     │ │  · up to 44 BCE"       │  │
│  │  I   Published ✓    │ │                        │  │
│  │  II  Published ✓    │ │  [Write the next       │  │
│  │  III Draft      ●   │ │   chapter]  (primary)  │  │
│  │                     │ │                        │  │
│  │  [+ New chapter     │ │  [Preview draft]       │  │
│  │   via PromptDialog] │ │  [Share series]        │  │
│  └─────────────────────┘ └────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

On mobile, the right panel stacks below the spine.

### Component breakdown

**B1 — `SeriesDetailPage` (new route component).**
`src/routes/series.$id.tsx`. Auth-gated (same pattern as the canvas route, `requireOwned` in
the loader). Theme applied via `resolveThemeVars` as inline style on the page root — same as the
public series page.

**B2 — Shared `SeriesJacket` (reuse from A1).**
The same component works here with an additional `actions?: React.ReactNode` slot for owner
controls (status badge, share button, edit button). The jacket is pure presentational — it
takes a `series` prop and an optional `actions` slot.

**B3 — `SeriesSpineEditor` (extends `SeriesSpine` from A2, ~50 additional lines).**
Not a fork — an extension. The base `SeriesSpine` shows read-only rows. This variant wraps it
and adds, per row:
- A status badge: "Published" (accent-colored dot) vs. "Draft" (muted dot)
- For draft chapters: a "Publish" button (a small inline action, or accessible via a row `...`
  menu — keep it low-key, not a dominant UI element; the row click opens the chapter for reading
  or editing)
- The row is fully accessible: `role="row"` in the `<table>` or `<li>` in `<ul>`, `aria-label`
  includes both chapter title and status

**B4 — Frontier panel (new, ~30 lines).**
The right-column summary. Shows:
- "Frontier: Chapter N · up to [formatted date]" — derived from the loader data
- If no chapters yet: "No chapters yet — start with Chapter I"

This is a thin display component, not a smart one. The logic lives in the loader.

**B5 — "Write the next chapter" CTA (reuse `PromptDialog`/`PromptActions` seam).**
`SeriesCard.tsx` already does this exactly right: a `PromptSpec` built with `buildNextChapterPrompt`,
opened via `useState` + `<PromptDialog>`. The detail page reuses this verbatim — same spec,
same dialog, larger context. The only difference: the "Write the next chapter" button on the
detail page is the PRIMARY CTA (full-width, prominent) rather than an icon button in a card foot.
No new code needed here beyond placing the button and the existing `<PromptDialog>`.

**B6 — Draft preview (new, low-investment option).**
A "Preview draft" button that opens the latest draft chapter in the public `PublicStoryReader`
in an in-app modal (a `<Dialog>` wrapper around the reader). This is optional scope — a fast-
follow. Minimum viable: a direct link to `/s/$draftSlug` if the story has a slug but `isPublic`
is false (the page will gate and show "not available" — not great). Better: a modal reader.
Mark this as a follow-up unless the story is already publishable without it.

### The creator loop on this surface

1. Creator arrives at the series detail page from the home (by clicking a series card's title,
   or via a new "View series" option in `SeriesCard`'s foot)
2. Sees the jacket (their book, at scale), the spine (how far they've come), and the frontier
3. Clicks "Write the next chapter" → `PromptDialog` opens → they paste the prompt into Claude
4. Claude writes the chapter, calls `write_story` with `appendToSeries`, the chapter appears
   in the DB
5. Creator returns to the detail page (refresh or live update) → sees the new chapter in the
   spine → clicks "Publish" on the draft row → series updates
6. Creator clicks "Share series" → opens the public `/sr/$slug` page in a new tab to review

This loop is entirely possible with existing components and the new route. No new server
actions are needed beyond the `getSeriesDetail` loader.

---

## 5. Shared Primitives to Extract First

Before building either surface, extract these three shared pieces. They are small and unblock
both surfaces.

**X1 — `timeAgo` → `src/lib/time-ago.ts`.**
Currently duplicated (or used from) `PublicStoryReader.tsx`. Used by: jacket meta line, spine
recency badge, existing reader header. Three lines to extract.

**X2 — `toRomanNumeral(n: number): string` → `src/lib/roman-numeral.ts`.**
A small utility (a dozen lines) for displaying chapter numbers as Roman numerals I–XX+.
Used by: `SeriesSpine`, `SeriesJacket` (chapter eyebrow in the reader). Does not exist yet.
Cap at 20 (XX); beyond that, fall back to Arabic numerals. The series model technically
supports any count; Roman numerals past XX lose legibility.

**X3 — `SeriesJacket` component → `src/components/public/SeriesJacket.tsx`.**
Shared between the public season page (surface A) and the in-app detail (surface B). Keep it
in `src/components/public/` — the detail page can import from there. It's a presentational
component, no server imports.

---

## 6. Build Breakdown — Sequencing

### Recommended sequence

**Phase 1: Shared primitives (unblocks both surfaces)**
- X1: extract `timeAgo` (~10 min)
- X2: write `toRomanNumeral` (~15 min)
- X3: build `SeriesJacket` component (covers jacket spread, A1, reusable in B2) (~1.5h)

**Phase 2: local-162 — public season page redesign**
- Build `SeriesSpine` (A2) — replaces the existing `.psr-season` rail (~2h)
- Wire `SeriesJacket` + `SeriesSpine` into `sr.$slug.tsx` (~30 min)
- Add `chapterMeta` + `ctaLabel` props to `PublicStoryReader` for chapter opener (A3) (~30 min)
- Add `nextChapterTitle` prop to end panel (A4) (~15 min)
- CSS: `.sb-*` classes for the spine, `.sj-*` for the jacket (new namespace; don't overload `.psr-*`) (~1h)
- Update existing e2e `series-reader.spec.ts` (or equivalent) to assert jacket title + spine rows
- Estimated: 1 day total

**Phase 3: local-161 slice B — in-app series detail**
- `getSeriesDetail` server function in `src/lib/server/series.ts` (~1h)
- `src/routes/series.$id.tsx` route (B1) (~30 min)
- `SeriesSpineEditor` extending `SeriesSpine` with status/publish (B3) (~1.5h)
- Frontier panel (B4) (~30 min)
- Write-next-chapter primary CTA reusing `PromptDialog` seam (B5) (~30 min)
- Add "View series" link from `SeriesCard` foot to the new route (~15 min)
- Estimated: 1 day total

**Phase 4 (fast-follow): draft preview (B6)**
- Optional; defer unless the creator feedback confirms they want in-app draft reading before
  the first publish

### What to NOT do in this pass

- No new fonts (the display font stack is already registered via `@fontsource-variable` imports
  in `styles.css` — the gap is that the jacket elements don't USE `var(--font-display)`, not
  that the fonts aren't loaded)
- No new icon libraries
- No changes to `PublicStoryReader`'s core playback logic — only prop additions
- No in-app agent / server-side generation — the write-next-chapter CTA is copy-only (the
  existing `PromptDialog` pattern)
- No new DB columns — the detail page reads from what ADR 0006 already defines

---

## 7. Open Questions and Risks

**Q1 — Does the founder want the jacket spread above the reader, or should it be a separate
"landing" state that transitions into the reader?** The current design stacks them vertically
(jacket → spine → reader), which is safe and SSR-friendly. An alternative: the public page
initially shows ONLY the jacket + spine (no reader); the reader mounts when "Begin reading"
is clicked and the page scrolls to it. This is slightly higher-friction but gives the jacket
and spine more visual presence. Recommendation: start with the vertical stack; it's incrementally
improvable.

**Q2 — Roman numerals vs. Arabic chapter numbers.** The book language proposal uses Roman
numerals (I, II, III…). ADR 0006 D4 stores `chapterNumber` as a 1-based integer — compatible
with both. Roman numerals read as literary and intentional for short series (≤12 chapters);
they read as affected for long ones. Recommendation: use Roman numerals on the public page
(reader-facing, book language); use Arabic numerals on the in-app detail (creator-facing,
production language). The `toRomanNumeral` utility handles both with a format prop.

**Q3 — The `dateline` column in the spine requires a covered instant per chapter.** The
`PublicSeriesChapter` type (types.ts:388) carries only `chapterNumber` and the `StoryDTO`. The
story DTO carries `momentId` but not the resolved `startInstant` of that moment. To show a
year dateline in the spine, the loader needs to resolve each chapter's moment instant. This is
currently not returned in `getPublicSeries`. Risk: the loader needs a join or the client needs
to resolve from `nodes`. Recommendation: add `momentInstant: number | null` to
`PublicSeriesChapter` in the loader — a single-column addition, not a schema change.

**Q4 — The "Publish" action on the spine editor (B3) needs a server mutation.** `patch_story`
(ADR 0006 D6) has an `update_meta` op that can flip `isPublic`. On the in-app detail page,
this should be a direct RPC call (a `setChapterPublic` server function), not a round-trip
through the MCP tool. This is standard CRUD, paralleling `publishStoryShare` in the existing
`server/stories.ts`. Two dozen lines.

**Q5 — What does the "View series" affordance on `SeriesCard` look like?** Currently `SeriesCard`
opens `/sr/$slug` (the public page) for published series and is inert for drafts. The detail
page is an additional destination. Recommendation: the card's primary link (the cover image
area) navigates to the in-app detail (`/series/$id`), always. The "Open season" button in
the foot navigates to the public `/sr/$slug`. This makes the card's primary action creator-
facing, not audience-facing — a small but meaningful shift in who the home is designed for.

**Q6 — Texture on the jacket background.** The `theme.texture` key (`dots | grid | paper | none`)
is currently only applied on the canvas via React Flow's background pattern props. On the
public jacket, we want a subtle CSS background pattern. The existing
`--xy-background-pattern-color` var is wired for the canvas but could be reused for a
CSS `background-image: radial-gradient(…)` on `.sj-jacket`. Low risk — pattern is subtle
(opacity ~0.06) and purely decorative. Reduced-motion: patterns are not animated, so no
concern. WCAG: decorative, no contrast obligation.

**Q7 — Does `getSeriesDetail` expose draft chapter content to non-owners?** No — it must be
auth-gated at the entry point (same `requireOwned` pattern as every other owner route). The
public `getPublicSeries` is the read-only, filtered surface. This is standard ownership scoping
as described in ADR 0006 §constraints, and is a risk only if the two server functions are
confused. Recommendation: name them distinctly and add a test for the 403 path.

---

## 8. Accessibility Checklist

These are non-negotiable before shipping either surface.

- The `SeriesSpine` is a `<nav aria-label="Table of contents">` containing an `<ol>`. Each
  chapter row is a `<li>` with a `<button>` (not an `<a>` — selecting a chapter is a JS action,
  not a navigation to a new URL). `aria-current="true"` on the active chapter button.
- The jacket cover image carries the `alt` from `StoryImage.alt` (which may be empty — must be
  `alt=""` for decorative images, never omitted).
- The "New" badge in the spine is supplemented with a `<span class="sr-only">` containing the
  full text "Latest chapter, added 2 days ago" — the badge itself only shows "New · 2d ago"
  visually.
- The roman numeral column is marked `aria-hidden="true"` and the full "Chapter I" text is
  included in the button's accessible label via `aria-label="Chapter 1: [title], published"`.
  Screen readers get the semantic label; sighted users get the stylized numeral.
- The `SeriesSpineEditor`'s publish/draft controls have distinct focus styles (the existing
  `focus-visible:ring-2` pattern from shadcn/ui is sufficient).
- The in-app detail page title (`<h1>`) is the series title. The breadcrumb is a `<nav aria-label="Breadcrumb">`.

---

## 9. Design Principles Alignment

Against the three principles I hold for Synek's creator-facing surfaces:

**"The creator's world, not the app's features."** The evolving book system puts the series
artifact — the jacket, the spine, the growing chapter count — at the center. The production
metadata (beats, depth tier, MCP tools) moves to the margin or disappears from public surfaces.
Aligned.

**"Invisible craft."** `resolveThemeVars` already emits `--font-display`. The jacket and spine
just need to USE it. The mechanism is invisible; the result should feel like the creator designed
their own book cover. Aligned — contingent on X3 actually doing this.

**"Growth you can see."** The spine is literally a record of accumulation. The recency badge
("New · 2d ago") is the live pulse that makes the "evolving" part of "evolving book" concrete.
This is the load-bearing UX claim for P3 — if the spine doesn't communicate growth visibly,
the pitch falls flat. Aligned — but only if Q3 (the dateline) and the "New" badge are both
implemented. A spine with no datelines and no recency markers is just a list.

---

*It ships. But right now it doesn't sing. These changes make it sing.*
