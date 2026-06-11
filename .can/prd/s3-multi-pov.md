---
phase: S3
title: "Multi-POV"
status: planned
era: "Story Layer (the pivot)"
updated: 2026-06-11
---

# S3 — Multi-POV

> **The same moment, through different eyes.** A single moment holds several grounded stories — the general, the laundress, the child. Switch perspective and the event re-renders through someone else's vantage, constrained to what *they* could have known.

## Why this phase, why this order

Multi-POV is one of the three strong modes (witness + multi-POV + artifact-anchored). The schema already permits many stories per moment — S1 deliberately shipped one. S3 builds the **generation discipline and the UX** to populate and switch between perspectives. It comes **after grounding (S2)** so every POV is anchored in the same primary sources: different eyes, same evidence.

## The experience

- A moment's reader gains a **POV switcher** — chips/tabs of the people who have a story here (portrait + role). Tap a person → their version renders.
- **"Add a perspective"** → pick or sketch a person → the AI generates *their* story of this moment, grounded in the moment's artifacts and **constrained to their plausible knowledge** (a laundress doesn't narrate battlefield tactics).
- A person becomes a **thread**: follow one person across the moments they appear in.

## Goals

- Let one moment hold ≥2 grounded stories from different people, switchable in the reader.
- Generate a new POV constrained by **epistemic vantage** (what this person could see/know) and by the moment's artifacts.
- Surface people richly (portrait, role, historical vs composite) and link them across moments.

## Non-goals (explicitly deferred)

- **Interior monologues** (the in-the-head layer) → S4. S3 is about full *alternate narratives*, not thoughts mid-beat.
- **Conversation / council mode** (people talking *to each other*) → deferred — different shape (threaded, persona-constrained dialogue).
- **Users / signal / saved POVs** → deferred.
- **Branching** → deferred.

## Data model delta (`src/lib/db/schema.ts`)

Mostly leverages what S1 built (`stories.povType`, `stories.primaryPersonId`, the `people` table). Adds the cast join and enriches `people` only as needed.

```ts
export const STORY_PERSON_ROLES = ['protagonist', 'witness', 'mentioned', 'voiced'] as const

// A person appears in many stories, with a different role each time (composite PK).
export const storyPeople = sqliteTable('story_people', {
  storyId: text('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  roleInStory: text('role_in_story', { enum: STORY_PERSON_ROLES }).notNull().default('mentioned'),
}, (t) => ({ pk: primaryKey({ columns: [t.storyId, t.personId] }) }))
```

> No new tables beyond `story_people`. If POV generation needs an epistemic hint per person, prefer enriching `people.shortBio` / `role` over new columns — keep the cast lean.

## POV-constrained generation

- New prompt template `generate_story_pov_v1` (purpose `story`). Inputs: the moment + its artifacts (S2) **+ the chosen person** (role, bio, what they plausibly witnessed) **+ the existing POVs** for this moment (so the new one is genuinely *different*, not a paraphrase).
- System guidance encodes the **epistemic constraint**: narrate only what this person could perceive or infer; ground in the shared artifacts; diverge in emphasis and feeling, not in invented facts.
- On generate: write a new `stories` row (`povType`, `primaryPersonId`) + `story_people` rows for the cast + segments + a `generations` row — reusing the S1 transaction + cache. `story_artifacts` carry over from the moment's artifact set.

## Patch / undo interaction

Unchanged from S1/S2 — POV generation is a story-create flow, not a graph Patch. The moment (`node`) itself is untouched.

## UX surfaces

- **"Talk to [entity]" button (the entry affordance — founder, 2026-06-11).** On an entity/person node (and in the detail panel), a button opens a dialog containing a **pre-filled, copyable prompt** — e.g. *"Speaking as <person>, who was present at <moment / timeline context>, narrate this in first person, constrained to only what they could plausibly have known or perceived. Then call `write_story` to record it as their perspective."* The user copies it into their MCP client; Claude generates the POV and lands it via `write_story` (`povType` + `primaryPersonId`), wiring the `story_people` cast (S3.1). This keeps the inversion intact — Synek hands the prompt, Claude does the talking — and reuses the exact copy-prompt idiom already shipped in `buildContinueStoryPrompt` and the New Story / New Timeline dialogs. **This is the front door to multi-POV: the first, cheapest way to populate a second perspective before the full switcher/generation loop lands.**
- **POV switcher** in the reader header: people-with-stories as chips (portrait, name, role). Selecting one swaps the rendered story.
- **"Add a perspective":** person picker (existing people) or quick-sketch a new one (name, role, historical/composite) → generate. The "Talk to [entity]" button is the lightweight, copy-prompt form of this.
- **Person thread:** a person view listing their stories across moments — the spine of "follow one life through events." (Light in S3; deepens if a generation-game era ever lands.)
- **Composite people** (`is_historical = false`) are clearly labeled as representative, not real individuals.

## Done when

- A moment holds ≥2 grounded stories from different people; the switcher swaps between them.
- "Add a perspective" generates a new POV constrained to that person's vantage + the shared artifacts, and it reads *distinctly* from the others.
- A person view lists their appearances across moments.
- Typecheck clean; data-layer test covers multi-story-per-moment + cast links + "existing POVs passed to avoid duplication."

## Open questions

- How strongly to enforce epistemic limits, and how to convey them to the model (structured "knows/doesn't know" vs prose bio)?
- De-duplication: how to keep 5 POVs from collapsing into 5 paraphrases? (Passing prior POVs into the prompt is the first lever.)
- How prominent is the cross-moment **person thread** in S3 vs a later era?
- Labeling composite/representative people without breaking immersion.

## Dependencies

**S1** (stories, people, generation service) and **S2** (artifacts as the shared evidence each POV grounds in).
