---
phase: S4
title: "Witness mode"
status: planned
era: "Story Layer (the pivot)"
updated: 2026-05-25
---

# S4 — Witness mode

> **Step inside a head, mid-scene.** While reading, tap any person in a beat and hear their interior monologue *at that exact moment* — contextual, grounded, never generic. Generated lazily on tap, cached forever after.

## Why this phase, why last (of the active four)

Witness is the deepest empathy layer and the payoff of the other three: it needs people (S1), shared evidence to ground thoughts (S2), and richly populated multi-person scenes (S3). It's also the most generation-heavy mode — every person × every beat is a potential thought — so it leans hardest on the provenance + cache built in S1. Hence last.

> The interior is anchored to a **segment**, not a person in the abstract — so the thought is *about this beat*, not a generic character bio. That anchoring is what makes witness mode land.

## The experience

- In the reader, people present or named in a beat become **tappable**.
- Tap a person → an **interior aside** unfolds in their head-voice for *that* beat (styled distinctly from narration — intimate, present-tense).
- First tap **generates** (and caches); every tap after is instant and free.
- Most interiors are `light` (generated); a curator can promote a beloved one to `deep` (handcrafted) manually — there's no automated promotion yet (signal is deferred).

## Goals

- Generate a contextual interior monologue for a (person, segment) pair, on tap.
- **Lazy + cached:** never pre-compute the full person×segment matrix; generate on demand, store, reuse.
- Ground the thought in the beat + the moment's artifacts, in the person's voice and vantage.
- Render interiors as a visually distinct layer over the narration.

## Non-goals (explicitly deferred)

- **Audio / TTS** — `voice_profile_id` / `audio_url` exist but stay unused.
- **Signal-driven light→deep promotion** (tap counts deciding what to handcraft) → deferred with the users layer. S4 promotion is **manual/editorial**.
- **Conversation / council** (interiors *responding to each other*) → deferred.
- Pre-generating interiors for every person in every beat.

## Data model delta (`src/lib/db/schema.ts`)

```ts
// Witness mode's core table. Anchored to a segment so the thought is contextual.
export const interiorMonologues = sqliteTable('interior_monologues', {
  id: text('id').primaryKey().$defaultFn(newId),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  storySegmentId: text('story_segment_id').notNull().references(() => storySegments.id, { onDelete: 'cascade' }),
  bodyText: text('body_text').notNull(),
  depthTier: text('depth_tier', { enum: DEPTH_TIERS }).notNull().default('light'),
  generationId: text('generation_id').references(() => generations.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})
```

> Add a unique index on `(person_id, story_segment_id)` — it's the cache key for "have we already imagined this person's thought at this beat?" and prevents duplicates under double-tap.

## Lazy-generate-on-tap flow (`src/lib/server/interiors.ts`)

1. Tap a person@segment → `getOrGenerateInterior(personId, segmentId)`:
   - **Lookup** by `(personId, segmentId)`. Hit → return it (instant, free).
   - Miss → resolve `generate_interior_v1` template; build inputs (the person's bio/vantage, the segment's `bodyText` + `settingNote`, the moment's artifacts for grounding, the surrounding beats for continuity).
   - `cacheKey = sha256(templateId + inputs)` → `generations` (so identical inputs across people/sessions dedupe at the provenance layer too).
   - Generate (`generateText` / `generateObject`) → in one transaction insert the `interior_monologues` row + `generations` row.
2. The `generations` ledger gives cost/latency per interior — important since this is the highest-volume generation mode.

## Patch / undo interaction

Interiors are generated content, not graph mutations — outside the Patch system, same as stories. The reader simply reveals them; nothing on the canvas changes.

## UX surfaces

- **Tappable people in a beat:** the set is `speakerPersonId` + the segment's story's `story_people` who are plausibly present. Tap targets are subtle until hovered/focused — the prose stays primary.
- **Interior aside:** an inline expandable region (or margin aside) in the person's voice, visually distinct (italic/present-tense/tinted). Collapsible; multiple can be open.
- **Manual promotion:** a curator affordance to mark an interior `deep` and edit it by hand (the 5% that get handcrafted).
- Loading state on first tap (it's a live generation); cached taps are instant.

## Done when

- Tap a person in a beat → a contextual interior grounded in the scene + artifacts, in their voice.
- Identical taps hit cache (no second model call); the unique index holds under rapid double-tap.
- Interiors render distinctly from narration; a curator can promote one to `deep` and edit it.
- Typecheck clean; data-layer test covers generate-then-cache + uniqueness + grounding inputs.

## Open questions

- Exactly **who is tappable** in a beat — only the speaker + present cast, or anyone named? (Start: speaker + present cast.)
- Cost/rate guardrails for tap-generation (this is the spendiest mode) — per-session cap? confirm-before-generate for cold taps?
- Without engagement signal (deferred), how does the curator *find* the interiors worth handcrafting? (Manual review queue / recently-generated list.)
- Continuity: feed neighboring beats so a person's thoughts cohere across a story?

## Dependencies

**S1** (people, segments, generation + cache), **S2** (artifacts to ground the thought), **S3** (rich multi-person scenes — interiors are thin without a populated cast).
