# PRD — Per-chapter publish gates for serialized series (local-175)

- **Status:** Proposed (2026-07-11)
- **Issue:** local-175 — "Per-chapter draft/approve gate for public series"
- **Depends on:** ADR 0006 (serialized stories) — this reverses its deferral of a per-chapter publish axis (D10 note / rejected §)
- **Sibling (NOT this PRD):** local-176 (cross-user read sharing for private series) — a private-series reach problem, out of scope here
- **Trigger:** the Tech Radar dogfood + the `/synek:follow` skill ([synek-plugin/skills/follow/SKILL.md](../../synek-plugin/skills/follow/SKILL.md))

---

## 1. Problem

`set_series_public` is **one switch for the whole season**. The public season page
[`getPublicSeries`](../../src/lib/server/series.ts) ships *every* chapter in order the
instant `story_series.isPublic` flips on — it never inspects a chapter's status:

```ts
// src/lib/server/series.ts — getPublicSeries (today)
const chapterRows = getSeriesChapters(series.id)
for (const row of chapterRows) {
  const story = getStoryById(row.storyId)
  if (!story) continue
  chapters.push({ chapterNumber: row.chapterNumber, momentInstant, story })  // ← no status gate
}
```

So once a series is public, the *next* `write_story(appendToSeries: …)` call publishes
the moment it lands. For a **scheduled** follow (`/synek:follow` on a cron), that means
**unreviewed, automatically-generated content publishing itself** to a public URL. The
follow skill has no safe way to run public, so it forbids the switch outright:

> *"The series stays private by default — and for an automated follow, treat that as
> permanent. … `set_series_public` is one switch for the whole series with **no
> per-chapter gate**."* — SKILL.md §2, recipe step 6: **"NEVER call set_series_public."**

This blocks the product's headline serialized-stories loop from ever being *shared* when
it's *automated* — exactly the combination (public + scheduled) that drives the
retention bet (B6). local-175 files the concrete use case that re-opens the
per-chapter publish axis ADR 0006 deferred as "a confusing 2nd publish axis."

## 2. The core insight — most of this already exists

This is a **gate + one draft-write path + an approve control**, not a new subsystem:

| Piece | State today | Gap |
|---|---|---|
| `stories.status` (`draft`/`published`/`archived`) | **Column exists** ([schema.ts:478](../../src/lib/db/schema.ts), enum [types.ts:274](../../src/lib/domain/types.ts)) | Not honored by the public season page |
| Chapter status on the read side | `getSeriesChapters` / `getSeriesDetail` already return `status`; `SeriesSpine` already renders a **Draft** pill | In-app detail has no control to *change* it |
| MCP write of status | `patch_story` `update_meta` already accepts `status` ([registry.ts:861](../../src/lib/mcp/registry.ts)) | No obvious "publish this chapter" verb in the loop |
| New chapter's status | `writeStory` **hardcodes `status: 'published'`** on insert ([stories.ts:183](../../src/lib/db/stories.ts)) | No way to write a chapter as a draft |
| Public season page | `getPublicSeries` ships all chapters | **The gate is missing** |

Because `writeStory` has always written `'published'`, **every existing chapter is
already `published`** — so adding the gate is backward-compatible: nothing already
public disappears (see §7).

## 3. Goals / Non-goals

**Goals**
- A public season page shows **only `published` chapters**; drafts are owner-only.
- A scheduled/automated writer can **append chapters as drafts** into a *public* series
  without them going live — making "public + scheduled" **safe by construction**.
- The owner can **review and publish** (and un-publish) a chapter, both **in-app** and
  **via MCP**.
- `/synek:follow` can drop its blanket "never publish" rule.

**Non-goals**
- Cross-user read sharing of a private series (**local-176** — separate design pass).
- Email/RSS on-publish notification (the `series_subscriptions` loop, filed separately) —
  we only leave the *seam*: chapter-publish becomes the natural trigger.
- In-app scheduling/cron (ADR 0006 D1 — the client is the keeper).
- A new reader, new theme axis, or any change to the standalone `/s/$slug` story page.

## 4. The visibility model (resolving the "confusing 2nd axis" worry)

ADR 0006 deferred this precisely because a second publish flag reads as confusing. We
avoid that by giving each flag one **non-overlapping** meaning — *the shelf, the books on
it, and a book's own copy*:

| Flag | Question it answers | Gates |
|---|---|---|
| `story_series.isPublic` | **Is the season's shelf live at all?** | `/sr/$slug` exists |
| `stories.status === 'published'` | **Is this chapter on the shelf?** | this chapter's row in `/sr/$slug` |
| `stories.isPublic` | **Is this chapter *independently* shareable at its own link?** | `/s/$slug` (orthogonal — unchanged) |

Public season gate becomes exactly: **`series.isPublic && chapter.status === 'published'`.**
`isPublic` (season shelf) and `status` (which chapters are on it) compose; they don't
duplicate. A chapter's own `stories.isPublic` stays what it always was — the standalone
`/s/$slug` page — and is untouched here.

## 5. Decisions to ratify

### D1 — How a chapter is *born* a draft — **series-level `reviewMode` (recommended)**

The failure mode is "unreviewed content publishing itself," so the fix should be **safe by
construction**, not dependent on a cold scheduled run remembering a parameter.

- **D1a (recommended): a per-series `reviewMode` boolean.** When ON, `appendToSeries`
  (and explicit `seriesId` writes) land new chapters as `status: 'draft'`
  **server-side, regardless of what the writer passes.** The owner reviews + publishes.
  Set once; enforced forever; a buggy recipe run cannot leak. One additive column.
- **D1b (also add, cheap): a `write_story` `status?: 'draft' | 'published'` override**,
  default `'published'` — preserves today's behavior for standalone stories and
  non-review series, and lets a careful writer draft into a non-review series. `reviewMode`
  wins over an explicit `'published'` (safety beats the caller).
- *Rejected — `write_story` status param alone (no `reviewMode`):* simplest (zero schema),
  but the default stays `published`, so any run that forgets the flag publishes live. For
  safety-critical automation that footgun is the whole bug. Keep the param as an override,
  not the primary mechanism.

### D2 — The approve path (MCP) — **reuse `patch_story`, add a thin alias**

`patch_story(update_meta { status: 'published' })` already flips a chapter's status today.
Reuse it (zero new surface) as the canonical path, **and** add a one-line convenience tool
`set_chapter_status { storyId, status }` for loop discoverability (the keeper recipe reads
better as an explicit verb than as a meta-patch). `get_series` already returns each
chapter's `status`, so the loop can list pending drafts with no new read.

### D3 — The approve path (in-app) — **new RPC + a per-chapter control**

Add `setChapterStatus` server fn (owner-scoped, resolves owner via story → moment →
`timeline.ownerId`, mirroring `setStoryShare`). Surface a **Publish / Revert to draft**
action per chapter in the series detail page ([series.$id.tsx](../../src/routes/series.$id.tsx));
`SeriesSpine` already draws the Draft pill, so this is an action, not a redesign.

### D4 — Public numbering when drafts sit *between* published chapters

Approving out of order (publish 1 and 3, leave 2 a draft) would render "Chapter 1, Chapter
3" publicly — the reader labels by `chapterNumber` ([PublicStoryReader.tsx:442](../../src/components/public/PublicStoryReader.tsx)).
**Recommended: the public page renders a contiguous *display index* over the published
set** (1, 2, 3…), decoupled from the stored `chapterNumber`. In-app detail keeps the true
`chapterNumber` so the creator sees real order and gaps. Cheap, and robust to out-of-order
approval. *(Alt: block publishing N+1 while N is a draft — more rigid, rejected.)*

### D5 — `archived` on the season page → hidden (only `published` shows). Intended.

## 6. Design, end to end

### 6.1 Schema (`src/lib/db/schema.ts` + migration)

One additive column — no NOT-NULL rebuild (same posture as migrations 0019/0020):

```ts
// story_series
reviewMode: integer('review_mode', { mode: 'boolean' }).notNull().default(false),
```

`stories.status` already exists and is reused as-is. New migration `00NN_*.sql`
(`bun run db:generate`), committed under `drizzle/`.

### 6.2 Data layer

- **`src/lib/db/series.ts`** — `updateSeries` gains `reviewMode?: boolean`; add
  `setSeriesReviewMode(id, ownerId, on)` (owner-scoped, mirrors `setSeriesShared`).
- **`src/lib/db/stories.ts`** — `NewStory` gains `status?: StoryStatus`; the `writeStory`
  **insert** resolves status as: `reviewMode ? 'draft' : (meta.status ?? 'published')`.
  The registry passes `reviewMode` (looked up when a `seriesTarget` is present). Re-writes
  of an existing chapter leave status untouched unless explicitly set.
- **`src/lib/db/series.ts`** — `ChapterRow` already carries `status`; no read change needed.

### 6.3 The gate (`src/lib/server/series.ts` — the one required change)

```ts
// getPublicSeries — ship only PUBLISHED chapters
const chapterRows = getSeriesChapters(series.id).filter((r) => r.status === 'published')
```

Then compute the contiguous public display index (D4) as chapters are pushed. The node-
union collection already runs over the filtered `chapters`, so **no private draft's nodes
leak** to the public payload — the filter tightens the existing behavior for free.

### 6.4 RPCs (`src/lib/server/series.ts`, `src/lib/server/stories.ts`)

- `setChapterStatus({ storyId, status })` — owner-gated; `{ ok, status } | { error: 'forbidden' }`.
- `setSeriesReviewMode({ seriesId, reviewMode })` — owner-gated; mirrors `publishSeriesShare`.
- `getSeriesDetail` already returns per-chapter `status` + `isPublic`; add `reviewMode` to
  its `series` DTO so the toggle can render.

### 6.5 MCP tools (`src/lib/mcp/registry.ts`)

- **`set_chapter_status`** (new, thin): `{ storyId, status }` → owner-check via the
  story's timeline, flip status, return `{ ok, status }`. Description ties it to the
  season gate and to reading `get_series` for pending drafts.
- **`write_story`**: add `status?: enum` (D1b) + honor `reviewMode` for series writes;
  its return already includes the season `url` — note when a chapter landed as a draft.
- **`set_series_public`**: description updated — public means "the shelf is live; only
  published chapters show." Consider returning `{ publishedChapterCount, draftChapterCount }`.
- **`create_series` / `set_series_review_mode`**: `create_series` accepts optional
  `reviewMode`; add `set_series_review_mode { seriesId, reviewMode }` (or fold into an
  existing series-settings tool) so a follow can enable review in one call.
- `get_series` already returns chapter `status` (no change) — the loop's watermark for
  "what's awaiting approval."

### 6.6 UI (`src/routes/series.$id.tsx` + `SeriesSpine`)

- Replace the "Per-chapter publish is deliberately out of v1" note ([series.$id.tsx:24](../../src/routes/series.$id.tsx))
  with a per-chapter **Publish / Revert to draft** action wired to `setChapterStatus`
  (optimistic, `router.invalidate()` on success; `sonner` toast).
- A **Review mode** switch on the jacket/frontier bar wired to `setSeriesReviewMode`, with
  one line of copy: *"New chapters arrive as drafts for you to approve."*
- `SeriesSpine` already renders the Draft pill and dims draft rows — reuse verbatim; the
  public spine renders only published rows (fed by the tightened `getPublicSeries`).
- **No public reader change** beyond the display-index number (D4).

### 6.7 Skill (`synek-plugin/skills/follow/SKILL.md`) — the payoff

Rewrite §2 + recipe step 6: a follow may now **`set_series_public` once and enable
`reviewMode`**; scheduled runs append chapters that arrive as drafts; the owner publishes
after a read. The "never publish a live automated feed" guardrail is preserved *by the
gate*, not by a prohibition.

## 7. Migration & backfill safety

- **No data backfill needed.** Every existing chapter was inserted `published`
  ([stories.ts:183](../../src/lib/db/stories.ts)), so the gate keeps all currently-public
  chapters visible. Verify with a one-off count before/after.
- **Additive only:** the single new column defaults `false` — existing series behave
  exactly as today (no review, chapters born published) until an owner opts in.
- **Seed:** the blanket publish in [seed.ts:1374](../../scripts/seed.ts) stays. For the
  gate's test, seed **one draft chapter in the existing public `the-fall-of-the-republic`
  series** (e2e DB only), created after the blanket publish so it keeps `status: 'draft'`.

## 8. Test plan

### 8.1 `verify:publish-gate` (data-layer contract — new `scripts/verify-publish-gate.ts`)

Mirrors `verify-series.ts`. Asserts:
1. `reviewMode` off → `write_story(appendToSeries)` inserts `status: 'published'` (today's behavior).
2. `reviewMode` on → the same call inserts `status: 'draft'`, even with `status: 'published'` passed (D1a beats D1b).
3. `getPublicSeries` on a public series returns **only** published chapters; a draft chapter is absent **and its nodes are absent** from the payload.
4. `setChapterStatus(draft → published)` makes the chapter appear; `published → draft` removes it.
5. Owner-scope: a non-owner's `setChapterStatus` / `setSeriesReviewMode` no-ops (forbidden).
6. Public display index is contiguous when a middle chapter is a draft (D4).

Add to `package.json`: `"verify:publish-gate": "… tsx scripts/verify-publish-gate.ts"`.

### 8.2 e2e (`e2e/public-series.spec.ts` + `e2e/series-loop.spec.ts`)

- **Public page hides drafts:** with the seeded draft chapter, `/sr/the-fall-of-the-republic`
  shows Chapters 1 & 2 but **not** the draft in the spine or reader (extends the existing spine assertions).
- **In-app shows + publishes:** on `/series/$id` the draft renders with a Draft pill and a
  Publish control; clicking it (then reload) drops the pill. (Owner-authed spec, prod-build
  preview per the existing `e2e-build` launch config.)
- **Review-mode toggle** persists across reload.
- Keep `assertTopAligned` + `expectNoA11yViolations` on both pages (repo e2e convention).

### 8.3 verify (the skill's `/verify` gate)

`bun run typecheck` + `verify:publish-gate` + `verify:series` (regression) + the two e2e
specs; then a live browser pass: draft hidden on `/sr`, publish in-app, confirm it appears
on the public page without a manual refresh (live-canvas channel already nudges viewers).

## 9. Analytics

- Server: `chapter_published { series_id, chapter_number, via: 'mcp' | 'app' }` (one event
  on a draft→published transition) — feeds B6 (serialized retention) and is the natural
  trigger seam for the deferred subscription/email loop.
- Client: reuse the existing capture seam for the in-app Publish action.

## 10. Sequencing (small, shippable slices)

1. **Gate + schema** — migration (`reviewMode`), `getPublicSeries` filter, `writeStory`
   status resolution, `verify:publish-gate`. *(Fixes the leak; safe to ship alone.)*
2. **Approve paths** — `setChapterStatus` RPC + `set_chapter_status` MCP tool +
   `write_story` status override; verify extends.
3. **In-app controls** — per-chapter Publish + Review-mode toggle in `series.$id.tsx`; e2e.
4. **Skill rewrite** — `/synek:follow` §2 + recipe; docs (ADR 0006 amendment noting the
   re-opened axis + this PRD).

## 11. Open questions

- **OQ1:** Should `set_series_public(true)` on a series with only-draft chapters warn
  ("shelf is live but empty")? (Lean yes — return counts.)
- **OQ2:** Does enabling `reviewMode` retroactively demote existing published chapters?
  **No** — it only governs *newly written* chapters; existing published stay published.
- **OQ3:** Is `set_chapter_status` worth its own tool vs. documenting `patch_story`?
  (D2 recommends yes for loop clarity; low cost.)
- **OQ4:** In-app, do we expose the raw `archived` status or only draft↔published? (Lean:
  only draft↔published in the UI; `archived` remains an MCP/data concept.)
