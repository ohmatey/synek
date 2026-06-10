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
- `citations`: array of `{ title, url?, quote? }`. Cite freely — see below.
- `ref`: an optional local alias for *this* node so a later `add_edge` in the same batch can point at it (see ref aliasing).

**`add_edge`**
- `sourceId`, `targetId`: node ids — or `ref` aliases from earlier in this same batch.
- `kind`: **closed set, pick one** — `"caused"` | `"succeeded"` | `"influenced"` | `"acquired"` | `"competed_with"`. There are no others; do not pass `"related"`, `"created"`, etc.
- `label`: optional free-text label drawn on the edge.

**`update_node`** — `id` (required) + any of `title`, `summary`, `start`, `end`, `precision`, `subtype`, `lane`, `citations`. Metadata merges (existing images/color survive). Pass `lane: ""` to clear a swimlane. **`delete_node`** — `id` (its edges go too). **`update_edge`** — `id` + `kind`/`label`. **`delete_edge`** — `id`.

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

## What makes a timeline *good*

- **Faces and substance, not boxes.** Prefer real, named people/orgs/works with a one-line `summary` each. Every `entity` gets a `subtype`. A topic map of 10–20 well-summarized nodes beats 40 bare titles.
- **Mix the types.** `event`s are the moments (points in time); `entity`s are the people/orgs/places/works (often spans); `period`s are the eras that frame stretches of the axis; `concept`s are ideas/doctrines. A good map mixes them — periods give the canvas a sense of age.
- **Swimlane parallel tracks.** If the topic has rival/parallel actors, lane them (see above). This is the difference between a clean waterfall and a hairball.
- **Edges are deliberate, sparse, and typed.** Connect things that genuinely relate, and choose the `kind` honestly from the closed set. A few meaningful (especially cross-lane) edges read clearly; a fully-connected hairball reads as noise. Do not add a `succeeded` edge between every consecutive node in a lane — the lane order already shows succession.
- **Dates carry the truth.** Use the real (even fuzzy) historical date and the honest `precision`. BCE works (`"49 BCE"`). Don't fabricate day-precision when you only know the year.
- **Cite freely.** The user values primary-source grounding — it's the product's whole point. Attach `citations` (`title`, optional `url`, optional `quote`) wherever you can, especially primary sources. Better a known book title with no URL than nothing.

## What you cannot do here (so don't promise it)

- **No image/portrait attachment via MCP.** `add_node` accepts `citations`, `subtype`, `lane` only — there is no image/url field. Portraits and uploads are added by the user in the canvas's detail panel. Set `subtype: "person"` so the card is *ready* for a portrait; don't claim you attached one.
- **Stories** (narrated moments) are not exposed as MCP tools yet — build the timeline graph, not story prose.

## Always hand back the canvas

After creating or substantially building a timeline, **give the user the viewer link** so they can watch/open it:

```
http://localhost:3001/timelines/<timelineId>
```

(Use the host/port from the user's setup if non-default — see the `setup` skill. `create_timeline` returns only `{ id, title }` today, so you construct the URL from the id.)

## Reading before writing

To edit an existing timeline, call `get_timeline` first to get current node/edge **ids** — `update_*`/`delete_*` and edges between existing nodes need real ids (ref aliases only resolve to nodes created in the *same* batch). `get_timeline` returns each node's `metadata` (including its `lane`), so you can see which swimlane a node is already in before re-tagging. `list_timelines` shows what exists. `undo` / `redo` step the per-timeline history if a batch wasn't what the user wanted.
