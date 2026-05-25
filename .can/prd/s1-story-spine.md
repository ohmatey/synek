---
phase: S1
title: "Story spine + provenance"
status: built (data-layer verified; live UI pass owed)
era: "Story Layer (the pivot)"
updated: 2026-05-25
---

# S1 — Story spine + provenance

> **The new magic moment.** Tap a moment on the timeline → the AI tells you one short, readable story made of ordered beats — told **on the canvas itself**: the map frames the moment on the left, the story plays beat-by-beat on the right. Every generated thing is tracked from day one, so it's cacheable, costable, and replayable.

## Decisions locked (this interview)

| # | Fork | Decision |
|---|---|---|
| 1 | Reader surface | **Playback panel on the canvas** (not a route). Right = story dialog + Back/Next; left = canvas framed on the moment. |
| 2 | Beat ↔ camera | Camera **frames the one moment**; a beat can render **tappable links to related moments** that highlight/center them. **No automatic camera-walk** in S1. |
| 3 | Reader dock | Reuses the **node-detail slot** (`.detail-panel`). Selecting a story **clears the node dialog** — mutually exclusive. |
| 4 | `people` table | **Schema-only scaffold.** S1 stories are omniscient; dialogue speakers stay unnamed (`speaker_person_id` null). |
| 5 | POV | **Omniscient only.** POV choice + switching is S3; the schema permits it but S1 doesn't expose it. |
| 6 | Story model | **Separate `STRATA_STORY_MODEL`** env (falls back to `STRATA_MODEL`). Graph-building keeps `STRATA_MODEL`. |
| 7 | Generation context | **Moment + edge-linked neighbors** (uses the graph you already built). |
| 8 | Regeneration | **Silent cache by content hash + explicit Regenerate** (archives the prior story). |

## Why this phase, why first

The pivot moves the center of gravity from *"watch an AI build a knowledge mesh"* to *"read a grounded story anchored to a moment in time."* The canvas becomes the **map**; stories become the **product**.

S1 is the smallest thing that proves the new core. Before we can ground stories in primary sources (S2), tell them from many viewpoints (S3), or step inside a character's head (S4), three things must exist:

1. A moment can **have a story**.
2. A story is an **ordered sequence of readable beats** (not a wall of text), **played on the map**.
3. **Every AI generation is recorded** — the provenance ledger is built on day one, because retrofitting it across thousands of generations is painful.

## The experience — story playback on the canvas

- A moment that **has** a story shows a subtle affordance on the node (its `hook` + a small ▶ marker). A moment **without** one offers **"Tell the story here"** in its detail panel.
- Triggering a story **clears the node-detail dialog** and opens the **story reader** in the same right-docked slot. The canvas (left) **frames the moment** (`fitView` on that node) and **lenses** it — the moment is ringed, the rest dims — reusing the shipped `focusIds` lens.
- The reader shows **one beat at a time**: the segment's text styled by `kind` (narration as prose · dialogue indented · sensory as set-dressing · interior italic), a **beat counter** ("Beat 2 of 5"), and **Back / Next**. The `hook` and a **depth badge** (⚡ `light` generated · ✦ `deep` handcrafted) sit in the header.
- A beat can name **related moments**; those render as **tappable links**. Tapping one **centers + rings** that node on the canvas (extends the lens) — the story walks you around the map by hand, without an automatic camera-walk.
- **Regenerate** forces a fresh telling and archives the prior. Re-opening an unchanged moment is **instant** — served from the generation cache, no model call.

## Goals

- Generate a coherent, single-POV (omniscient) story (**3–8 segments**) for any moment, on demand.
- Persist stories + segments as first-class rows hanging off the existing `nodes` table.
- Record **every** generation (model, prompt template + inputs, tokens, cost, latency) and **dedupe by content hash**.
- Render a focused, **beat-by-beat reader on the canvas** that honors `kind` and `depth_tier`, drives the lens/camera, and links beats to related moments.

## Non-goals (explicitly deferred)

- **Source citations / artifacts** → S2 (S1 grounding is free-text `setting_note` only).
- **Multiple POVs per moment / POV switching** → S3 (S1 ships *one* omniscient story per moment; the schema already permits many).
- **Interior monologues / named speakers** → S4 (`speaker_person_id` exists but stays null).
- **Populating `people`** → S3 (table is scaffold-only in S1).
- **Automatic per-beat camera-walk across nodes** → reconsider in S2, when beats reference real sources and have somewhere to go.
- **A dedicated story route / URL state** → later; S1's reader is panel state. (Escape / close button exits; browser back does not.)
- **Users, progress, taps, saved stories, signal-driven light→deep promotion** → deferred (local-first/no-signal). In S1, `depth_tier` is set manually/editorially.
- **Audio / TTS** — `audio_url` column exists but stays null.

## Data model delta (`src/lib/db/schema.ts`)

"Moment" is the product term for an existing `node`. The story layer **hangs off `nodes.id`** — no table renames, so the Patch/undo engine is untouched. Conventions match the existing schema: `text` UUID PKs via `newId`, `text({ mode: 'json' })`, ms timestamps via `now`, int-mode booleans.

**Declaration order** (Drizzle refs are lazy thunks, but keep it clean): `promptTemplates` → `generations` → `people` → `stories` → `storySegments`. Add a non-unique index on `generations.cache_key`.

```ts
export const POV_TYPES = ['first_person', 'witness', 'omniscient', 'diary'] as const
export const DEPTH_TIERS = ['light', 'deep'] as const          // S1: light = generated, deep = handcrafted (manual)
export const STORY_STATUS = ['draft', 'published', 'archived'] as const
export const SEGMENT_KINDS = ['narration', 'dialogue', 'sensory', 'interior'] as const
export const GEN_TARGETS = ['story', 'segment', 'interior', 'hook', 'voice', 'image'] as const
export const GEN_PURPOSES = ['story', 'segment', 'interior', 'hook', 'image', 'voice'] as const

// --- Provenance (built day one) ---
export const promptTemplates = sqliteTable('prompt_templates', {
  id: text('id').primaryKey().$defaultFn(newId),
  name: text('name').notNull(),                     // 'generate_story_v1'
  version: integer('version').notNull().default(1),
  purpose: text('purpose', { enum: GEN_PURPOSES }).notNull(),
  body: text('body').notNull(),                     // template with placeholders
  systemPrompt: text('system_prompt'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const generations = sqliteTable('generations', {
  id: text('id').primaryKey().$defaultFn(newId),
  targetKind: text('target_kind', { enum: GEN_TARGETS }).notNull(),
  targetId: text('target_id'),                      // polymorphic — no FK by design
  cacheKey: text('cache_key'),                      // hash(templateId, promptInputs) — indexed for dedupe
  model: text('model').notNull(),                   // 'anthropic/claude-sonnet-4-6'
  promptTemplateId: text('prompt_template_id').references(() => promptTemplates.id),
  promptInputsJson: text('prompt_inputs_json', { mode: 'json' }).$type<Record<string, unknown>>(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costCents: integer('cost_cents'),
  latencyMs: integer('latency_ms'),
  humanReviewed: integer('human_reviewed', { mode: 'boolean' }).notNull().default(false),
  reviewerNotes: text('reviewer_notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
}, (t) => ({ cacheKeyIdx: index('gen_cache_key_idx').on(t.cacheKey) }))

// Minimal in S1 (scaffold); enriched + populated in S3/S4.
export const people = sqliteTable('people', {
  id: text('id').primaryKey().$defaultFn(newId),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  fullName: text('full_name'),
  birthYear: integer('birth_year'),                 // plain year int — people are not on the axis
  deathYear: integer('death_year'),
  role: text('role'),
  isHistorical: integer('is_historical', { mode: 'boolean' }).notNull().default(true),
  shortBio: text('short_bio'),
  portraitUrl: text('portrait_url'),
  voiceProfileId: text('voice_profile_id'),         // for TTS later; unused in S1
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const stories = sqliteTable('stories', {
  id: text('id').primaryKey().$defaultFn(newId),
  momentId: text('moment_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),                   // "Anna and the Books"
  hook: text('hook'),                               // one-liner shown on the moment
  povType: text('pov_type', { enum: POV_TYPES }).notNull().default('omniscient'),  // S1: always omniscient
  depthTier: text('depth_tier', { enum: DEPTH_TIERS }).notNull().default('light'),
  estimatedMinutes: integer('estimated_minutes'),
  primaryPersonId: text('primary_person_id').references(() => people.id),  // null in S1
  status: text('status', { enum: STORY_STATUS }).notNull().default('draft'),
  language: text('language').notNull().default('en'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const storySegments = sqliteTable('story_segments', {
  id: text('id').primaryKey().$defaultFn(newId),
  storyId: text('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),          // ordering within the story
  kind: text('kind', { enum: SEGMENT_KINDS }).notNull().default('narration'),
  bodyText: text('body_text').notNull(),
  audioUrl: text('audio_url'),                      // optional pre-gen TTS; unused in S1
  settingNote: text('setting_note'),                // "rain on cobblestones, smell of woodsmoke"
  relatedNodeIds: text('related_node_ids', { mode: 'json' }).$type<string[]>(),  // S1: beat → tappable map links (subset of neighbor ids)
  speakerPersonId: text('speaker_person_id').references(() => people.id),  // null in S1 (S4)
  generationId: text('generation_id').references(() => generations.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})
```

> **`relatedNodeIds` is a JSON array, not a join table** — leanest for S1 and consistent with how node `citations`/`images` already live in `metadata`. It does **not** cascade: the reader must **filter to ids present in the loaded graph** (a deleted neighbor's id is just skipped). A `segment_nodes` join can replace it later if the relationship needs its own metadata.

## Server / generation service

A **new generation capability**, separate from the graph-tool/Patch loop. New files: `src/lib/db/stories.ts` (row I/O + transaction), `src/lib/server/stories.ts` (client RPCs, mirrors `src/lib/server/graph.ts`), `src/lib/ai/generate.ts` (the `generateObject` call + cost mapping).

1. **`generateStory(momentId, opts)`** server fn (`createServerFn({ method: 'POST' })`):
   - Load the moment (`node`) + its **edge-linked neighbors** (follow `edges` where source/target = momentId; pull those nodes' id/title/summary/date). This is the grounding context.
   - Resolve the **active** `prompt_template` for `purpose='story'` (seeded — see below).
   - Build `promptInputs` (moment fields, neighbor summaries + their ids, requested length/tone) → `cacheKey = sha256(templateId + stableStringify(promptInputs))`.
   - **Cache check:** if a `generations` row with that `cacheKey` exists, return its target story (no model call).
   - Else call **`generateObject`** (AI SDK v6) with `model(process.env.STRATA_STORY_MODEL || process.env.STRATA_MODEL)` and this Zod schema (structured output, **no graph mutation**):
     ```ts
     z.object({
       title: z.string(),
       hook: z.string(),
       estimatedMinutes: z.number().int().min(1).max(15),
       segments: z.array(z.object({
         sequence: z.number().int(),
         kind: z.enum(SEGMENT_KINDS),
         bodyText: z.string(),
         settingNote: z.string().optional(),
         relatedNodeIds: z.array(z.string()).optional(),  // must be a subset of the provided neighbor ids
       })).min(3).max(8),
     })
     ```
   - **Validate** `relatedNodeIds` post-hoc: drop any id not in the supplied neighbor set (the model can hallucinate ids; the schema can't enum dynamic ids).
   - In **one transaction**: insert `stories` (povType `omniscient`, depthTier `light`, status `draft`) + `story_segments` + a `generations` row (`targetKind='story'`, `targetId=story.id`, tokens/cost/latency from the SDK `usage`), stamping each `segment.generationId`.
2. **`getStories(momentId)` / `getStory(storyId)`** read RPCs (`method: 'GET'`, TanStack Query — same shape as `getGraph`). Return story + ordered segments as serializable DTOs.
3. **`regenerateStory(storyId)`** → new generation + new story row; set the prior story `status='archived'`. Identical inputs are free via the cache.

**Seed** one `prompt_templates` row (`name='generate_story_v1'`, `purpose='story'`, `active=true`) in the migration / a `bunx tsx scripts/` seed — S1 templates are seed-only, not in-app editable.

**Cost mapping:** `costCents` from the SDK `usage` (input/output tokens) — store best-effort; OpenRouter may not return cents directly, so derive from tokens × a per-model rate table or leave null if unknown (don't block on it).

## Architecture / integration points (reuse the substrate)

| Need | Reuse | Where |
|---|---|---|
| Reader dock (right) | The `.detail-panel` absolute slot (top/right/bottom 12px, 320px, z-index 6) | `src/styles.css`; rendered in `canvas-root` |
| Mutual exclusion w/ node detail | New `activeStoryId` + `beatIndex` state in `TimelineCanvas`; when set, render `<StoryReaderPanel>` **instead of** `<NodeDetailPanel>` and clear `selectedId` | [TimelineCanvas.tsx:220](src/components/canvas/TimelineCanvas.tsx) |
| Frame the moment / center related nodes | `useReactFlow().fitView({ nodes: [{ id }], padding, duration })` via a small imperative helper (mirror `AutoFit`) | [TimelineCanvas.tsx:36](src/components/canvas/TimelineCanvas.tsx) |
| Lens (ring moment, dim rest) | `setFocusIds([momentId, ...currentBeat.relatedNodeIds])`; existing `rf-focused`/`rf-dimmed` classes + lens bar | [build-stream.tsx](src/components/canvas/build-stream.tsx), [TimelineCanvas.tsx:145](src/components/canvas/TimelineCanvas.tsx) |
| Story model gateway | `model(slug)` already takes a slug | [provider.ts:12](src/lib/ai/provider.ts) |
| Read-RPC pattern | `createServerFn` + `inputValidator` + serializable DTOs | [graph.ts](src/lib/server/graph.ts) |
| "Tell the story here" trigger | New `onOpenStory(momentId)` callback raised from `NodeDetailPanel` (mirror `onSelectNode`) | `NodeDetailPanel.tsx` |
| Story indicator on nodes | Extend `getGraph` per-node DTO with `storyCount` + `topHook` (one grouped query); show ▶/hook in `CanvasNodeData` | [graph.ts:14](src/lib/server/graph.ts), `canvas/types.ts` |

State lives in `TimelineCanvas` (alongside `selectedId`) — the panel, lens, and camera all sit in/around it, so a separate context isn't needed. The `chat-pane` (380px column) is untouched; closing the story restores chat/canvas as-is.

## Patch / undo interaction

Story generation **does not** go through the graph Patch system — it isn't a graph mutation, and forcing it through would muddy the "one turn = one Patch" invariant. Stories carry their own lifecycle via `status` (`draft`/`published`/`archived`). **Editing a moment's own fields stays a Patch** (the existing `editNode` path), unchanged. ⌘Z never affects stories.

## UX surfaces

- **Canvas node:** a moment with ≥1 story shows its `hook` + a ▶ marker (from the `getGraph` extension); click → open the reader. A storyless moment shows **"Tell the story here"** in its detail panel.
- **Story reader panel** (in the `.detail-panel` slot, plain React behind `<ClientOnly>`): header (title · ⚡/✦ depth badge · **Regenerate** · close ✕); the **current beat** styled by `kind`; **Back / Next** + a "Beat N of M" counter; related-moment **links** inline in the beat body.
- **Canvas during playback:** moment framed + ringed (lens); tapping a beat's related-moment link centers + rings that node. The existing lens bar reads "Story · <title>" with a Clear/close that exits the reader.
- **Depth badge:** ⚡ `light` (generated) vs ✦ `deep` (handcrafted); a story can be flagged `deep` manually (a header toggle that writes `depth_tier` — editorial, no signal layer).

## Done when

- Tap a moment → **"Tell the story here"** → generate → the reader opens, the canvas frames + lenses the moment.
- Step **Back/Next** through a coherent **3–8 beat** story; beats render distinctly by `kind`; related-moment links center/ring those nodes.
- The generation is recorded in `generations` with model + tokens + latency (cost best-effort).
- Requesting an **identical** generation returns the **cached** story (no second model call).
- **Regenerate** archives the prior story (`status='archived'`) and produces a fresh one.
- `depth_tier` renders distinctly; a story can be flagged `deep` manually.
- **Typecheck clean**; data-layer test covers: commit (story + segments + generation in one txn) + **cache-hit** (no 2nd call) + **regenerate-archives-prior**. (Live reader/lens/camera need a browser + key — note it, like the substrate's owed UI pass.)

## Decisions to confirm (minor — sensible defaults chosen)

- **Default `STRATA_STORY_MODEL`** — fall back to `STRATA_MODEL` (`anthropic/claude-sonnet-4-6`); document pointing it at a stronger model (e.g. `anthropic/claude-opus-4-7`) for richer prose. Add to `.env.example`.
- **Story length default** — target **3–6 beats, ~1–3 min** read; expose as a generation option later.
- **`relatedNodeIds` storage** — JSON array now (above); promote to a `segment_nodes` join only if it needs metadata.
- **Chat-pane during reading** — left as-is in S1; consider collapsing it for reading focus if the canvas feels crowded.
- **Story indicator on nodes** — the `getGraph` `storyCount`/`topHook` extension is in-scope; if it bloats the query, fall back to the detail-panel affordance only.

## Dependencies

None beyond the shipped substrate (timelines/nodes/edges, AI SDK v6 + OpenRouter provider, TanStack Query graph loading, the `focusIds` lens, `AutoFit`/`fitView` camera).
