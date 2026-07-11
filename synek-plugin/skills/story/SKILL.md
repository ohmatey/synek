---
name: story
description: "Tell an immersive Synek story on a timeline moment — cast, cited beats, camera choreography across the globe and timeline, and an optional share link. Use when the user runs /synek:story, asks to tell / narrate / write a story about a topic or a moment on a timeline, to turn a timeline into a story, or to make a shareable story. Standalone stories only — for serialized chapters use /synek:next-chapter, for brand voice use /synek:brand-story."
argument-hint: <topic or moment>  (e.g. "the fall of Constantinople" or "the ChatGPT launch on my AI timeline")
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_timeline", "mcp__plugin_synek_synek__query_timeline", "mcp__plugin_synek_synek__get_node", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__write_story", "mcp__plugin_synek_synek__patch_story", "mcp__plugin_synek_synek__set_story_theme", "mcp__plugin_synek_synek__set_timeline_theme", "mcp__plugin_synek_synek__register_artifact", "mcp__plugin_synek_synek__search_artifacts", "WebSearch", "WebFetch"]
---

# /synek:story — tell the story of $ARGUMENTS

A Synek **story** is an ordered list of beats attached to a **moment** (a node); the canvas plays it back in a docked reader, choreographing the camera as it goes. This is the product's centerpiece — the map is the world, the story is the tour. Your job is a story someone wants to *share*, not a caption on a node.

Read the `building-timelines` skill first — it has the `apply_patch` op shapes (for staging the world) and the `write_story` beat/cast/lens/widget craft this skill builds on. If `list_timelines` errors, stop and run `/synek:setup`.

## Steps

1. **Find the stage.** Which timeline, and which moment anchors the story?
   - An existing timeline → `list_timelines` + `query_timeline` to find it and pick the anchor node (`get_node` for its full context, edges, and any existing stories — a moment can hold several).
   - No timeline yet → this is a map-then-tell: build a compact graph first (follow the `map` skill; `create_timeline` returns the viewer `url`), then anchor on its strongest moment.

2. **Stage the world so the story can play.** Before writing, make sure the graph supports the telling — one `apply_patch` if anything's missing:
   - **Cast exists as nodes.** Materialize the story's key characters as `entity` nodes (with `subtype`, a summary, a real portrait in `images` where one exists) — node-backed cast beats name-only cast.
   - **Place beats can reach the globe.** Nodes you'll focus during place beats need `lat`/`lng` (or an honest `geoScope`). No coordinates, no globe shot.
   - Research with `WebSearch`/`WebFetch` for the facts and citable sources; `register_artifact` the substantive ones (`search_artifacts` first to avoid dupes).

3. **Write it — one `write_story` call.** Pass `momentId`, a `title` + `hook`, the `cast`, an optional `coverImage` (real URL only), and the `beats`:
   - **Every factual beat carries a `citation`** (an `artifactId` or inline `{ title, url?, quote? }`). Stories without sources are just plausible fiction.
   - **Choreograph the camera.** Set per-beat `focusNodeId` to tour the cast, and alternate surfaces: a located focus auto-opens the **globe** (its place), an unlocated one stays on the **timeline**; set `lens` explicitly to override. A story that alternates place beats with time/idea beats is the most immersive read.
   - **Art and widgets where they earn it:** a beat `image` with a `layout` (`full`/`inset-left`/`inset-right`/`bleed` — bleed sparingly), or a live `widget` (mini `timeline`/`globe`/`entity` from node ids) as the panel's hero visual.
   - Heed the returned `warnings` (dangling node ids, name-only cast, broken image URLs) — the story saved regardless; fix what matters.

4. **Dress it (optional, high-impact).** `set_story_theme` gives *this* story its own look in the reader (falls back to the timeline's theme when unset); `set_timeline_theme` dresses the whole canvas. Both return WCAG-contrast warnings — adjust until clean, and surface any you can't clear.

5. **Fix surgically.** A typo, a missing beat, a reorder → `patch_story` with targeted ops, not a full `write_story` rewrite.

6. **Hand it back — and offer the share.** Give the canvas link (the timeline `url`; the story plays from the moment's badge). If the user wants to share it publicly, **confirm first** — public means anyone with the link — then `patch_story` `update_meta { isPublic: true }` and hand back `<origin>/s/<slug>` (the slug is on the story in `get_node`'s `stories`). Never publish unasked.

## Quality bar

A story is good when it has a **real hook**, every factual beat is **cited**, the **camera moves** (focus + globe/timeline alternation, not five static beats on one node), the cast is **node-backed with faces**, and the report is straight about warnings and anything unverified. A technically-valid story that reads like a plot summary — no sources, no choreography, generic prose — is a failure even if the tool calls succeeded.
