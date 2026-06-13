---
project: "Synek"
era: "Story Layer (the pivot)"
updated: 2026-05-25
---

# PRDs — the Story Layer

The pivot: the center of gravity moves from *"watch an AI build a knowledge mesh"* to *"read a grounded, time-anchored story."* The timeline canvas becomes the **map**; stories become the **product**. Each phase below is one shippable increment with its own PRD.

| Phase | Title | The one-line promise | Status |
|---|---|---|---|
| [S1](s1-story-spine.md) | Story spine + provenance | Tap a moment → read a coherent, generated story. Every generation tracked. | built* |
| [S2](s2-artifact-grounding.md) | Artifact grounding (the moat) | Tap a sentence → see the primary source it came from. | planned |
| [S3](s3-multi-pov.md) | Multi-POV | The same moment through different eyes, switchable. | planned |
| [S4](s4-witness-mode.md) | Witness mode | Tap a person mid-beat → hear their head, grounded in the scene. | planned |

\* **S1 built** — schema, the generation service (cache + provenance), and the canvas playback reader; verified at the data layer (typecheck + clean build + a 19-check test). A live in-browser UI pass is owed (needs `OPENROUTER_API_KEY`; the dev preview can't hydrate this server).

### Map layer (cross-cutting)

The S-series deepens what happens *after* you tap a moment. This track makes the **map itself** inhabited — so the story layer lands on a viewer already leaning in.

| Track | Title | The one-line promise | Status |
|---|---|---|---|
| [VIS](visual-immersion.md) | Immersive timelines | Before you tap a story, the map already *feels* like a place people lived in. | proposed |

### Navigation layer (find your way around the map)

Once a timeline is dense, getting *to* a moment matters as much as building it.

| Track | Title | The one-line promise | Status |
|---|---|---|---|
| [NAV](canvas-command-palette.md) | In-canvas search + ⌘K | Press ⌘K, type a name, land on it. | built (2026-06-11)* |
| [STORIES](stories-view.md) | Stories view | A tab beside Timeline + Globe that lists every story and plays it by itself. | built (2026-06-13) |

\* **NAV built** — `cmdk` palette over the in-memory graph; selecting a result pans/centers the camera and opens the node. Client-only (no schema/RPC/Patch). Typecheck + build green; live in-browser pass owed. Forward-links to **S2.5** (artifact recall) as its next result source.

**STORIES built** — a first-class lens (`?view=stories`) listing every story chronologically + a copy-prompt empty state; clicking opens the reader's cover docked right, Play raises the timeline as the stage, and the reader is **decoupled** from the entity panel (a story runs by itself; tapping a cast member opens an entity beside it without ending the story). Replaces the old `StoriesMenu` toolbar popover. One-column data add (`StoryDTO.momentId`, `StoryListItem.coverImage`), no migration.

### Expansion layer (grow the map)

Once you can find a moment, the next gesture is to *deepen or grow* it. Every object offers its obvious next move.

| Track | Title | The one-line promise | Status |
|---|---|---|---|
| [VERBS](next5-verb-system.md) | Expansion affordances | Look at any node; it offers the obvious next move. | Tier 1 shipped (2026-06-12) |
| [VERBS-T2](next5-tier2-alive-canvas.md) | The alive canvas (gap invitations) | The map shows its own holes and offers to fill them. | proposed (2026-06-12) — the demo centerpiece |

VERBS generalizes NAV's two stranded actions into a systematic, state-gated verb library (node panel + ⌘K). **S3.4 Talk-to is verb #1; Tier 1 shipped.** **VERBS-T2** is the signature Tier 2 layer — dashed "ghost cards" over the map's empty stretches (dead zones), the moment the launch demo is built around and linked from the landing page.

### Geography layer (where things happened)

The canvas tells you *when*. This track tells you *where* — rendering the timeline's location data on a navigable globe with a play-through animation.

| Track | Title | The one-line promise | Status |
|---|---|---|---|
| [GLOBE](globe-lens.md) | Globe lens | Press play and watch history happen on the map. | proposed (2026-06-12) |

### Connection layer (the MCP front door)

The inversion made the MCP server the product surface. This track makes *connecting a client* a first-class, manageable act.

| Track | Title | The one-line promise | Status |
|---|---|---|---|
| [KEYS](mcp-api-keys.md) | API keys | Name a key, copy it once, see it listed, revoke it when you're done. | proposed |

## Cross-cutting principles (true across all four)

- **Don't rename the substrate.** "Moment" is the product word for an existing `node`; the story layer hangs off `nodes.id` via FKs, so the Patch/undo engine stays intact.
- **Stories are not graph Patches.** Graph edits keep the "one turn = one atomic Patch" invariant; story/POV/interior generation is a separate, **provenance-tracked** flow (the `generations` cache). Built day one in S1.
- **Light / deep tiers.** ~95% generated (`light`), ~5% handcrafted (`deep`), via `depth_tier`. Promotion is **manual/editorial** while the user/signal layer is deferred.
- **Postgres sketch → Drizzle/SQLite.** `uuid pk`→`text $defaultFn(randomUUID)`, `jsonb`→`text({mode:'json'})`, `timestamptz`→`integer(timestamp_ms)`, `boolean`→`integer({mode:'boolean'})`, composite PKs via `primaryKey({columns})`. Domain time stays **instant + precision** (BCE/fuzzy-safe), not JS `date`.

## Deferred (parked — not PRD'd yet)

Local-first / single-user posture (per CLAUDE.md). These have schema *hooks* but no committed phase:

- **S5 — Users + signal** — `users`, `user_story_progress`, `user_interior_taps`, `user_saved_stories`. The engagement signal that would *automate* light→deep promotion. Unlocks when a multi-user posture is chosen.
- **Council / conversation mode** — `conversations`, `conversation_participants`, `conversation_messages`. Persona-constrained threaded dialogue (people talking *to each other*). Different shape.
- **Branching / CYOA** — `choice_points`, `choice_outcomes`. Multiplies content cost; only after witness proves out.
- **Generation game (procedural lives)** — `life_event_templates`, `life_phases`. A separate product/domain.
- **Diary drip** — a thin `subscriptions` + cron layer over `artifacts` where `artifact_type = 'diary_entry'`. Mostly scheduling, not schema.

See [`../roadmap.md`](../roadmap.md) for sequencing and `#local-N` task ids.
