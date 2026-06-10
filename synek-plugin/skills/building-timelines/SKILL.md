---
name: building-timelines
description: How to build and edit Synek timelines well via the synek MCP tools. Use this whenever creating, populating, expanding, or editing a Synek timeline — it covers the atomic-Patch contract, the exact node/edge/date shapes apply_patch accepts, ref aliasing for in-batch edges, and the heuristics that make a timeline rich instead of a row of gray boxes. Triggers on any work involving Synek, a knowledge timeline/canvas, mapping a topic's history, or the apply_patch / create_timeline / get_timeline tools.
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
- `type`: `"event"` | `"entity"` | `"period"` — *required*.
- `title`: short name — *required*.
- `start`: a date string — *required*. Fuzzy/historical is fine: `"1995"`, `"2014-03"`, `"Q3 2008"`, `"49 BCE"`, `"AD 1200"`. (Parsed server-side; don't pass epoch numbers.)
- `end`: span end (same date formats). **Omit for `event`** (events are points). Set it for `entity`/`period` spans.
- `summary`: 1–3 sentence description. Always write one — bare titles make cold cards.
- `precision`: `"year"` | `"quarter"` | `"month"` | `"day"`. Optional — inferred from `start` if omitted; set it explicitly when the source date is fuzzier than it looks.
- `subtype`: for `entity` nodes only — `"person"` | `"org"` | `"place"` | `"work"`. **Always set this on entities** — it drives the card treatment (person → portrait frame, org → logo lockup, etc.). A person entity without `subtype: "person"` renders as a generic box.
- `citations`: array of `{ title, url?, quote? }`. Cite freely — see below.
- `ref`: an optional local alias for *this* node so a later `add_edge` in the same batch can point at it (see ref aliasing).

**`add_edge`**
- `sourceId`, `targetId`: node ids — or `ref` aliases from earlier in this same batch.
- `kind`: **closed set, pick one** — `"caused"` | `"succeeded"` | `"influenced"` | `"acquired"` | `"competed_with"`. There are no others; do not pass `"related"`, `"created"`, etc.
- `label`: optional free-text label drawn on the edge.

**`update_node`** — `id` (required) + any of `title`, `summary`, `start`, `end`, `precision`, `subtype`, `citations`. Metadata merges (existing images/color survive). **`delete_node`** — `id` (its edges go too). **`update_edge`** — `id` + `kind`/`label`. **`delete_edge`** — `id`.

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

## What makes a timeline *good*

- **Faces and substance, not boxes.** Prefer real, named people/orgs/works with a one-line `summary` each. Every `entity` gets a `subtype`. A topic map of 10–20 well-summarized nodes beats 40 bare titles.
- **Mix the three types.** `event`s are the moments (points in time); `entity`s are the people/orgs/places/works (often spans); `period`s are the eras that frame stretches of the axis. A good map has all three — periods give the canvas a sense of age.
- **Edges are deliberate, sparse, and typed.** Connect things that genuinely relate, and choose the `kind` honestly from the closed set. A few meaningful edges read clearly; a fully-connected hairball reads as noise.
- **Dates carry the truth.** Use the real (even fuzzy) historical date and the honest `precision`. BCE works (`"49 BCE"`). Don't fabricate day-precision when you only know the year.
- **Cite freely.** The user values primary-source grounding — it's the product's whole point. Attach `citations` (`title`, optional `url`, optional `quote`) wherever you can, especially primary sources. Better a known book title with no URL than nothing.

## What you cannot do here (so don't promise it)

- **No image/portrait attachment via MCP.** `add_node` accepts `citations` and `subtype` only — there is no image/url field. Portraits and uploads are added by the user in the canvas's detail panel. Set `subtype: "person"` so the card is *ready* for a portrait; don't claim you attached one.
- **Stories** (narrated moments) are not exposed as MCP tools yet — build the timeline graph, not story prose.

## Always hand back the canvas

After creating or substantially building a timeline, **give the user the viewer link** so they can watch/open it:

```
http://localhost:3001/timelines/<timelineId>
```

(Use the host/port from the user's setup if non-default — see the `setup` skill. `create_timeline` returns only `{ id, title }` today, so you construct the URL from the id.)

## Reading before writing

To edit an existing timeline, call `get_timeline` first to get current node/edge **ids** — `update_*`/`delete_*` and edges between existing nodes need real ids (ref aliases only resolve to nodes created in the *same* batch). `list_timelines` shows what exists. `undo` / `redo` step the per-timeline history if a batch wasn't what the user wanted.
