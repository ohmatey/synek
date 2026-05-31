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
