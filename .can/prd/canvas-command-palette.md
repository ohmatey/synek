---
phase: NAV
title: "In-canvas search + ⌘K command palette + filter"
status: "built 2026-06-11 (search · actions · filter); verified in prod-build preview (typecheck + build green)"
era: "Story Layer (the pivot)"
updated: 2026-06-11
roadmap: NEXT.2 (· S3.4 Talk-to front door)
---

# NAV — In-canvas search + ⌘K command palette

> **Press ⌘K, type a name, land on it — or run an action.** Once a timeline outgrows one screen, "where is Marcus Aurelius?" must have a one-keystroke answer. The palette searches every node already on the canvas and flies the camera to the one you pick; it also runs **actions** (talk to an entity, improve the timeline) that hand you a ready-to-run prompt. A toolbar **filter dropdown** controls which node kinds show.

## Why this, why now

The home screen got search in the list redesign (`a302e99`), but the **canvas itself has none**. The moment a built timeline passes ~30 nodes, finding a specific moment means manual pan-and-scan — the single biggest friction for a returning user, and the first thing that makes a dense, successful timeline feel *worse* to navigate than a sparse one. It is the cheapest high-leverage win on the NEXT board: no schema, no MCP contract change, no server work, and it makes every other canvas feature more reachable.

It also lays a **reusable surface**: the same ⌘K is the natural future home for artifact recall (**S2.5 `search_artifacts`**) and for command-actions (create, jump-to-story, toggle settings) — see *Extends to*. Building it now means those land as new result groups, not a new UI.

## The experience

- A frosted **search chip** sits at the left of the canvas toolbar showing a `⌘K` hint. Click it, or press **⌘K / Ctrl-K anywhere** on the canvas, and a command palette opens centered over the canvas.
- Type a fragment of a **title, summary, or place** — results filter live, grouped by kind (**Periods · Entities · Concepts · Events**), each row carrying a kind/subtype icon, the node title, its location (when set), and its date. Unfiltered, each group reads **chronologically**, mirroring the timeline.
- **↑/↓** move, **Enter** (or click) selects. On select the palette closes, the canvas **pans and centers** on the node (framed in the visible area *left* of the docked detail panel, not under it), and the node's **detail panel opens**.
- An **Actions** group sits at the top, **fully populated even with no input**: "Improve this timeline…" plus a "Talk to {name}" per entity. Selecting an action opens a shared **PromptDialog** showing the action's title, description, the parameters it was built with, and a copyable prompt to paste into your Claude.
- The PromptDialog carries an **"add context" field** — a free-text box (framed per action, e.g. "Ask {name} something, or set a focus") where the user types extra direction the way they'd message a chat assistant. On copy it's appended to the prompt under a labeled heading, so the same dialog adapts from a one-click prompt to a guided one.
- A **"Filter results" menu inside the palette** (below the input) is a multi-select over the result categories present — Actions + each node group (Periods · Entities · Concepts · Events) with counts. Untick a category to drop that whole group from the list; a `n/total` badge marks an active filter, with "Show all" to clear. This is palette-local — it narrows the result list only, independent of the canvas.
- A separate toolbar **filter dropdown** (multi-select, next to search) controls which kinds show **on the canvas** (Periods · Events · Concepts · People · Orgs · Places · Works) with counts; a badge marks how many are hidden.
- **Esc** or click-outside closes; focus returns to the trigger.

## Goals

- One keystroke from anywhere on the canvas to a searchable list of every node.
- Match on **title + summary + location**, with kind/subtype as secondary signal; instant, client-side, no fetch.
- Selecting a result **navigates** — camera + detail panel — reusing the exact framing the story camera and the panel's Focus button already use, so it feels native.
- Full keyboard operation and correct dialog a11y (focus trap, labelled, focus restore).

## Non-goals (explicitly deferred)

- **In-app prompt execution.** Actions produce a **copyable prompt** (the inversion — the user's Claude runs it). The `PromptDialog` is the deliberate swap-point for a future hosted "Run" that calls a generation API; not built now.
- **A large action catalogue.** Two actions ship (Improve, Talk-to); the registry is built to extend (add-a-perspective, new-story, jump-to-export, open-settings…) but those aren't in this slice.
- **Artifact / story / cross-timeline search.** Searching artifacts is **S2.5** (`search_artifacts`, FTS-first — see `s2-artifact-grounding.md`); searching across timelines is a home-screen concern. This palette is scoped to the *open* timeline's graph.
- **Server-side full-text search / a search index.** The whole graph is already in client memory; an in-memory filter is correct at single-user Core scale. A server FTS pass is only justified if a single timeline ever holds thousands of nodes — and would mirror the same FTS-first / vector-deferred discipline written into S2.5. Not now.
- **Fuzzy-ranking tuning, recents/pinned, search history, mobile-specific UX.** Out of this slice.

## How it works (architecture)

A **pure client, read-only** feature — it touches no schema, no server RPC, no Patch/undo path, and no MCP contract. It rides entirely on data already loaded.

- **Data source — zero new fetch.** `TimelineCanvas` already loads the full graph via `useQuery(['graph', timelineId])` into `gnodes` (`GraphNode[]`, carrying `title`, `summary`, `location`, `type`, `subtype`, `startInstant`, `precision`). The palette reads that array directly.
- **Search — `cmdk` (shadcn `Command`).** Each `CommandItem` uses `value={node.id}` (unique, stable) with `keywords=[title, summary, location, type, subtype]`, so cmdk's scorer matches the human text while selection identity stays collision-free. cmdk also gives arrow-key nav, type-ahead, and listbox/combobox a11y for free.
- **Shell — Radix Dialog (the project's `Dialog`), via a new shadcn `command.tsx`.** Radix (not native `<dialog>`) sidesteps the StrictMode `showModal` self-close gotcha *and* its focus trap means the open palette can't leak Esc/arrow keys to the `StoryReader` aside — it closes cleanly and restores focus to the trigger.
- **Navigation seam — `flyToId` + `FlyToCamera`.** `centerOnNodes()` (in `cameraFocus.ts`) reads `.detail-panel` / `.react-flow` from the DOM and must run inside `ReactFlowProvider` — which a Radix-portaled dialog is *outside* of. So selection sets a one-shot `flyToId` in `TimelineCanvas`; a tiny inner `FlyToCamera` component (rendered inside `<ReactFlow>`, mirroring the existing `StoryCamera`) **rAF-polls until two things settle** before framing: the target node is measured (it may have just remounted after un-hiding its kind) *and* the dock's left edge stops moving (the detail panel slides in via `dock-slide-in`, a 260 ms `translateX` that `getBoundingClientRect` reflects — measuring mid-slide would frame the node where the panel is about to be). Then it calls `centerOnNodes(rf, [id], { duration: 450 })` and clears the target. Under `prefers-reduced-motion` (animation disabled) it settles on the second frame, so it still feels instant.
- **Filter-aware select.** If the chosen node's kind is currently hidden by the canvas kind-filter, `flyTo()` reveals that kind first, so the camera never chases an unrendered node.
- **Actions + shared `PromptDialog`.** Actions build a `PromptSpec` (`{ title, description, params[], prompt }`) from the timeline context; selecting one closes the palette and opens the presentational `PromptDialog`. Prompt strings come from `src/lib/*-prompt.ts` builders (`buildTalkToPrompt`, `buildImproveTimelinePrompt`), siblings of the existing `story`/`timeline` builders. **Dialog sequencing:** the prompt opens ~260 ms *after* the palette closes — opening a second modal dialog while the first animates out makes Radix mark the closing one inert mid-exit, so it never unmounts (stacked overlay). The delay clears the 200 ms close animation first.
- **Filter dropdown — `FilterMenu`.** A toolbar `DropdownMenu` of `DropdownMenuCheckboxItem`s over the present kinds (`kindToken`/`kindCounts`), driving the same `hiddenKinds` state the canvas already filters on. `onSelect` is `preventDefault`-ed so the menu stays open across multiple toggles. This **replaced** the kind-filter that used to live buried in the View-Settings popover — one discoverable home.

**Touched files:** `src/components/ui/command.tsx` (new), `src/components/canvas/CommandPalette.tsx` (new), `src/components/canvas/FilterMenu.tsx` (new), `src/components/PromptDialog.tsx` (new, shared), `src/lib/talk-to-prompt.ts` (new), `src/lib/timeline-prompt.ts` (+`buildImproveTimelinePrompt`), `src/components/canvas/CanvasSettings.tsx` (filter section removed), `src/components/canvas/TimelineCanvas.tsx` (wiring). Dependency added: `cmdk@1.1.1`.

## Key decisions

| Question | Decision | Why |
|---|---|---|
| In-memory filter vs server FTS? | **In-memory.** | The full graph is already loaded; at single-user scale a filter is instant and a server index is premature (same logic as S2.5's FTS-first stance, one level simpler). |
| `cmdk` vs hand-rolled palette? | **`cmdk`.** | Project is shadcn/ui new-york; cmdk is the canonical primitive and gives keyboard nav + combobox a11y for free — cheaper *and* more correct than reimplementing focus/aria. |
| cmdk item `value`? | **`node.id` + searchable `keywords`.** | Guarantees unique selection identity (titles can collide); keywords carry the human-searchable text so title/summary/location all match. |
| ⌘K guarded against text inputs? | **No guard — always toggles.** | ⌘K is modifier-invoked, so it's a deliberate reach for search even from a field; guarding is for bare single-key shortcuts. Matches Linear/Raycast/VSCode and shadcn's own example. |
| Radix Dialog vs native `<dialog>` vs bare modal? | **Radix Dialog.** | Avoids the StrictMode self-close gotcha, and its focus trap prevents Esc/arrow bleed into `StoryReader`; gives focus restore. |
| Select a kind-filtered node? | **Reveal its kind, then fly.** | Otherwise the camera targets a node React Flow isn't rendering. |
| Camera call site? | **Inner `FlyToCamera` inside `ReactFlowProvider`.** | A portaled dialog can't use `useReactFlow`; the `flyToId` seam keeps the camera call where the context lives, reusing `centerOnNodes`. |
| Action → prompt, both modal dialogs? | **Sequence: close palette, then open prompt (~260 ms).** | Overlapping modal Radix dialogs inert the closing one mid-exit → it never unmounts (stacked overlay). Sequencing past the close animation avoids it. |
| Talk-to actions in the resting list? | **Show all, even with no input.** | Discoverability — every action is visible on open; the in-palette "Filter results" menu collapses categories (incl. Actions) when the list is too long. |
| Two filters (palette results vs canvas)? | **Both, separate.** | "Filter results" narrows the ⌘K list only; the toolbar dropdown controls canvas visibility (`hiddenKinds`). Conflating them would break "search finds a hidden node and reveals it." |
| Canvas filter: new dropdown vs keep in View-Settings? | **Dedicated toolbar dropdown; removed from settings.** | One discoverable home for "what shows"; the settings popover keeps scale/live/narration. |
| Prompt execution today vs hosted? | **Copy-only now; `PromptDialog` is the swap point.** | The inversion: the user's Claude runs it. When hosted, the copy button becomes "Run" → generation API (carrying the base spec + typed context), local to one file. |
| User-added context — edit the prompt or a separate field? | **Separate "add context" field, appended on copy (`composePrompt`).** | Chat-assistant model: base prompt is the instruction, the field is your message. Non-destructive, framed per action, and the hosted "Run" sends it as the user turn. |

## UX surfaces

- **Trigger:** a `floatChip`-styled toolbar button (`Search` icon + `⌘K` kbd), first item in `.canvas-toolbar`, shown only when the timeline has ≥1 node. Tooltip: "Search nodes · ⌘K".
- **Palette:** centered Radix dialog; search input with placeholder, grouped results, empty state ("No matching nodes."), per-row icon · title · (location) · date.
- **Result of selection:** glide-pan + center (450 ms) + detail panel open. No change to the saved camera default (it's a transient navigation, like the Focus button).

## Extends to (future, not this slice)

- **Hosted "Run"** — `PromptDialog`'s copy button becomes a "Run" that POSTs the `PromptSpec` to a generation API when Synek is hosted. Single swap point; callers untouched.
- **More actions** — the registry takes more `PromptSpec` producers: add-a-perspective (S3), new-story-on-selected, jump-to-export, open-settings. Each is a label + keywords + `makeSpec`.
- **S2.5 artifact recall** — when `search_artifacts` lands, add an **Artifacts** group so ⌘K recalls a registered source and jumps to it / cites it. The palette already groups heterogeneous result kinds.
- **Server FTS** — only if an individual timeline ever holds thousands of nodes; swap the in-memory filter for a `query_timeline`-backed source behind the same UI.

## Done when

- [x] ⌘K opens the palette from anywhere on the canvas; the toolbar chip opens it too.
- [x] Typing filters across title + summary + location for all four node kinds; grouped, with an empty state.
- [x] Enter/click pans + centers the canvas on the node **and** opens its detail panel — including when the node was hidden by a kind filter (the kind is revealed first).
- [x] Esc / click-out close; focus returns to the trigger on every close path (explicit restore — Radix alone loses it on the ⌘K keyboard-open path); no regression to ⌘Z/⌘⇧Z or story-reader keys (Radix focus trap).
- [x] **Actions:** "Improve this timeline" + a "Talk to {entity}" per entity, all shown with no input; selecting opens the shared `PromptDialog` with title + description + params + copyable prompt. *(Verified in preview: 14 actions visible on open.)*
- [x] **Prompt context field:** every PromptDialog has a free-text box (framed per action); typed context is appended under a labeled heading on copy. *(Verified: copying "Talk to Zeno" with context produced base prompt + heading + the typed text.)*
- [x] **In-palette "Filter results" menu:** multi-select over Actions + present node groups with counts; unticking a category drops its group from the list, the menu stays open, an `n/total` badge + "Show all" mark the active filter. *(Verified: toggling Actions off removed the group, badge → 3/4.)*
- [x] **Canvas filter dropdown:** multi-select over present kinds with counts; toggling a kind shows/hides its nodes and the menu stays open; hidden-count badge updates; removed the redundant filter from View-Settings. *(Verified: People off → 19→10 nodes.)*
- [x] No schema, RPC, Patch, or MCP change; no new fetch. `typecheck` + `build` green.
- [x] Adversarial code review triaged: fixed the `dock-slide-in` measurement race (settle-poll), the un-hide measurement race (same loop), focus restore on close, and `onArrive` closure/clear safety; declined re-fly idempotency (re-centering on explicit re-search is intended) and the pre-existing per-`Tooltip` provider pattern (out of scope).
- [x] **Live in-browser pass (prod build):** verified against the `e2e-build` preview (a *production* build hydrates, unlike the dev server) — hydration, search chip + filter render, multi-select hides/shows nodes, ⌘K opens with Actions + node groups, Talk-to surfaces on search, and an action opens the PromptDialog (screenshot captured). Note: the automation tab backgrounds, which throttles `setTimeout`/`animationend` — so closed dialogs don't *unmount* in automated observation (a foreground-browser artifact, not a product bug).

## Open questions

- Should the trigger live left-of-toolbar (current) or be a floating affordance near the canvas controls? (Lean: keep in toolbar for discoverability; revisit if the toolbar crowds.)
- Do we want a "no results, but N nodes hidden by filters" hint when the only matches are filtered out? (Cheap; defer until someone hits it.)
- Large-timeline ceiling: at what node count does the unfiltered list want virtualization or `useDeferredValue`? (Not a concern for current seeds; measure before adding.)

## Dependencies

None at the data layer. Client-only; reuses `centerOnNodes` (`cameraFocus.ts`), the graph already loaded by `TimelineCanvas`, and the shadcn `Dialog`. Adds `cmdk`. Forward-links to **S2.5** (`s2-artifact-grounding.md`) as the first non-node result source.
