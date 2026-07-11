---
name: building-timelines
description: How to build and edit Synek timelines well via the synek MCP tools. Use this whenever creating, populating, expanding, or editing a Synek timeline — it covers the atomic-Patch contract, the exact node/edge/date shapes apply_patch accepts, ref aliasing for in-batch edges, swimlanes for parallel tracks, and the heuristics that make a timeline rich instead of a row of gray boxes. Triggers on any work involving Synek, a knowledge timeline/canvas, mapping a topic's history, or the apply_patch / create_timeline / get_timeline tools.
---

# Building good Synek timelines

Synek is a single-user, local timeline **canvas** the user has open in a browser. You drive it through the `synek` MCP server. The canvas is the output; you are the author. Your job is not to produce a *valid* graph — it's to produce one a person wants to look at: real people, real dates, meaningful connections, and a story that reads left-to-right along time.

## The one rule: one logical edit = one atomic Patch

**All writes go through `apply_patch`.** A single call carries an *ordered batch* of ops and commits as **one undoable Patch** (`⌘Z` in the canvas reverses the whole batch). Never drip one node per call when you're mapping a topic — assemble the whole map (or a coherent chunk of it) and send it as **one** `apply_patch`. One call = one moment of "the timeline just built itself."

`apply_patch` takes:

- `timelineId` — the timeline to edit.
- `summary` — a short human label for the Patch (shows in history). e.g. `"Map the founding of Stoicism"`.
- `ops` — the ordered list of edits below.

## The ops (exact shapes — do not invent fields)

**`add_node`**
- `type`: `"event"` | `"entity"` | `"period"` | `"concept"` — *required*.
- `title`: short name — *required*.
- `start`: a date string — *required*. Fuzzy/historical is fine: `"1995"`, `"2014-03"`, `"Q3 2008"`, `"49 BCE"`, `"AD 1200"`. (Parsed server-side; don't pass epoch numbers.)
- `end`: span end (same date formats). **Omit for `event`** (events are points). Set it for `entity`/`period` spans.
- `summary`: 1–3 sentence description. Always write one — bare titles make cold cards.
- `precision`: `"year"` | `"quarter"` | `"month"` | `"day"`. Optional — inferred from `start` if omitted; set it explicitly when the source date is fuzzier than it looks.
- `subtype`: for `entity` nodes only — `"person"` | `"org"` | `"place"` | `"work"`. **Always set this on entities** — it drives the card treatment (person → portrait frame, org → logo lockup, etc.). A person entity without `subtype: "person"` renders as a generic box.
- `lane`: an optional **swimlane** key (a short group name, e.g. a company/actor like `"OpenAI"`). Nodes sharing a `lane` are laid out as **one horizontal row**, ordered left→right by date. This is the single most important field for any timeline with **parallel tracks** — see "Lay out parallel tracks in swimlanes" below. Omit it for one-off nodes.
- `images`: array of `{ url, alt?, aspect? }` — **real, web-sourced image URLs** (a Wikimedia portrait for a person, an official logo for an org, public-domain art for an era/event). Synek stores the URL and renders it on the card; it does **not** generate images — never invent a URL. Set `aspect: "portrait"` for tall subjects (a headshot, a standing figure), `"landscape"` for wide ones (scenes, logos; the default). See "Faces and places" below.
- `location`: a plain display string of where it happened (`"Golgotha, Jerusalem"`, `"Down House, Kent"`) — place texture in the detail panel; no geocoding.
- `lat` / `lng`: decimal-degree coordinates (supply both or neither; city-level precision is plenty). Plots the node on the **globe lens**. Pair with `location`.
- `geoScope`: `"global"` | `"diffuse"` | `"unknown"` — the explicit *"cannot be pinned"* marker, set **instead of** `lat`/`lng` when a node genuinely has no single place (a worldwide era; several real sites with no honest anchor; a place lost to history). **Never guess coordinates as a substitute** — placeless is an answer, not a gap. Mutually exclusive with coordinates.
- `citations`: array of `{ title, url?, quote? }`. Cite freely — see below.
- `ref`: an optional local alias for *this* node so a later `add_edge` in the same batch can point at it (see ref aliasing).

**`add_edge`**
- `sourceId`, `targetId`: node ids — or `ref` aliases from earlier in this same batch.
- `kind`: **closed set, pick one** — `"caused"` | `"succeeded"` | `"influenced"` | `"acquired"` | `"competed_with"`. There are no others; do not pass `"related"`, `"created"`, etc.
- `label`: optional free-text label drawn on the edge.

**`update_node`** — `id` (required) + any of `title`, `summary`, `start`, `end`, `precision`, `subtype`, `lane`, `location`, `lat`, `lng`, `geoScope`, `images`, `citations`. Metadata merges — **except `images`, which replaces the node's whole image array when passed** (omit it to leave existing images untouched). Pass `lane: ""` to clear a swimlane, `lat`/`lng: null` to clear coordinates, `geoScope: null` to clear the placeless marker; setting coordinates clears `geoScope` and vice versa. **`delete_node`** — `id` (its edges go too — but the underlying entity survives if it's placed on another timeline). **`update_edge`** — `id` + `kind`/`label`. **`delete_edge`** — `id`.

**`place_entity`** — `entityId` (required) + optional `lane`, `ref`. Place an **existing** entity (one already on another timeline) onto **this** timeline as a new placement, rather than re-creating it. The same canonical entity can live on many timelines; **editing its content anywhere — `update_node` on any of its placements — propagates to all of them** (a node's content lives on the shared entity; only `lane` is per-timeline). Get an entity's `entityId` from `get_node`. Use this when a person/org/work recurs across timelines so they stay one linked entity instead of drifting copies.

## ref aliasing — wiring edges to brand-new nodes

Within one batch, new nodes don't have ids yet. Give an `add_node` a `ref`, then use that `ref` string as an edge endpoint later in the same batch:

```json
{
  "timelineId": "…",
  "summary": "Zeno founds Stoicism; Cleanthes succeeds him",
  "ops": [
    { "op": "add_node", "ref": "zeno", "type": "entity", "subtype": "person",
      "title": "Zeno of Citium", "start": "334 BCE", "end": "262 BCE",
      "summary": "Founder of Stoicism; began teaching at the Stoa Poikile in Athens.",
      "citations": [{ "title": "Diogenes Laërtius, Lives VII" }] },
    { "op": "add_node", "ref": "founding", "type": "event",
      "title": "Stoa Poikile teaching begins", "start": "300 BCE",
      "summary": "Zeno begins teaching on the painted porch — the school's name follows." },
    { "op": "add_node", "ref": "cleanthes", "type": "entity", "subtype": "person",
      "title": "Cleanthes", "start": "330 BCE", "end": "230 BCE",
      "summary": "Zeno's pupil and successor as head (scholarch) of the school." },
    { "op": "add_edge", "sourceId": "zeno", "targetId": "founding", "kind": "caused" },
    { "op": "add_edge", "sourceId": "cleanthes", "targetId": "zeno", "kind": "succeeded",
      "label": "succeeded as scholarch" }
  ]
}
```

## Lay out parallel tracks in swimlanes (READ THIS before mapping any race/rivalry)

Many topics are really **several parallel tracks racing along the same time axis**: rival companies shipping products, competing schools of thought, branches of a family or franchise, factions in a war. The canvas lays nodes out in horizontal lanes. If you don't assign lanes, **every node of the same `type` is packed into one lane** and stacked into collision rows — so a topic with 25 product launches becomes one dense block, and any `succeeded` edges between them cross the whole graph into spaghetti. That is the #1 way to make an ugly timeline.

**The fix: give every node in a track the same `lane` string.** Each lane becomes its own clean horizontal row, models/events flowing left→right by date. Lanes are stacked top→bottom by their earliest node.

- **Use the EXACT same string** for every node in a track (`"OpenAI"` ≠ `"Open AI"` ≠ `"openai"`). Reuse it verbatim.
- **Put the track's anchor entity in the same lane** as its events — e.g. the `OpenAI` org card and every OpenAI model share `lane: "OpenAI"`, so the company card sits at the left of its own row and labels it.
- **A foundational/shared node** (the thing everyone built on) gets its own lane, e.g. `"Foundations"`.

**Then drop the edges the lanes already convey.** Once each track is its own row, succession is shown by left-to-right order — you do **not** need a `succeeded` edge between every consecutive model (that's the spaghetti). Likewise, `competed_with` edges between lanes are redundant: the lanes sitting side-by-side *are* the rivalry. Keep edges only for **cross-lane** story beats that add real insight — "ChatGPT (OpenAI) *caused* Bard (Google)", "o1 *influenced* DeepSeek R1". A handful of cross-lane edges over clean swimlanes reads beautifully; a fully-connected web does not.

```json
{
  "timelineId": "…",
  "summary": "The AI race as competitor swimlanes",
  "ops": [
    { "op": "add_node", "type": "entity", "subtype": "org", "lane": "OpenAI",
      "title": "OpenAI", "start": "2015-12", "summary": "…" },
    { "op": "add_node", "type": "event", "lane": "OpenAI", "title": "GPT-4", "start": "2023-03", "summary": "…" },
    { "op": "add_node", "type": "event", "lane": "OpenAI", "title": "GPT-4o", "start": "2024-05", "summary": "…" },
    { "op": "add_node", "type": "entity", "subtype": "org", "lane": "Anthropic",
      "title": "Anthropic", "start": "2021-01", "summary": "…" },
    { "op": "add_node", "type": "event", "lane": "Anthropic", "title": "Claude 3", "start": "2024-03", "summary": "…" },
    { "op": "add_node", "ref": "chatgpt", "type": "event", "lane": "OpenAI", "title": "ChatGPT launch", "start": "2022-11-30", "summary": "…" },
    { "op": "add_node", "ref": "bard", "type": "event", "lane": "Google", "title": "Bard", "start": "2023-02", "summary": "…" },
    { "op": "add_edge", "sourceId": "chatgpt", "targetId": "bard", "kind": "caused", "label": "triggered Google's response" }
  ]
}
```

## Keep narrative threads clumped

An edge is a claim that two nodes belong to one story — so connected nodes should usually sit **near each other on the canvas**. A node's position is its date (x) and its lane (y); **edges never move anything**. Connect two nodes 80 years apart with nothing in between and the reader gets one line crossing the whole canvas and no story.

- **Same thread → same lane.** A causal/succession chain (`caused`, `succeeded`) is one thread: give every node in it the same `lane` string, even when the actors differ. The lane keeps the thread readable as one row regardless of how the axis is compressed.
- **Bridge long causal jumps.** If A `caused`/`influenced` B across a big stretch of the axis, ask what happened in between — there is almost always a real intermediate event worth its own node. Two shorter edges through a bridging node tell the story; one long edge just draws a line.
- **A long edge is sometimes right.** Deep-history influence (Aristotle `influenced` a 20th-century thinker) legitimately spans centuries. Keep it — but signal intent: put a `label` on the edge ("rediscovered via …") and prefer `influenced` over `caused`. Expect an advisory warning from `apply_patch`; it's a nudge, not an error.
- **Trust the feedback.** `apply_patch` warns when a batch creates an edge whose endpoints are far apart relative to the timeline's span, and `get_layout_report` has a `grouping` section showing each connected component's time span and lane spread plus the longest edges. A component spanning most of the axis across many lanes usually means missing lanes or a date typo — fix it with `update_node` (`lane`, or a corrected `start`).

## Faces and places — make the canvas visual and mappable

Two fields turn a valid graph into a canvas worth looking at:

- **Faces (`images`).** When you know a real, web-accessible image for a node — a Wikimedia portrait, an official logo, public-domain artwork — pass it in `images` with an honest `alt` and the right `aspect`. A person card with a portrait beats a gray box every time. Only real URLs you actually sourced (search/fetch to confirm they resolve if unsure); `apply_patch` warns on broken ones. Synek renders images, it never generates them.
- **Places (`location` + `lat`/`lng`).** Set `location` wherever it adds texture, and coordinates whenever you know where it happened — that plots the node on the **globe lens**, which the user can play through to watch the story move across the map. City-level precision is plenty. When a node genuinely can't be pinned, say so with `geoScope` (`global`/`diffuse`/`unknown`) rather than skipping the decision — the globe narrates these as captions and coverage counts them as resolved. Never fabricate a pin.

`get_layout_report` has a `coordinates` section (located / placeless / unset counts plus a sample of undecided nodes) — use it to backfill places on an existing timeline.

## What makes a timeline *good*

- **Faces and substance, not boxes.** Prefer real, named people/orgs/works with a one-line `summary` each, a portrait/logo in `images` where a real one exists, and a place (`lat`/`lng` or an explicit `geoScope`). Every `entity` gets a `subtype`. A topic map of 10–20 well-summarized nodes beats 40 bare titles.
- **Mix the types.** `event`s are the moments (points in time); `entity`s are the people/orgs/places/works (often spans); `period`s are the eras that frame stretches of the axis; `concept`s are ideas/doctrines. A good map mixes them — periods give the canvas a sense of age.
- **Swimlane parallel tracks.** If the topic has rival/parallel actors, lane them (see above). This is the difference between a clean waterfall and a hairball.
- **Edges are deliberate, sparse, and typed.** Connect things that genuinely relate, and choose the `kind` honestly from the closed set. A few meaningful (especially cross-lane) edges read clearly; a fully-connected hairball reads as noise. Do not add a `succeeded` edge between every consecutive node in a lane — the lane order already shows succession. And connected nodes should sit near each other — see "Keep narrative threads clumped" above.
- **Dates carry the truth.** Use the real (even fuzzy) historical date and the honest `precision`. BCE works (`"49 BCE"`). Don't fabricate day-precision when you only know the year.
- **Cite freely.** The user values primary-source grounding — it's the product's whole point. Attach `citations` (`title`, optional `url`, optional `quote`) wherever you can, especially primary sources. Better a known book title with no URL than nothing.

## Stories — narrate a moment with `write_story`

Once the graph is rich, a moment (any node) can carry a **story**: an ordered list of beats the canvas plays back in a docked reader. Use the `write_story` tool — pass the node id as `momentId`, a `title` + `hook`, a `cast` (materialize key characters as entity nodes first, then list them), an optional `coverImage`, and `beats`. Omit `storyId` to create; pass an existing one to rewrite in place. Clicking Play runs it straight away (no cover step).

**Make stories immersive — choreograph the camera across the globe and the timeline.** As the reader steps, the canvas surface follows each beat:

- **`focusNodeId`** spotlights one node per beat: the camera pans + rings it.
- **`lens`** (`"globe"` | `"timeline"`) picks the *surface* that beat plays on. Omit it for **auto**: a beat whose focus node is **located** (has lat/lng) opens on the **globe** (framing its place); a beat with no located focus stays on the **timeline**.
- So a story that alternates a **place beat** ("In Florence, Leonardo…", focus a located node) with a **time/idea beat** ("the long wait…", a concept or `lens: "timeline"`) literally **switches between the globe and the timeline as it tells** — the most immersive read. Set `lens` explicitly when you want to override the auto rule (e.g. keep a time-themed beat on the timeline even though its focus is a located person).

Give grounded beats `citations` (same shape as a node's), an `image` where a real artwork exists, and an optional live `widget` (mini timeline/globe/entity) for the sharable public reader.

## What you cannot do here (so don't promise it)

- **No image generation.** Node `images` and story `coverImage`/beat `image` take **real, web-sourced URLs only** — Synek stores and renders them, it never creates them. If no real image exists, leave the field off; don't invent a URL. (File *uploads* happen in the canvas's detail panel, not over MCP.)

## Always hand back the canvas

After creating or substantially building a timeline, **give the user the viewer link** so they can watch/open it. `create_timeline` returns a `url` — share that (it's already on the right origin, local or hosted); the canvas updates **live** as you patch, so never tell the user to refresh. For an existing timeline, the link is `<origin>/timelines/<timelineId>`.

## Reading before writing

To edit an existing timeline, call `get_timeline` first to get current node/edge **ids** — `update_*`/`delete_*` and edges between existing nodes need real ids (ref aliases only resolve to nodes created in the *same* batch). `get_timeline` returns each node's `metadata` (including its `lane`), so you can see which swimlane a node is already in before re-tagging. `list_timelines` shows what exists. `undo` / `redo` step the per-timeline history if a batch wasn't what the user wanted.

## Living timelines — offer to keep ongoing ones current

Some timelines are *finished* (the history of Stoicism). Others are **alive** — a competitive landscape, the run of frontier model releases, an ongoing research field. A live timeline wants to *stay current* as the world changes.

There's no agent inside Synek, so "living" isn't an app feature — it's a **keeper routine** the user runs from their MCP client: periodically look for what's happened since last time and add *only the new developments* as one Patch. When you've just built or are editing a clearly **ongoing** topic (competitors, model/product releases, funding/acquisitions, an active field), proactively offer it: *"This one will keep moving — want me to set up a keeper routine so it stays current?"* and point to **`/synek:watch <timeline>`** (the `watch` skill), which runs a keeper pass now and can make it recurring.

The one thing that makes a keeper correct: **read before you write, then add only what's new.** Call `get_layout_report` (compact node index + latest dates + source registry) or `get_timeline` first, search only for developments *after* the latest node, and drop anything already present — match the real-world event, not the exact title wording. Each run is one dated `apply_patch` (`summary: "Keeper run <date> — +N …"`), every addition cited; "nothing new since <date>" is a valid run. Never invent a date or citation to look productive. Full procedure lives in the `watch` skill.
