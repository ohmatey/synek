---
name: next-chapter
description: "Write the next chapter of a Synek series — the morning-chapter loop. Use when the user runs /synek:next-chapter, asks to write/continue/advance the next chapter of a story or series, to grow a serialized story a chapter at a time, or to start a new serialized series. Reads the series in order, optionally grows the timeline with new researched+cited nodes, then writes the next chapter as one beat-rich story — never repeating what earlier chapters already covered."
argument-hint: <series>  (title or id — e.g. "The Rise of Caesar". Omit to pick from a list, or describe a new series to start.)
allowed-tools: ["mcp__plugin_synek_synek__list_projects", "mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_series", "mcp__plugin_synek_synek__get_series", "mcp__plugin_synek_synek__get_layout_report", "mcp__plugin_synek_synek__query_timeline", "mcp__plugin_synek_synek__get_node", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__write_story", "mcp__plugin_synek_synek__patch_story", "mcp__plugin_synek_synek__set_series_public", "mcp__plugin_synek_synek__register_artifact", "mcp__plugin_synek_synek__search_artifacts", "WebSearch", "WebFetch"]
---

# /synek:next-chapter — write the next chapter of **$ARGUMENTS**

A **series** is a serialized story told one **chapter** at a time. Each chapter is a Synek story (a moment + ordered beats) linked into the series in order. This skill is the **morning-chapter loop**: you read where the series is, decide what happens next, *optionally grow the world to support it*, and write the next chapter — then hand back the season link.

There is no agent inside Synek. **You** are the writer — the app is the canvas + reader, your MCP client is the brain. The cadence is yours (run it when you like; to set up a *recurring* keeper-chapter loop end-to-end — scope brief, private series, schedule — use `/synek:follow`). The app holds only the durable parts: the series order and a coverage watermark. Everything else — the research, the prose, the choice of what happens next — is this run.

Read the `building-timelines` skill first for the `apply_patch` op shapes (used only when you grow the timeline) and the `write_story` beat/cast/widget shapes. This skill focuses on the part unique to serialization: **advancing the story without repeating earlier chapters.**

---

## 0. New series, or continue one?

- **Continue a series:** `$ARGUMENTS` names one → `get_series` to load it (try it as an id; if that's not it, the user gave a title — find the project's series via `get_series` on the ids from the relevant project, or ask). If empty/ambiguous, list the user's series and ask which.
- **Start a new series:** the user describes one with no existing series → pick the project (`list_projects`; create one only if asked), then `create_series` (title + a one-line `hook`, optional `coverImage`/`theme`). Then write **Chapter I** with the loop below (the frontier is just empty).

If `get_series`/`list_projects` error, stop and run `/synek:setup` — don't write against a dead server.

## 1. Read the frontier (the dedup baseline — do not skip)

Call **`get_series`** for the series id. It returns the chapters **in order** (title, hook, status, the node ids each already references) and a **derived `frontier`**: the highest `chapterNumber` and the **latest instant** any covered node sits at. This is your watermark — the next chapter advances *past* it.

Then call **`get_layout_report`** for the series' timeline (the graph-side watermark): the compact node index, lane health, era/story coverage, and the source registry. Between the two you know **what's already been narrated** (series) and **what the world already contains** (graph). The next chapter must add to one or both, not repeat them.

## 2. Decide what the next chapter is

A good next chapter does one clear thing the series hasn't: the next era, the next campaign, the consequence of the last chapter, a parallel thread that's now due. Anchor it on a **moment** (a node):
- usually a node that exists on the timeline and hasn't anchored a chapter yet, or
- a node you're about to create (if you're growing the world — step 3).

State the chapter's spine in one sentence before writing it (the through-line, the moment it anchors on, where it leaves off). Keep it *after* the frontier instant unless the user explicitly wants a flashback chapter.

## 3. Grow the world — ONLY if asked (opt-in, not default)

**Default: narrate over the existing graph.** The chapter tells a new story about nodes that already exist. No `apply_patch`.

**Opt-in: grow the timeline.** If the user wants the world to expand (or the next chapter genuinely needs events/entities that aren't on the canvas yet), then *first*:
1. `WebSearch`/`WebFetch` for the real, citable developments the chapter needs — scoped to the gap after the frontier, primary/authoritative sources.
2. Diff against the `get_layout_report` node index — add **only** what's genuinely missing (match the real event, not the wording).
3. `apply_patch` **one** batch of the new nodes + edges, each **cited**, dated `summary` (e.g. `"Chapter VII setup — +4 events"`). `register_artifact` for substantive sources (`search_artifacts` first to avoid dupes).

This step rides the normal Patch invariant: one batch = one undoable Patch. If the user wants the chapter to fit strictly within the current timeline, **skip this entire step.**

## 4. Write the chapter

`write_story` with **`appendToSeries: <seriesId>`** — that links it as the next chapter and auto-assigns the chapter number (no need to track order). Pass `momentId` (the anchor from step 2). Make it a real chapter, not a stub:
- **Beats** that move: ground every factual beat in a `citation` (an `artifactId` from step 3, or an inline `{ title, url, quote }`). Stories without sources are just plausible fiction.
- **Cast**: list the chapter's key figures (node-backed `{ nodeId }` where they exist; name-only entries come back as warnings so you can materialize them).
- **Camera**: set per-beat `focusNodeId` to tour entities, and `lens` (`globe`/`timeline`) to choreograph place vs. time beats.
- **Art/widgets** where they earn their place: a `coverImage`, a per-beat `image`, or a live `widget` (mini timeline/globe/entity).
- Carry the **series voice** — match the tone and depth of the earlier chapters you read in step 1.

To **fix** a chapter you just wrote (a typo, a missing beat, a reorder) without rewriting the whole thing, use **`patch_story`** with surgical ops — not another `write_story`.

## 5. Publish (optional)

If the user wants the season shareable, `set_series_public` → the page is live at `/sr/<slug>`, chapters playing in order. Per-chapter visibility is separate; publishing the series is the one switch for the season page.

## 6. Report honestly

Tightly:
- **Chapter N — "<title>":** the spine in one line, the moment it anchors on, beat count.
- **Grew the world:** the nodes/edges added (with dates), or *"narrated over the existing timeline — no new nodes"* if you didn't.
- **Unverified:** anything you couldn't confirm a date/source for — report it as *unverified*, **never invent** a date or citation. A fabricated chapter is worse than a thinner one.
- The season link: `<origin>/sr/<slug>` (origin is `http://localhost:3001` locally, or the hosted base URL — `SYNEK_MCP_URL` minus `/api/mcp` — when the plugin points at a deployed Synek).

---

## Quality bar

A next-chapter run is good when: it **advanced** the series (a clearly new chapter past the frontier, never a repeat of an earlier one), every factual beat is **cited**, the chapter **anchors on a real moment** and carries the **series voice**, and — if the world grew — the new nodes are **dated, cited, deduped, and in the right lanes** as one Patch. Writing a chapter that retells what Chapter N-1 already covered, or inventing events to pad it, is a failure even if every tool call succeeded. If there's genuinely nothing new to tell yet, **say so** rather than manufacture a chapter.
