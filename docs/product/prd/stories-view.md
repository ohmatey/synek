---
project: "Synek"
track: "Stories view (the narrative front door)"
status: "built (2026-06-13)"
authors: ["Margot (product)", "Wren (UX)"]
updated: 2026-06-13
---

# Stories View — a first-class lens for reading

> **One-line promise:** a third tab beside Timeline and Globe that lists every story on
> the timeline and plays it by itself, with the timeline (and later the globe) as its stage.

**Status:** built (this pass). Front-end + a one-column data add; no migration. Verified by
`bun run typecheck` + `bun run build` + `e2e/stories-view.spec.ts` (plus the existing
story-reader / canvas / globe specs as regression).

---

## 1. Context / Why now

Stories are **invisible**. To reach one today you must know which node holds a story (the
only signal is a depth badge on the node), click it, find the story in the entity panel's
list, then Play — four steps, no way to browse. The one shortcut, the `StoriesMenu`
toolbar popover, was buried among history/settings chips and *still* coupled playback to
the node: opening a story force-selected its moment and forced the entity panel open
beside the reader.

The founder's distribution thesis makes this load-bearing: **the story is the unit you
share**, with the timeline and globe as immersive *accessories* the story drives. The app's
shape was inverted — the timeline was the object and the story was buried inside it. This
promotes the story to a first-class navigation surface and decouples it from the node it
happens to hang off.

This is **not a new S-phase.** It is the navigation surface that completes **S1 (story
spine)** — independent of S2 (artifacts) and S3 (multi-POV). It is **Core UX** (single-user,
local-first), not commercialization, so it sits inside the lovable-core guardrail. It is the
strongest single investment in bet **B3 ("stories make it a product")** and the first
local-Core expression of bet **B2** (story-as-hero).

## 2. Goals & Non-goals

**Goals**
- **G1** Surface every story on a timeline in a browsable list (replaces the `StoriesMenu` button).
- **G2** Decouple the reader from canvas selection — a story runs by itself; entity panels never auto-open.
- **G3** Timeline-as-stage on Play — the main area becomes the story's timeline; the story drives the camera.
- **G4** First-class view status — the Stories tab sits in `ViewSwitcher` at parity with Timeline + Globe, URL-backed (`?view=stories`).
- **G5** Create-via-prompt — the empty state and "New Story" hand the user a copy-prompt (the app has no in-app AI).

**Non-goals (v1) — explicit cuts**
- **In-app AI generation.** Stories are authored by the user's MCP client via `write_story`. The inversion is the architecture.
- **Public sharing / export of a story as a distributable artifact.** This is the *north-star* (the thing you hand someone), but it needs the deferred sharing gate — out of v1 scope.
- **Globe-as-stage.** Play always raises the *timeline* as the stage in v1. The globe story machinery (GS1 `storyFocus`) already exists; wiring Play to choose it per beat is a fast-follow.
- **Multi-POV switcher (S3)**, list **search / filter / sort**, and **per-beat hover preview** — all fast-follows.

## 3. Personas / JTBD

- **The enthusiast, reading.** "Show me everything I've built — let me survey my stories and pick one to read in one click, without hunting for the node."
- **The enthusiast, building.** "Show me coverage — which moments have stories — and let me copy a prompt to write the next one without app-switching."
- **The reader of a shared story** (forward-looking; not a v1 delivery). In v1 this is the same local user; v1 builds the navigation surface that will become the shared-story landing page once sharing ships.

## 4. User stories & acceptance criteria

- **US1 — First-class tab.** `ViewSwitcher` shows Timeline · Globe · **Stories** (`BookOpen`). Clicking it sets `?view=stories`; the route's `view` enum accepts `'stories'`; deep-links + reload work.
- **US2 — The list.** `listStoriesForTimeline` renders one card per story in chronological moment order. Each card: title, hook, moment title, depth (`Deep` badge) + POV (non-omniscient only), beat count, est. minutes, and a cover thumbnail when present. Re-fetches on the graph's `storyVersion` signature (so stdio/MCP writes appear).
- **US3 — Empty state.** Zero stories → a centered state (not a blank screen). Owner: explainer + a **New Story** CTA (copy-prompt via `NewStoryDialog`). Viewer: passive "The author hasn't written any stories on this timeline yet."
- **US4 — Click → cover docks right.** Clicking a card sets `?story=<id>` and docks the reader's **cover** on the right; the list stays in the main area; **no** `?node=` is set and **no** entity panel opens. The open card is marked `data-open`. With no entity panel, the reader docks flush at the right edge (`data-solo`).
- **US5 — Play → timeline-as-stage.** Pressing Play raises the timeline as the stage (`?view` → timeline) and the story drives the camera per beat (existing `StoryCamera`). Beat nav (taps / arrows / progress bar) unchanged.
- **US6 — Decoupled entity panels.** During a story, tapping a cast chip or related-node link opens that entity's panel **beside** the reader (the reader slides left) **without** ending the story; closing the panel keeps the story playing. The panel shows full detail (not the old stripped beat-portrait) and never auto-follows the beat.
- **US7 — Close → return to list.** Closing the reader (Esc / X) clears `?story=` and restores the view the story was opened from: from the Stories list → back to the list; from a node panel → stays on the timeline.
- **US8 — Replace StoriesMenu.** The toolbar popover is removed; its two jobs (list + create-prompt) live in the Stories view.

## 5. Design / UX (Wren)

**Surfaces.** `StoriesView` is a sibling of the timeline + globe surfaces — a full-bleed
panel (`position:absolute; inset:0; z-index:1`) that scrolls, with a centered reading column
(`max-width:640px`). The docked reader (z6) overlays it on the right, so when a cover is open
the list simply has less horizontal room.

**Card.** A medium-density `.story-list-card` `<button>` (the click *is* the play affordance —
no redundant inline Play). Cover thumbnail is a 48×64 left accent when the story has one;
cards without art are unchanged. The currently-open story's card gets `data-open` (stronger
border) as the selection cue.

**Empty state.** `.stories-empty`, vertically centered: a `BookOpen` glyph, "No stories yet",
a one-line explainer, and (owner only) a primary **New Story** CTA opening `NewStoryDialog`.
From the list level no anchor moment is pre-set — the user picks the moment in the dialog.

**Choreography.** Click a card → `dock-slide-in` cover on the right, list stays. Selecting a
different card re-keys the reader (cover of the new story). **Play** → the timeline mounts as
the stage behind the reader and the camera tours beats. The view switcher stays usable during
playback (the reader is an overlay on `.canvas-root`, surviving view switches). Close → return
to the entry view.

**Decoupling.** The reader runs with **no** entity panel by default. Opening one (cast chip /
related-node link / canvas click) is a deliberate side-trip: the reader slides from its
flush-right `data-solo` slot to left-of-panel (CSS `transition: right`); the entity shows full
detail; closing it slides the reader back and the story keeps playing.

**A11y / motion.** `.stories-view` is a `<section aria-label="Stories">`; the list is a
`role="list"` of cards with descriptive `aria-label`s. The switcher keeps its `role=radiogroup`
pattern (the third radio is additive). The reader keeps `role="dialog"` + `aria-label`. All
dock animations and the skeleton pulse respect `prefers-reduced-motion`.

## 6. Architecture / implementation notes

- **Data (one column, no migration).** `StoryDTO` gains `momentId`; `StoryListItem` gains `coverImage`. `hydrateStory` returns `momentId`; `listStoriesForTimeline` selects `cover_image`. RPCs (`listStories`, `getStoryById`) are unchanged in shape otherwise.
- **The decoupling.** `node` (`?node=`) now means *only* "the entity panel the user opened." Playback keys on `?story=` + the loaded `readingStory.momentId`:
  - `openStory(storyId)` sets only `?story=` (records the entry view in `storyReturnViewRef`); `closeReader()` clears it and restores that view.
  - The story camera/lens anchor is `readingStory.momentId`, not `selectedId`; the detail panel is `selectedNode` and never auto-follows the beat.
  - Selecting a node no longer closes the reader; the reader's cast/related taps open an entity beside it.
  - The reader gains `onStart` (Play → `setLensView('timeline')`) and `solo` (→ `data-solo`).
  - A loaded-but-missing story (`readingStoryData === null`, e.g. its moment was deleted) tears the reader down.
- **Files.** `StoriesView.tsx` (new), `ViewSwitcher.tsx` (+`'stories'`), route `view` enum, `TimelineCanvas.tsx` (three-way branch, decouple, `StoriesMenu` removed), `StoryReader.tsx` (`onStart`/`solo`, open-beside), `domain/story-labels.ts` (shared `POV_LABEL`), `db/stories.ts` + `domain/types.ts` (DTO fields), `styles.css` (`.stories-view*`, `.story-list-card`, `.stories-empty`, `.story-reader[data-solo]`). `StoriesMenu.tsx` deleted.

## 7. Success metrics

Rides the existing PostHog seams. New client event **`story_view_opened { timeline_id }`** —
the navigation denominator for B3. Plays/completions continue on the reader's existing
`story_started` / `story_completed`. B3 reads: ≥40% of week-2+ returning sessions open the
Stories view; story plays increasingly enter via the Stories list rather than the node panel.

*Recommended fast-follow events (not in v1):* `story_list_card_clicked`,
`story_play_started{entryPoint}`, `story_cast_member_tapped`, `story_create_prompt_copied`.

## 8. Risks / open questions

- **Ambient timeline behind the cover.** While `?view=stories` shows a docked cover, the main
  area is the *list* (resolved: list stays; not the timeline). If users try to interact with the
  list under the reader and find it cramped, revisit (a fast-follow signal, not a v1 blocker).
- **Entry-view restore.** Bailing to Timeline/Globe mid-cover, then closing, returns to the
  *original* entry view (the list). Acceptable; revisit if it surprises.
- **Interlocking effects.** The decouple touches several `TimelineCanvas` effects (selection,
  camera anchors, teardown). Mitigation: the in-timeline "play from node panel" path is kept
  behaviorally identical and covered by the existing `story-reader` e2e.

## 9. Bets note

Advances **B3** (primary — stories become the thing you navigate *to*, not find by accident)
and **B2** (secondary — story-as-hero, timeline-as-stage). Records a side-bet for the Bet
Council: **"story-as-nav-object > story-as-node-annotation."** Kill signal: the Stories tab is
ignored (low `story_view_opened`) while node-panel access stays primary — in which case the
response is to enrich the stories (cover, search), not revert the navigation model.

## 10. Fast-follows

Globe-as-stage per beat · story search / filter / sort · per-beat hover preview ·
shareable read-only story URL (the north-star distribution artifact, behind the sharing gate).
