---
name: map
description: "Map a topic's history onto a Synek timeline. Use when the user runs /synek:map or asks to map / chart / build a timeline of a topic, era, field, or person's history in Synek. Creates a new timeline, researches the topic, and builds it in one atomic Patch, then hands back the canvas link."
argument-hint: <topic>  (e.g. "Stoicism" or "the space race")
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_timeline", "mcp__plugin_synek_synek__get_timeline", "mcp__plugin_synek_synek__apply_patch", "WebSearch"]
---

# /synek:map — build a timeline of $ARGUMENTS

The user wants a Synek timeline for: **$ARGUMENTS**. This is the hero flow — they have the canvas open and want to watch it populate. Build it well and build it in one shot.

First read the `building-timelines` skill — it has the exact op shapes, the closed edge-`kind` set, ref aliasing, and the good-timeline heuristics. Follow it.

## Steps

1. **Confirm the connection is live.** Call `list_timelines`. If it errors (auth/connection), stop and run the `setup` flow instead — the local Synek server is probably not running or `SYNEK_API_KEY` is unset. Don't try to build against a dead server.

2. **Create the timeline.** Call `create_timeline` with a clear title derived from the topic (e.g. `"Stoicism"`, `"The Space Race"`). Keep the returned `id` — you'll need it for `apply_patch` and the final link.

3. **Research the topic.** Pull the key people, events, eras, and works — and their real (fuzzy is fine) dates and relationships. Use `WebSearch` when your own knowledge is thin or dates are uncertain; prefer primary or authoritative sources so you can cite them. Aim for a *coherent map*, not an encyclopedia: roughly **12–25 nodes** for a topic map.

4. **Build it in ONE `apply_patch`.** Assemble the whole batch and send a single call:
   - A few `period` nodes to frame the eras.
   - The key `entity` nodes — each with a `subtype` (`person`/`org`/`place`/`work`) and a one-line `summary`.
   - The pivotal `event` nodes (points in time; no `end`).
   - Deliberate, typed `edge`s using `ref` aliasing to wire nodes created in this same batch. Pick `kind` honestly from the closed set (`caused`/`succeeded`/`influenced`/`acquired`/`competed_with`).
   - `citations` wherever you can — the user prizes source grounding.
   - A `summary` like `"Map the history of $ARGUMENTS"`.
   One call = one undoable Patch = one "it built itself" moment. If the topic is genuinely large, you may follow up with one or two more `apply_patch` calls to expand it, but lead with one substantial batch.

5. **Hand back the canvas.** Tell the user it's built and give the link so they can open/watch it:
   ```
   http://localhost:3001/timelines/<id>
   ```
   (Use the user's configured host/port if non-default.) Then offer a next step — expand a specific era, add more people, or correct anything that looks off (you can `undo` or `apply_patch` edits).

## Quality bar

A row of bare-titled gray boxes is a failure even if every op succeeded. Every entity has a subtype and a summary; dates are real and honestly imprecise; edges are few and meaningful; sources are cited. Make it something the user wants to screenshot.
