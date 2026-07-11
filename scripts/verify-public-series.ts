import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, stories, storySeries, nodes } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { ensureDefaultProject } from '../src/lib/db/projects'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, patchStory, referencedNodeIds, getStoryById } from '../src/lib/db/stories'
import {
  createSeries,
  getSeries,
  getSeriesChapters,
  publicSeriesChapters,
  getSeriesRowBySlug,
  setSeriesShared,
  setSeriesReviewMode,
} from '../src/lib/db/series'

// The per-chapter publish gate (local-175, PRD per-chapter-publish-gates), at the DATA
// layer — no browser. Two halves:
//   READ gate — publicSeriesChapters ships only `published` chapters (a chapter's own
//     isPublic is orthogonal, gating only the standalone /s/$slug page); draft/archived
//     are withheld and a draft's nodes never leak into the season union.
//   WRITE side — a series with `reviewMode` ON births every appended chapter as `draft`
//     server-side (writeStory), beating an explicit status, so an AUTOMATED writer can
//     append into a PUBLIC season with nothing going live until the owner approves it
//     (patch_story update_meta status). reviewMode OFF keeps today's `published` default.
// Run under Node: `bun run verify:public-series`.

const TL = 'verify-public-series'
const VERIFY_EMAIL = 'verify-public-series@synek.app'
const OTHER_EMAIL = 'verify-public-series-other@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    // already exists — fine
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create the verify user ${email}`)
  return row.id
}

// A chapter's stored status (getStoryById's DTO omits it, so read the row directly).
const statusOf = (storyId: string): string | null =>
  db.select({ s: stories.status }).from(stories).where(eq(stories.id, storyId)).get()?.s ?? null

async function main() {
  const ownerId = await ensureUser(VERIFY_EMAIL)
  const otherId = await ensureUser(OTHER_EMAIL)
  const projectId = ensureDefaultProject(ownerId)
  ensureTimeline(TL, ownerId, 'Public series verify', projectId)

  // Clean slate (idempotent re-runs): deleting the timeline's nodes cascades away
  // their stories (momentId FK onDelete: cascade); drop this project's series too so
  // createSeries doesn't dedupe the slug to `…-2`.
  db.delete(nodes).where(eq(nodes.timelineId, TL)).run()
  db.delete(storySeries).where(eq(storySeries.projectId, projectId)).run()

  // Moments for every chapter + three referenced nodes: one for a published chapter
  // (ships), one for the published-but-standalone-private chapter (also ships — proves
  // isPublic is orthogonal), one for a DRAFT chapter (must NOT leak — the canary).
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [
    { op: 'add_node', ref: 'm1', type: 'event', title: 'Moment 1', start: '2001' },
    { op: 'add_node', ref: 'm2', type: 'event', title: 'Moment 2', start: '2002' },
    { op: 'add_node', ref: 'm3', type: 'event', title: 'Moment 3', start: '2003' },
    { op: 'add_node', ref: 'm4', type: 'event', title: 'Moment 4', start: '2004' },
    { op: 'add_node', ref: 'r1', type: 'event', title: 'Review Moment 1', start: '2005' },
    { op: 'add_node', ref: 'r2', type: 'event', title: 'Review Moment 2', start: '2006' },
    { op: 'add_node', ref: 'sa', type: 'event', title: 'Standalone Moment', start: '2007' },
    { op: 'add_node', ref: 'pub', type: 'entity', title: 'Published Chapter Node', start: '2001' },
    { op: 'add_node', ref: 'priv', type: 'entity', title: 'Standalone-Private Chapter Node', start: '2003' },
    { op: 'add_node', ref: 'secret', type: 'entity', title: 'DRAFT-only Node', start: '2002' },
  ])
  commitPatch(TL, builder, 'verify public series nodes')
  const [m1, m2, m3, m4, r1, r2, sa, pub, priv, secret] = results.map((r) => (r as { id: string }).id)
  assert(!!m1 && !!r1 && !!sa && !!pub && !!secret, 'created chapter moments + referenced nodes')

  // ---------------------------------------------------------------------------
  console.log('\n(1) READ gate — only PUBLISHED chapters ship')
  // ---------------------------------------------------------------------------
  const series = createSeries(projectId, ownerId, { title: 'Gate Test Season' })
  assert(series.reviewMode === false, 'createSeries defaults reviewMode OFF')
  setSeriesShared(series.id, ownerId, true)
  assert(getSeriesRowBySlug(series.slug)!.isPublic === true, 'the series is public (the shelf is live)')

  const setVis = (storyId: string, status: 'draft' | 'published' | 'archived', isPublic: boolean) =>
    db.update(stories).set({ status, isPublic }).where(eq(stories.id, storyId)).run()

  const ch1 = writeStory(m1, { title: 'Ch1 — published + public', seriesId: series.id, chapterNumber: 1 }, [
    { bodyText: 'On the shelf.', relatedNodeIds: [pub] },
  ]).storyId
  setVis(ch1, 'published', true)
  const ch2 = writeStory(m2, { title: 'Ch2 — DRAFT (withheld)', seriesId: series.id, chapterNumber: 2 }, [
    { bodyText: 'Unfinished — must not leak.', relatedNodeIds: [secret] },
  ]).storyId
  setVis(ch2, 'draft', true)
  const ch3 = writeStory(m3, { title: 'Ch3 — published, standalone-private', seriesId: series.id, chapterNumber: 3 }, [
    { bodyText: 'On the shelf, but no standalone link.', relatedNodeIds: [priv] },
  ]).storyId
  setVis(ch3, 'published', false)
  const ch4 = writeStory(m4, { title: 'Ch4 — ARCHIVED (withheld)', seriesId: series.id, chapterNumber: 4 }, [
    { bodyText: 'Withdrawn.' },
  ]).storyId
  setVis(ch4, 'archived', true)

  assert(getSeriesChapters(series.id).length === 4, 'getSeriesChapters (owner view) returns ALL 4 chapters')
  const shown = publicSeriesChapters(series.id)
  const shownIds = new Set(shown.map((c) => c.storyId))
  assert(shown.length === 2 && shown.every((c) => c.status === 'published'), 'only the 2 published chapters ship')
  assert(shownIds.has(ch1) && shownIds.has(ch3), 'both published chapters ship — incl. the standalone-private one')
  assert(shown.find((c) => c.storyId === ch3)!.isPublic === false, '…the standalone-private chapter ships despite isPublic=false')
  assert(!shownIds.has(ch2) && !shownIds.has(ch4), 'the DRAFT and ARCHIVED chapters are withheld')
  const union = new Set(shown.flatMap((c) => referencedNodeIds(getStoryById(c.storyId)!)))
  assert(union.has(pub) && union.has(priv), 'both published chapters\' nodes are in the season union')
  assert(!union.has(secret), 'the withheld draft chapter\'s node does NOT leak into the union')

  // ---------------------------------------------------------------------------
  console.log('\n(2) WRITE side — reviewMode births chapters as drafts (safe automation)')
  // ---------------------------------------------------------------------------
  const review = createSeries(projectId, ownerId, { title: 'Review Mode Season', reviewMode: true })
  assert(review.reviewMode === true, 'createSeries({ reviewMode: true }) starts the season in review mode')
  setSeriesShared(review.id, ownerId, true) // the risky combo: PUBLIC + automated writer

  // An automated append even explicitly asking for `published` lands as a DRAFT.
  const rc1 = writeStory(
    r1,
    { title: 'Auto Ch1', seriesId: review.id, chapterNumber: 1, status: 'published' },
    [{ bodyText: 'Written by a scheduled run.' }],
  ).storyId
  assert(statusOf(rc1) === 'draft', 'reviewMode forces a new chapter to draft, beating an explicit status: "published"')
  assert(publicSeriesChapters(review.id).length === 0, 'the public season shows nothing yet — the draft is withheld')
  assert(getSeries(review.id)!.reviewMode === true, 'get_series reports reviewMode ON')

  // The owner approves it via the real approval path (patch_story update_meta status).
  const approved = patchStory(rc1, [{ op: 'update_meta', meta: { status: 'published' } }], ownerId)
  assert(!!approved, 'patch_story(update_meta status: published) approves the chapter')
  assert(statusOf(rc1) === 'published', 'the approved chapter is now published')
  assert(publicSeriesChapters(review.id).map((c) => c.storyId).join() === rc1, 'the approved chapter now appears in the public season')

  // A re-write of the (now published) chapter without a status keeps it published —
  // reviewMode governs BIRTH only, never demotes an existing chapter on edit.
  writeStory(r1, { title: 'Auto Ch1 (edited)' }, [{ bodyText: 'Edited body.' }], { storyId: rc1 })
  assert(statusOf(rc1) === 'published', 'editing a published chapter under reviewMode does NOT silently demote it')

  // ---------------------------------------------------------------------------
  console.log('\n(3) status override + reviewMode toggle + owner-scoping')
  // ---------------------------------------------------------------------------
  // D1b: a status override works on a NON-review write (standalone story here).
  const draftStandalone = writeStory(sa, { title: 'Draft standalone', status: 'draft' }, [{ bodyText: 'A draft.' }]).storyId
  assert(statusOf(draftStandalone) === 'draft', 'status: "draft" override births a standalone story as a draft')
  const pubStandalone = writeStory(sa, { title: 'Published standalone' }, [{ bodyText: 'Default.' }]).storyId
  assert(statusOf(pubStandalone) === 'published', 'no status + no reviewMode → still born published (unchanged default)')

  // Owner-scoping: a non-owner cannot flip reviewMode (fail-closed, no-op).
  assert(setSeriesReviewMode(review.id, otherId, false) === false, "a non-owner's setSeriesReviewMode is refused")
  assert(getSeries(review.id)!.reviewMode === true, '…and reviewMode is unchanged after the refused call')

  // The owner can toggle it off; a subsequent append is then born published again.
  assert(setSeriesReviewMode(review.id, ownerId, false) === true, 'the owner turns reviewMode OFF')
  assert(getSeries(review.id)!.reviewMode === false, 'get_series reports reviewMode OFF')
  const rc2 = writeStory(r2, { title: 'Auto Ch2', seriesId: review.id, chapterNumber: 2 }, [{ bodyText: 'Post-toggle.' }]).storyId
  assert(statusOf(rc2) === 'published', 'with reviewMode OFF, a new chapter is born published again')

  console.log('\nper-chapter publish gate (read + write) verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
