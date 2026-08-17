---
name: map
description: "Map a topic's history onto a Synek timeline. Use when the user runs /synek:map or asks to map / chart / build a timeline of a topic, era, field, or person's history in Synek. Creates a new timeline, researches the topic, and builds it in one atomic Patch, then hands back the canvas link."
argument-hint: <topic>  (e.g. "Stoicism" or "the space race")
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_timeline", "mcp__plugin_synek_synek__get_timeline", "mcp__plugin_synek_synek__apply_patch", "WebSearch"]
---

# /synek:map: build a timeline of $ARGUMENTS

The user wants a Synek timeline for: **$ARGUMENTS**. This is the hero flow. They have the canvas open and want to watch it populate. Build it well and build it in one shot.

First read the `building-timelines` skill. It has the exact op shapes, the closed edge-`kind` set, ref aliasing, and the good-timeline heuristics. Follow it.

## Steps

1. **Confirm the connection is live.** Call `list_timelines`. If it errors (auth/connection), stop and run the `setup` flow instead; the Synek server is probably not running, or you're not authorized (OAuth via `/mcp`). Don't try to build against a dead server.

2. **Create the timeline.** Call `create_timeline` with a clear title derived from the topic (e.g. `"Stoicism"`, `"The Space Race"`). Keep the returned `id` (for `apply_patch`) and `url` (the viewer link you hand back).

3. **Research the topic.** Pull the key people, events, eras, and works, along with their real (fuzzy is fine) dates and relationships. Use `WebSearch` when your own knowledge is thin or dates are uncertain; prefer primary or authoritative sources so you can cite them. Aim for a *coherent map*, not an encyclopedia: roughly **12–25 nodes** for a topic map.

4. **Build it in ONE `apply_patch`.** Assemble the whole batch and send a single call:
   - A few `period` nodes to frame the eras.
   - The key `entity` nodes, each with a `subtype` (`person`/`org`/`place`/`work`) and a one-line `summary`.
   - The pivotal `event` nodes (points in time; no `end`).
   - **Faces and places:** an `images` URL where a real one exists (a Wikimedia portrait, an official logo; never one you invented), and `location` + `lat`/`lng` where you know where it happened (or an explicit `geoScope` when it can't be pinned) so the globe lens works.
   - Deliberate, typed `edge`s using `ref` aliasing to wire nodes created in this same batch. Pick `kind` honestly from the closed set (`caused`/`succeeded`/`influenced`/`acquired`/`competed_with`).
   - `citations` wherever you can. The user prizes source grounding.
   - A `summary` like `"Map the history of $ARGUMENTS"`.
   One call is one undoable Patch, and on the canvas it lands as a single build. If the topic is genuinely large, you may follow up with one or two more `apply_patch` calls to expand it, but lead with one substantial batch.

5. **Hand back the canvas.** Tell the user it's built and give the `url` that `create_timeline` returned (it's already on the right origin, local or hosted; the canvas updates live, so no refresh). Then offer a next step: expand a specific era, add more people, or correct anything that looks off (you can `undo` or `apply_patch` edits).

6. **Offer the follow-ons that fit.**
   - **A story:** the map lays out the world, and a story walks a path through it. Offer **`/synek:story`** to narrate its strongest moment as an immersive, cited story the user can share.
   - **Keep it alive:** when the topic is *ongoing* (a competitive landscape, model/product releases, an active research field), offer a keeper routine via **`/synek:watch <title>`**. Skip this for finished history (Stoicism, the Roman Republic).

## Quality bar

A row of bare-titled gray boxes means the job wasn't done, however cleanly the ops went through. Every entity has a subtype and a summary; dates are real and honestly imprecise; edges are few and meaningful; sources are cited. Make it something the user wants to screenshot.
