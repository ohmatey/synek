---
phase: S3
title: "Multi-POV — the same moment through different eyes"
status: "proposed (2026-06-12)"
era: "Story Layer (the pivot)"
updated: 2026-06-12
roadmap: NEXT.3
owner: Margot (product) · Kael (data layer) · Wren (UX)
links: [s2-artifact-grounding.md, next5-verb-system.md, s4-witness-mode.md, ../roadmap.md, product-strategy.md, ../../engineering/adr/0001-sources-artifacts-schema.md]
pending-sync: false
---

# S3 — Multi-POV (the same moment through different eyes)

> **One moment, many truths.** A battle has a general and a conscript. A founding has a patron and a debtor. A discovery has a name on the paper and the people whose work it absorbed. S3 lets a moment hold several grounded stories — each narrated from a different person's epistemic vantage, each constrained to what *that person* could have known — and lets the reader step between them.

## TLDR

- **What this is not:** S3 is not an in-app generation feature. There is no model in Synek. Multi-POV works the same way everything else works: the user's Claude writes stories via `write_story`, guided by a copyable prompt that passes the epistemic constraint, the moment's shared artifacts, and the existing POVs so the new one is genuinely different, not a paraphrase.
- **What already ships:** `write_story` already accepts `povType` and a JSON `cast`; `Talk to {entity}` (S3.4) is fully shipped as verb #1 in the verb registry — it is the front door to multi-POV today.
- **What S3 adds:** a `story_people` join table for queryable person-story links (the data foundation for the person thread), a `primaryPersonId` population path via the MCP layer, a POV switcher + "Add a perspective" in the docked reader, and a light person-thread view.
- **The S3/S4 boundary:** S3 is full alternate narratives (different people, same moment, different vantages). S4 (Witness mode) is interior monologue on a beat — a tappable aside inside a story, not a separate story. They are different structures; S3 is the prerequisite.
- **Bets served:** B3 (stories make it a product), B5 (verbs drive expansion). S3.4 is already instrumented on B5's `verb_prompt_copied` event.

---

## Problem and opportunity

One story per moment is journalism. Two stories is a debate. Three is history.

The schema has supported multiple stories per moment since S1 (`stories.momentId` is not unique; a moment holds many). The infrastructure to *write* a second story already exists. What S3 adds is the *discipline* (epistemic-vantage constraint, de-duplication against existing POVs), the *data plumbing* (a queryable person-story link), and the *UX* (a switcher so the reader can step between them).

Every POV is grounded in the same shared artifact corpus (S2). Different eyes, same evidence — that is the claim that makes multi-POV honest rather than just generative.

### Who this is for

The history/learning enthusiast (primary persona, `product-strategy.md`). They're the person who reads about a battle from both sides, who wants to follow a single person — not just an event — across a century. Multi-POV is the moment Synek stops being a well-organized diagram and starts feeling like a place that has texture.

### Against the strategy

**B3 (stories make it a product):** a single omniscient POV is a summary. A switchable set of grounded first-person perspectives is a *product*. The distinguishing quality of Synek vs "just ask Claude in a chat window" is that the canvas holds the conversation's output permanently, in a form you can navigate and extend. Multi-POV deepens that gap.

**B5 (the verb system drives expansion):** `Talk to {entity}` is already verb #1, already instrumented, already the front door to multi-POV. S3 formalizes what "Talk to" lands into — a POV-typed story — and adds the UX that makes the second and third perspectives discoverable once a first one exists.

**Scope guardrail check:** S3 is single-user, local-first Core UX. No cloud, no teams, no billing, no hosted model. The inversion holds throughout: Synek hands a prompt, the user's Claude talks, the result lands via `write_story`.

---

## Architecture: the MCP inversion and what it means for S3

**The app holds no AI.** The old S3 draft assumed a `generate_story_pov_v1` prompt template, a `generations` row, and an in-app generation service. All of that was removed. The correct mental model:

```
User's Claude  →  [guided prompt]  →  write_story MCP tool  →  Synek stores + renders
```

The "generation" step is the user's own Claude, running outside Synek, guided by a prompt Synek hands them via the `PromptDialog` copy idiom. Synek never calls a model.

**What this means for S3.2 (POV-constrained generation):** the epistemic vantage constraint, the anti-paraphrase de-duplication signal, and the "ground in shared artifacts" instruction all live in the *copy-prompt spec* — a `buildTalkToPoVPrompt` builder (a richer sibling of the shipped `buildTalkToPrompt`). The constraint is enforced by what the prompt says to Claude, not by the app.

**What this means for `write_story`:** the tool already accepts `povType` and `cast`. S3 may add `primaryPersonId` as a first-class input (currently only settable via the story's `cast` + the `stories.primaryPersonId` FK) so Claude can identify the story's voice explicitly. This is a thin addition to the existing contract, not a new tool.

---

## What is already shipped (verified in code, 2026-06-12)

### S3.4 — "Talk to {entity}" (SHIPPED)

`src/lib/verbs.ts` — `NODE_VERBS[0]` with `id: 'talk-to'`, `showWhen: n.type === 'entity'`. The prompt builder at `src/lib/talk-to-prompt.ts` (confirmed `buildTalkToPrompt`) produces a first-person, source-grounded story prompt that instructs the user's Claude to call `write_story` on the entity's richest moment. The verb fires a `verb_prompt_copied` analytics event (`PromptSpec.analytics`) keyed to `surface` (node_panel or command_palette). This is the current front door to multi-POV.

What "Talk to" does today: it finds a moment, writes a POV-voiced story onto it, and lands it as a `write_story` call. The story gets a `povType` and the entity can appear in the `cast`. It does NOT yet populate `stories.primaryPersonId` explicitly — the prompt could instruct Claude to pass `povType` but does not explicitly instruct passing a `primaryPersonId` value.

### `write_story` cast (SHIPPED)

`stories.cast` is a JSON column (`StoryCastMember[]`) on every story row. Cast members are `{ nodeId?, name?, role? }`. Node-backed members are clickable in the reader. Name-only members come back as warnings. This is the S3 cast contract — it is already live and functional.

### `stories.povType` + `stories.primaryPersonId` (SHIPPED IN SCHEMA, UNDERUSED)

Both columns exist on `stories` (schema.ts:234,237). `povType` defaults to `'omniscient'`; `write_story` accepts it as an optional input. `primaryPersonId` is a FK to `people.id`; `write_story` accepts it implicitly only if the caller passes it, but the MCP tool's `write_story` handler does not explicitly surface it as a named input field in the Zod schema. Confirmed: the `write_story` inputSchema does not include `primaryPersonId` as a top-level field. It passes through `meta.cast` but not `meta.primaryPersonId` explicitly.

### S2 artifact grounding (SHIPPED)

`register_artifact`, `search_artifacts`, `story_artifacts`, `segment_citations`, `moment_artifacts` — all shipped (ADR 0001, migration 0016). Every POV story can cite the same registered artifacts. The shared evidence base is real.

### The docked reader (SHIPPED)

`StoryReader` is docked beside `NodeDetailPanel`. Per-beat `focusNodeId` makes the canvas follow the story. End panel with "Continue this story" copy-prompt (`buildContinueStoryPrompt`). The reader already holds a story list per moment (`getStoriesForMoment`) — the switcher reads from this list.

---

## What S3 adds

### S3.1 — `story_people` join table + people population path

**The audit finding:** `story_people` does not exist anywhere in the codebase. The `people` table exists (schema.ts:210–224) but nothing currently writes to it via the MCP layer. `stories.cast` is a JSON column, not a join table — you cannot efficiently query "all stories where Epictetus appears in the cast" without a full table scan.

**What S3.1 adds:**

A `story_people` join table that makes the person-story link queryable:

```ts
export const STORY_PERSON_ROLES = ['protagonist', 'witness', 'mentioned', 'voiced'] as const

export const storyPeople = sqliteTable('story_people', {
  storyId: text('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  roleInStory: text('role_in_story', { enum: STORY_PERSON_ROLES }).notNull().default('mentioned'),
}, (t) => [primaryKey({ columns: [t.storyId, t.personId] })])
```

This is one new table, one migration. It parallels the existing `story_artifacts` join pattern.

**Population path:** when `write_story` is called with a `cast` member that has a `nodeId`, Synek resolves the node's title and populates `story_people` rows. For `primaryPersonId`, `write_story` should also accept it as an explicit top-level field so the MCP client (Claude) can identify the POV voice without relying on the caller to manually wire it.

**What `story_people` enables:** the person-thread query — "all stories where this person appears" — needed for S3.3's thread view. Without it, the person-thread is a full-scan over the `cast` JSON column.

**What S3.1 does NOT change:** the `cast` JSON column on `stories` stays as-is. It is the denormalized render-path (the reader hydrates from it directly without joining). `story_people` is the queryable index alongside it. A `write_story` call that populates the cast JSON should also write `story_people` rows for any node-backed cast members.

**Undo safety:** `story_people` rows cascade on `stories.id` delete. The existing `StorySnapshot` (schema.ts:403–408) must be extended to capture `story_people` rows so undo restores them alongside the story. This follows the same two-site capture pattern as `story_artifacts` + `segment_citations` in ADR 0001 (Decision 7).

**Migration:** one new migration after 0017. No data loss to existing stories (their `story_people` rows are just absent; the JSON `cast` column retains all prior cast data).

### S3.2 — POV-constrained prompt spec

**What this is:** a `buildTalkToPoVPrompt` builder (a richer sibling of `buildTalkToPrompt`) for the "Add a perspective" flow. It is a client-side change only — no schema, no server RPC, no MCP contract change.

**The prompt's job:** instruct the user's Claude to write a story from a specific person's epistemic vantage, using the moment's registered artifacts as evidence, and diverging from existing POVs. The prompt passes:

- The target person's `name`, `role`, `shortBio` (pulled from the `people` row or constructed from the node's summary), and `subtype` — enough for Claude to model the epistemic vantage ("what this person could see, know, infer").
- The moment's `momentId` and `timelineId` so Claude can call `get_node` to read the existing stories.
- A de-duplication note: "this moment already has N stories from [these POVs / these people] — write a genuinely different perspective, not a paraphrase of what's already there." The existing story titles + hooks are passed so Claude has a concrete list to diverge from.
- The epistemic constraint phrasing: "narrate only what [person] could plausibly have perceived, known, or inferred given their role and position — do not narrate facts they could not have access to."
- The artifact instruction: "cite the moment's registered artifacts where they ground this person's experience — use `search_artifacts` to recall any you want to reference."
- The `write_story` call shape: include `povType: 'first_person'`, `primaryPersonId: [the person's node id if they have one]`, and add this person to the `cast` with `role: 'protagonist'`.

**Builder signature:**

```ts
buildTalkToPoVPrompt(input: {
  timelineId: string
  momentId: string
  momentTitle: string
  person: { nodeId?: string; name: string; role?: string; bio?: string; kind: string }
  existingPoVs: { title: string; hook?: string | null; personName?: string }[]
}): string
```

This builder lives in `src/lib/talk-to-prompt.ts` alongside `buildTalkToPrompt`.

**Where it surfaces:** in S3.3's "Add a perspective" affordance in the reader. The user picks a person (from the moment's entity nodes or quick-sketches a name+role), and the PromptDialog opens with this prompt. Same copy-prompt idiom; same `PromptSpec.analytics` event (`verb_prompt_copied`, `verb_id: 'add-pov'`, `surface: 'story_reader'`).

### S3.3 — POV switcher + "Add a perspective" in the reader

**POV switcher:** when a moment has more than one story, the docked `StoryReader` gains a strip of chips above the cover. Each chip shows the person's name (from `primaryPersonId → people.displayName` or falling back to `stories.title`) and a role hint. Selecting a chip swaps the rendered story without closing the reader. This reads from `getStoriesForMoment` (already exists), which already returns `povType`.

Implementation note: `StoryReader` currently opens a specific `storyId`. The switcher is a local state toggle in the reader header: `selectedStoryId` replaces the prop-level `storyId`, and the list of available stories is fetched once via `getStoriesForMoment`. No new RPC needed — `getStoriesForMoment` already returns the full list.

**"Add a perspective" affordance:** when the reader is open on a moment with at least one story, an "+ Add perspective" button in the reader header opens a person picker. The picker shows entity nodes on the same timeline (to pick a real node-backed person) or a "new person" form (name + role text inputs). Selecting a person opens a `PromptDialog` with the `buildTalkToPoVPrompt` prompt. Same copy-prompt idiom; no in-app generation.

The person picker is NOT a full character management UI. It is a lightweight inline affordance: a short list of entity nodes filtered to `subtype === 'person'` (or any entity if no people exist), plus a name+role freetext option. The goal is to go from "I want Marcus Aurelius's view" to "a prompt is in my clipboard" in two taps.

**Person thread (light):** a person card in `NodeDetailPanel` for `entity` nodes with `subtype === 'person'` shows a "Perspectives" section: a list of stories across all timelines where this person's node appears in `story_people` as a `protagonist` or `voiced` role. Each entry links to the moment and opens the story in the reader.

This is intentionally light in S3: one section in the existing node panel, no new route, no dedicated person page. The query is `story_people WHERE personId = X AND roleInStory IN ('protagonist', 'voiced')` joined to `stories` and `nodes`. If the `story_people` table doesn't have rows yet (older stories predate S3), the section is absent rather than shown empty.

**Composite / non-historical people:** when a cast member's person row has `isHistorical = false`, the story cover and POV chip display a visible label: "Representative character, not a historical individual." This is the labeling call from the old PRD. Implementation: `people.isHistorical` already exists (schema.ts:218).

---

## `write_story` contract additions (the minimal MCP delta)

S3.2 and S3.3 require one addition to the `write_story` tool contract:

**Add `primaryPersonId` as an explicit top-level input field** in the Zod schema (server.ts `write_story` inputSchema):

```ts
primaryPersonId: z.string().optional().describe(
  'Node id of the story\'s primary voice or protagonist — the person whose POV this story is told from. ' +
  'Pass the entity node id (must be on this timeline). Populates story_people as "protagonist". ' +
  'Ignored for omniscient stories.'
),
```

This lets Claude explicitly identify the POV voice (separate from the general `cast`), which powers the POV switcher chip label and the `story_people` insert path.

**`write_story` handler additions (thin):**
- After writing the story row, if `primaryPersonId` is set and the node exists on this timeline, write a `story_people` row `{ storyId, personId: <the person row for this node>, roleInStory: 'protagonist' }`. This requires resolving the node to a `people` row — or creating one if none exists (since `people` is currently unpopulated via MCP). The simplest path: if a `people` row with `slug = nodeId` or a linked node doesn't exist, create a minimal one (`displayName` from the node's title, `isHistorical = true`, `role` from the node's summary or the cast entry's `role` field). This is the population path that makes the person table useful.
- For each `cast` member with a `nodeId`, do the same: resolve or create a `people` row, insert a `story_people` row with the appropriate `roleInStory` (default: `mentioned`; if the member's `nodeId === primaryPersonId`, use `protagonist`).

**What does NOT change:** the `cast` JSON column stays on `stories`. The reader hydrates from it directly. `story_people` is the queryable index. Both are written in the same `writeStory` transaction.

---

## Data model delta

**New table:** `story_people` (one Drizzle migration after 0017).

**Modified tables:** none. The `stories` table already has `povType` and `primaryPersonId`; `write_story` already accepts `povType`. The only schema change is the new join table + the explicit `primaryPersonId` field in the MCP tool.

**StorySnapshot extension:** add `storyPeople: StoryPeopleRow[]` to the snapshot type so undo/redo restores person links alongside story data (same two-site pattern as `storyArtifacts` + `segmentCitations`).

**People population:** the `people` table will be populated as a side effect of `write_story` calls that pass `primaryPersonId` or node-backed `cast` members. No dedicated "create person" MCP tool is needed in S3 — people are materializations of entity nodes.

---

## UX surfaces

**Node detail panel — Talk to {entity} (already shipped):** verb #1 in `NodeVerbBar`, fires `buildTalkToPrompt`, the first POV story lands on the canvas.

**Story reader — POV switcher:** a chip strip in the reader header showing the stories on this moment, identified by their primary person's name (or by story title for omniscient stories). Chips are ordered by `stories.createdAt`. Selecting one replaces the currently rendered story. Present only when the moment has ≥2 stories.

**Story reader — "Add a perspective" button:** shown in the reader header alongside the switcher when ≥1 story exists. Opens the person picker → `PromptDialog` with `buildTalkToPoVPrompt`. The prompt is copyable; the user pastes it into their connected Claude; the result lands via `write_story` with `primaryPersonId`.

**Node detail panel — person thread section:** for `entity/person` nodes with `story_people` entries, a "Perspectives" section lists stories where they appear as protagonist or voiced. Each row: moment title, story title, beat count. Clicking a row navigates to the moment and opens the reader on that story.

**Composite people labeling:** story cover and POV chip show "Representative character" when `people.isHistorical = false`.

---

## Non-goals (explicitly deferred)

- **Interior monologues** — a different structure (tappable aside mid-beat, not a separate story). → S4 Witness mode. S3 is full alternate narratives; S4 is the in-head layer.
- **Council / conversation mode** (people talking *to each other*, threaded dialogue) → `roadmap.md` Deferred H.1.
- **Full person management UI** (a dedicated page, edit form, biography editor) → deferred. People are materializations of entity nodes; the `people` table is a queryable layer, not a separate user-facing entity.
- **Dedicated "create person" MCP tool** — not needed in S3. People are created as a side effect of `write_story` when cast members have node IDs.
- **POV generation from within the app** — the inversion holds. Synek never calls a model.
- **Branching, CYOA** → roadmap Deferred H.2.

---

## S3 / S4 boundary (crisp)

| | S3 | S4 |
|---|---|---|
| Unit | A full alternate story on a moment | An interior monologue on a single beat |
| Structure | A separate `stories` row with its own beat sequence | An `interior_monologues` row anchored to a `story_segment` |
| Trigger | User taps "Add a perspective" or uses "Talk to" verb | User taps a person name mid-beat while reading |
| Voice | Third-person or first-person narration from a vantage | Present-tense interior thought |
| Generation path | User's Claude writes via `write_story` | (S4: generated lazily on tap — see s4-witness-mode.md) |
| When | NEXT (now) | LATER.1 (depends on S2 + S3) |

---

## Patch / undo interaction

Stories are not graph Patches — the `write_story` flow has its own transaction and is outside the Patch engine. This is unchanged from S1/S2. The undo-safety concern for S3 is the `story_people` rows: they cascade on `stories.id` delete but must also be captured in `StorySnapshot` so that when an `add_node` inverse op (the undo of a moment deletion) restores a story, its `story_people` links come back too. This is the same two-site capture the S2 ship extended to `story_artifacts` + `segment_citations`.

---

## Analytics

PostHog events already wired (via the existing `PromptSpec.analytics` seam and `mcp_tool_called`):

| Event | When | Properties | Purpose |
|---|---|---|---|
| `verb_prompt_copied` | User copies a Talk-to or Add-perspective prompt | `verb_id: 'talk-to'` or `'add-pov'`, `surface`, `timeline_id`, `node_kind` | Does the entry affordance produce copies? (B5) |
| `mcp_tool_called` on `write_story` | Claude calls `write_story` | `segments`, `cast`, `artifact_citations` | Did the copy lead to a story? |

Proposed additions:

| Event | When | Properties | Purpose |
|---|---|---|---|
| `pov_switcher_used` | User taps a chip in the POV switcher | `{ timeline_id, moment_id, story_count, switch_from_omniscient: boolean }` | Is the switcher used when it appears? |
| `add_perspective_opened` | User opens the person picker | `{ timeline_id, moment_id, existing_story_count }` | Does the affordance get clicked? |

**The metric that validates S3:** of moments that receive a second story via `write_story` (measurable via `mcp_tool_called` sequence per `momentId`), what fraction get a third? If the switcher shows a moment with 3+ stories, S3 is working. If moments consistently stop at 1, the entry affordance is too buried.

---

## Done when (verifiable criteria)

- [ ] `story_people` table exists in the schema and a migration has been generated and applied. `typecheck` + `build` green.
- [ ] `write_story` accepts `primaryPersonId` as an explicit field; passing a valid node id writes a `story_people` row with `roleInStory: 'protagonist'`. Node-backed `cast` members also write `story_people` rows with `roleInStory: 'mentioned'` (or `protagonist` if they match `primaryPersonId`).
- [ ] `StorySnapshot` includes `storyPeople` rows; undo of a moment deletion restores them. Verified via a data-layer test (`bun run verify:mcp` or a new `verify:story-pov`).
- [ ] A moment with ≥2 stories shows the POV switcher chip strip in the docked reader. Tapping a chip swaps the rendered story without closing the reader.
- [ ] "Add a perspective" button is present in the reader header when ≥1 story exists. Tapping it opens the person picker. Selecting a person or entering a name+role opens `PromptDialog` with a `buildTalkToPoVPrompt` copy-prompt. The prompt includes the existing POV summaries for de-duplication.
- [ ] An entity/person node whose `story_people` has ≥1 protagonist/voiced row shows a "Perspectives" section in `NodeDetailPanel` listing those stories.
- [ ] Composite people (`isHistorical = false`) show a "Representative character" label in the reader cover and POV switcher chip.
- [ ] `pov_switcher_used` and `add_perspective_opened` analytics events fire correctly (verified in the capture seam).
- [ ] `verb_prompt_copied` for `verb_id: 'add-pov'` fires on copy from the Add-a-perspective dialog.
- [ ] Live in-browser pass (prod build): Talk-to produces a story on the canvas; the moment shows a switcher with 2 chips when a second POV lands via `write_story`; the person thread section appears on the entity panel.

---

## Dependencies

**S1** (stories schema, multi-story-per-moment, docked reader, `people` table) — shipped.
**S2** (artifact grounding — `register_artifact`, `search_artifacts`, `story_artifacts`, `segment_citations`) — shipped. Every POV grounds in the same shared artifacts; S3.2's prompt instructs Claude to use them.
**VERBS Tier 1** (`talk-to` verb, `NodeVerbBar`, `PromptDialog`) — shipped. S3.3's "Add a perspective" is the same pattern and reuses the same machinery.

**S4 depends on S3:** Witness mode (`interior_monologues`) requires a populated person-story cast to know who is tappable mid-beat.

---

## Open questions

- **OQ1: `people` rows — create-on-demand vs require existence.** When `write_story` is called with a `primaryPersonId` that is a node id but has no corresponding `people` row, should the handler create a minimal `people` row automatically (name from node title, `isHistorical = true`)? Or should it warn and skip? Lean: create-on-demand with a warning — this is the least friction path given the `people` table is currently empty. The warning tells Claude a `people` row was auto-created; it can enrich it later if needed.
- **OQ2: Person picker scope.** Should the person picker in "Add a perspective" include only `subtype === 'person'` entity nodes, or all entity nodes? Lean: all entity nodes (orgs and places have perspectives too), with `subtype === 'person'` surfaced first.
- **OQ3: De-duplication UX.** The prompt passes existing POV summaries to Claude, but there is no in-app enforcement that prevents two identical stories from landing. Is a warning from `write_story` if two stories share an identical `primaryPersonId` enough, or should we block it? Lean: warn only (store all; the switcher shows all); Claude's use of the de-dup context in the prompt is the primary guard.
- **OQ4: Person thread — cross-timeline?** The thread query currently scopes to the current timeline's stories. Should it show stories from all timelines where this person appears? Lean: current timeline only in S3 (the person panel is always in a timeline context); cross-timeline is a future "person explorer" feature.

---

## Phased breakdown (pipeline issues)

Each item maps to one Sal issue. All are horizon `next`.

| # | Title | What it covers | Depends on |
|---|---|---|---|
| S3.1 | **`story_people` join table + migration + `StorySnapshot` extension** | Schema: new table + migration; `writeStory` writes `story_people` rows for node-backed cast members + `primaryPersonId`; `StorySnapshot` captures them for undo; data-layer test | — |
| S3.2 | **`write_story` `primaryPersonId` input field + `buildTalkToPoVPrompt` builder** | Add `primaryPersonId` to `write_story` Zod schema; write `buildTalkToPoVPrompt` (passes existing POVs + epistemic constraint + artifact instruction); wire into `PromptSpec` shape | S3.1 |
| S3.3a | **POV switcher in the docked reader** | Chip strip in `StoryReader` header when ≥2 stories; chip label from `primaryPersonId → people.displayName` (fallback to story title); selecting a chip swaps rendered story | S3.1, S3.2 |
| S3.3b | **"Add a perspective" button + person picker** | Button in reader header; inline person picker (entity nodes filtered to person subtype-first + name/role freetext); opens `PromptDialog` with `buildTalkToPoVPrompt`; analytics event `add_perspective_opened` + `verb_prompt_copied (add-pov)` | S3.2, S3.3a |
| S3.3c | **Person thread in `NodeDetailPanel`** | "Perspectives" section on entity/person nodes; query via `story_people` for protagonist/voiced rows; each entry links to moment + opens reader on that story; composite labeling | S3.1, S3.3a |

---

## Change log

| Date | Change | Author |
|---|---|---|
| 2026-06-12 | Full rewrite from 2026-06-11 draft. Removed all in-app generation architecture (no `generate_story_pov_v1`, no `generations` rows, no S1 generation service). Encoded MCP inversion as the load-bearing constraint throughout. Audited `write_story`, `stories.cast`, `people`, `story_people` (not in schema — new table scope), `verbs.ts`, `talk-to-prompt.ts` against source. Recorded S3.4 as fully shipped. Added phased breakdown and verified done-when criteria. | Margot |
