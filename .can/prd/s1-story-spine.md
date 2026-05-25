---
phase: S1
title: "Story spine + provenance"
status: planned
era: "Story Layer (the pivot)"
updated: 2026-05-25
---

# S1 — Story spine + provenance

> **The new magic moment.** Tap a moment on the timeline → the AI tells you one short, readable, time-placed story made of ordered beats. Every generated thing is tracked from day one, so it's cacheable, costable, and replayable.

## Why this phase, why first

The pivot moves the center of gravity from *"watch an AI build a knowledge mesh"* to *"read a grounded story anchored to a moment in time."* The canvas becomes the **map**; stories become the **product**.

S1 is the smallest thing that proves the new core. Before we can ground stories in primary sources (S2), tell them from many viewpoints (S3), or step inside a character's head (S4), three things must exist:

1. A moment can **have a story**.
2. A story is an **ordered sequence of readable beats** (not a wall of text).
3. **Every AI generation is recorded** — the provenance ledger is built on day one, because retrofitting it across thousands of generations is painful.

## The experience

- On the canvas, a moment (a `node`) gains a **"Tell the story here"** affordance.
- Tapping it opens a **focused reader**: the story's `hook`, then its segments rendered in sequence, styled by `kind` (narration / dialogue / sensory / interior).
- A **depth badge** (`light` ⚡ generated · `deep` ✦ handcrafted) signals provenance and care.
- Re-opening a moment with the same context is **instant** — the generation cache returns the prior result instead of paying for the model again.

## Goals

- Generate a coherent, single-POV story (3–8 segments) for any moment, on demand.
- Persist stories + segments as first-class rows hanging off the existing `nodes` table.
- Record **every** generation (model, prompt template + inputs, tokens, cost, latency) and **dedupe by content hash**.
- Render a focused, legible reader that honors `kind` and `depth_tier`.

## Non-goals (explicitly deferred)

- **Source citations / artifacts** → S2 (S1 grounding is free-text `setting_note` only).
- **Multiple POVs per moment** → S3 (S1 ships *one* primary story per moment; the schema already permits many).
- **Interior monologues** → S4.
- **Users, progress, taps, saved stories, signal-driven light→deep promotion** → deferred (local-first/no-signal posture). In S1, `depth_tier` is set manually/editorially.
- **Audio / TTS** — `audio_url` column exists but stays null.

## Data model delta (`src/lib/db/schema.ts`)

"Moment" is the product term for an existing `node`. The story layer **hangs off `nodes.id`** — no table renames, so the Patch/undo engine is untouched. Translated from the Postgres sketch into our conventions (text UUIDs, json text-mode, ms timestamps, int-mode booleans).

```ts
export const POV_TYPES = ['first_person', 'witness', 'omniscient', 'diary'] as const
export const DEPTH_TIERS = ['light', 'deep'] as const          // 95% light (gen) / 5% deep (handcrafted)
export const STORY_STATUS = ['draft', 'published', 'archived'] as const
export const SEGMENT_KINDS = ['narration', 'dialogue', 'sensory', 'interior'] as const
export const GEN_TARGETS = ['story', 'segment', 'interior', 'hook', 'voice', 'image'] as const
export const GEN_PURPOSES = ['story', 'segment', 'interior', 'hook', 'image', 'voice'] as const

// Minimal in S1; enriched in S3/S4.
export const people = sqliteTable('people', {
  id: text('id').primaryKey().$defaultFn(newId),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  fullName: text('full_name'),
  birthYear: integer('birth_year'),                 // plain year int — people are not on the axis
  deathYear: integer('death_year'),
  role: text('role'),                               // 'general' | 'merchant' | 'laundress' | 'child' ...
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
  povType: text('pov_type', { enum: POV_TYPES }).notNull().default('omniscient'),
  depthTier: text('depth_tier', { enum: DEPTH_TIERS }).notNull().default('light'),
  estimatedMinutes: integer('estimated_minutes'),
  primaryPersonId: text('primary_person_id').references(() => people.id),
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
  speakerPersonId: text('speaker_person_id').references(() => people.id),  // dialogue/interior
  generationId: text('generation_id').references(() => generations.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

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
  model: text('model').notNull(),                   // 'anthropic/claude-opus-4-7'
  promptTemplateId: text('prompt_template_id').references(() => promptTemplates.id),
  promptInputsJson: text('prompt_inputs_json', { mode: 'json' }).$type<Record<string, unknown>>(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costCents: integer('cost_cents'),
  latencyMs: integer('latency_ms'),
  humanReviewed: integer('human_reviewed', { mode: 'boolean' }).notNull().default(false),
  reviewerNotes: text('reviewer_notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})
```

> Add a non-unique index on `generations.cache_key` for fast cache lookups. `segments.generationId` and `generations.id` form a soft cycle — declare `generations` before `storySegments` (or use a string ref) so Drizzle is happy.

## Server / generation service (`src/lib/server/stories.ts`, `src/lib/ai/generate.ts`)

A **new generation capability**, separate from the graph-tool/Patch loop:

1. `generateStory(momentId, opts)` server fn:
   - Load the moment (`node`) + a little neighbor context (nearby nodes/edges) for grounding.
   - Resolve the **active** `prompt_template` for `purpose='story'`.
   - Build `promptInputs` (moment fields, context, requested length/tone) → compute `cacheKey = sha256(templateId + stableStringify(promptInputs))`.
   - **Cache check:** if a `generations` row with that `cacheKey` exists, return its target story. Else call the model.
   - Use the AI SDK v6 **`generateObject`** with a Zod schema (`{ title, hook, estimatedMinutes, segments: [{ sequence, kind, bodyText, settingNote }] }`) — structured output, no graph mutation.
   - In **one transaction**: insert `stories` + `story_segments` + a `generations` row (tokens/cost/latency from the SDK result), stamping `segments.generationId`.
2. `getStories(momentId)` / `getStory(storyId)` read RPCs (TanStack Query, like `getGraph`).
3. `regenerateStory(storyId)` → new generation, new story row, archive the old (`status='archived'`); the cache makes identical inputs free.

## Patch / undo interaction

Story generation **does not** go through the graph Patch system — it isn't a graph mutation, and forcing it through would muddy the "one turn = one Patch" invariant. Stories carry their own lifecycle via `status` (`draft`/`published`/`archived`). **Editing a moment's own fields stays a Patch** (the existing `editNode` path), unchanged.

## UX surfaces

- **Canvas:** a moment with stories shows its `hook` + a small story count; "Tell the story here" generates the first one.
- **Reader:** focused, full-height panel (or a `/timelines/$id/m/$momentId/s/$storyId` route) rendering segments by `kind` — narration as prose, dialogue indented, sensory as set-dressing, interior italicized. Depth badge in the header.
- Reuse the existing `<ClientOnly>` + panel patterns; the reader is plain React (no React Flow).

## Done when

- Tap a moment → generate → read a coherent 3–8 segment story.
- The generation is recorded in `generations` with model/tokens/cost/latency.
- Requesting an identical generation returns the cached story (no second model call).
- `depth_tier` renders distinctly; a story can be flagged `deep` manually.
- Typecheck clean; data-layer test covers commit + cache-hit + regenerate-archives-prior.

## Open questions

- `generateObject` (structured) vs tool-calls for segment emission — recommend `generateObject`.
- How much neighbor context to feed (cost vs coherence)? Start with the moment + 2 nearest nodes.
- Reader as a **route** vs an in-shell **panel** — route is more "product," panel is faster to ship.
- Default story length / reading time target.

## Dependencies

None beyond the shipped substrate (timelines/nodes/edges, AI SDK v6 + OpenRouter provider, TanStack Query graph loading).
