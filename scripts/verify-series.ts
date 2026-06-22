import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, stories } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { ensureDefaultProject } from '../src/lib/db/projects'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, patchStory, getStoryById, undoStory, redoStory, storyHistoryState } from '../src/lib/db/stories'
import {
  createSeries,
  getSeries,
  getSeriesChapters,
  getSeriesRowBySlug,
  seriesWatermark,
  nextChapterNumber,
  updateSeries,
  deleteSeries,
  setSeriesShared,
  makeRequireOwnedSeries,
} from '../src/lib/db/series'

// Serialized-stories contract test (ADR 0006), at the DATA layer. Proves:
//   (a) series CRUD is owner-scoped (create sets owner; non-owner mutation no-ops;
//       the guard + share toggle deny a non-owner)
//   (b) chapters are stories with ordered chapterNumber (append → 1,2,3); get_series
//       returns them in order with a DERIVED frontier (last chapter + last instant)
//       and per-chapter covered node ids (the anti-duplication watermark)
//   (c) patch_story is SURGICAL — add/update/delete/reorder a beat without nuking the
//       rest; the segment set re-sequences contiguously
//   (d) the public slug lookup is gated on isPublic
//   (e) deleting a series SETs NULL on its chapters (they survive as standalone)
// Run under Node: `bun run verify:series`.

const TL = 'verify-series'
const A_EMAIL = 'series-a@synek.app'
const B_EMAIL = 'series-b@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function denied(label: string, fn: () => unknown) {
  try {
    fn()
  } catch {
    console.log(`  ✓ denied: ${label}`)
    return
  }
  throw new Error(`LEAK: ${label} was NOT denied for the non-owner`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'series-pw-123', name: email } })
  } catch {
    /* already exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create user ${email}`)
  return row.id
}

function addMoment(title: string, start: string): string {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [{ op: 'add_node', ref: 'm', type: 'event', title, start }])
  commitPatch(TL, builder, `add ${title}`)
  return (results[0] as { id: string }).id
}

// Mirror the registry's appendToSeries shorthand at the data layer.
function appendChapter(seriesId: string, momentId: string, title: string, segments: Parameters<typeof writeStory>[2]) {
  const chapterNumber = nextChapterNumber(seriesId)
  return writeStory(momentId, { title, seriesId, chapterNumber }, segments)
}

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  assert(a !== b, 'two distinct users exist')
  ensureTimeline(TL, a, 'Series verify')
  const projectId = ensureDefaultProject(a)

  // (a) create + owner-scoping
  console.log('\n(a) series CRUD is owner-scoped')
  const series = createSeries(projectId, a, { title: 'The Roman Republic', hook: 'rise and fall' })
  assert(!!series.id && !!series.slug, 'A created a series with an id + slug')
  assert(series.ownerId === a, 'series is owned by A')
  updateSeries(series.id, b, { title: 'B HIJACK' })
  assert(getSeries(series.id)?.title === 'The Roman Republic', "B's update no-ops (owner-scoped)")
  denied('makeRequireOwnedSeries(B) on A’s series', () => makeRequireOwnedSeries(b)(series.id))
  assert(setSeriesShared(series.id, b, true) === null, "B's share toggle is refused")

  // (b) chapters are ordered; watermark derives frontier + coverage
  console.log('\n(b) chapters get ordered chapterNumber + a derived watermark')
  const m1 = addMoment('Founding', '-0509')
  const m2 = addMoment('Punic Wars', '-0264')
  const ref = addMoment('Carthage', '-0814')
  const c1 = appendChapter(series.id, m1, 'Chapter I', [{ bodyText: 'the founding' }])
  const c2 = appendChapter(series.id, m2, 'Chapter II', [{ bodyText: 'war with Carthage', focusNodeId: ref }])
  assert(c1.storyId !== c2.storyId, 'each chapter is a distinct story')
  const chapters = getSeriesChapters(series.id)
  assert(chapters.length === 2, 'series has 2 chapters')
  assert(chapters[0]!.chapterNumber === 1 && chapters[1]!.chapterNumber === 2, 'chapters are numbered 1,2 in order')
  const wm = seriesWatermark(series.id)
  assert(wm.frontier.lastChapterNumber === 2, 'frontier.lastChapterNumber = 2')
  assert(wm.chapters[1]!.coveredNodeIds.includes(ref), 'chapter II covers its focus node (watermark)')
  // lastInstant = the latest instant any covered node sits at (m2 = 264 BCE > Carthage 814 BCE > Founding 509 BCE).
  const m2Instant = loadGraph(TL).nodes.find((n) => n.id === m2)!.startInstant
  assert(wm.frontier.lastInstant === m2Instant, 'frontier.lastInstant = the latest covered node instant')

  // (c) patch_story is surgical
  console.log('\n(c) patch_story edits without nuking untouched beats')
  // Seed chapter I with three beats via patch (append).
  patchStory(c1.storyId, [
    { op: 'add_segment', segment: { bodyText: 'beat B' } },
    { op: 'add_segment', segment: { bodyText: 'beat C' } },
  ], a)
  let dto = getStoryById(c1.storyId)!
  assert(dto.beats.length === 3 && dto.beats.map((b) => b.bodyText).join(',') === 'the founding,beat B,beat C', 'two beats appended, original kept')
  // Update the middle beat only.
  const midId = dto.beats[1]!.id
  patchStory(c1.storyId, [{ op: 'update_segment', segmentId: midId, segment: { bodyText: 'beat B (edited)' } }], a)
  dto = getStoryById(c1.storyId)!
  assert(dto.beats[1]!.bodyText === 'beat B (edited)' && dto.beats[0]!.bodyText === 'the founding', 'one beat edited, others untouched')
  // Delete the first beat → re-sequenced 0..1.
  patchStory(c1.storyId, [{ op: 'delete_segment', segmentId: dto.beats[0]!.id }], a)
  dto = getStoryById(c1.storyId)!
  assert(dto.beats.length === 2 && dto.beats[0]!.sequence === 0 && dto.beats[1]!.sequence === 1, 'delete re-sequences contiguously')
  // Reorder the two remaining beats.
  patchStory(c1.storyId, [{ op: 'reorder_segments', order: [dto.beats[1]!.id, dto.beats[0]!.id] }], a)
  const reordered = getStoryById(c1.storyId)!
  assert(reordered.beats[0]!.bodyText === 'beat C', 'reorder_segments applies the new order')
  assert(patchStory(c1.storyId, [{ op: 'update_meta', meta: { title: 'X' } }], b) === null, "B's patch_story is refused")

  // (c2) patch_story has its OWN undo stack (ADR 0006 D7), separate from the graph
  console.log('\n(c2) patch_story undo/redo (story stack)')
  const orderAfterReorder = getStoryById(c1.storyId)!.beats.map((x) => x.bodyText)
  assert(storyHistoryState(c1.storyId).canUndo, 'story has undoable history after patches')
  assert(undoStory(c1.storyId, a).ok, 'undoStory undoes the last patch (the reorder)')
  const afterUndo = getStoryById(c1.storyId)!.beats.map((x) => x.bodyText)
  assert(JSON.stringify(afterUndo) !== JSON.stringify(orderAfterReorder), 'undo restored the pre-reorder snapshot')
  assert(redoStory(c1.storyId, a).ok, 'redoStory re-applies it')
  assert(JSON.stringify(getStoryById(c1.storyId)!.beats.map((x) => x.bodyText)) === JSON.stringify(orderAfterReorder), 'redo re-applied the reorder')
  assert(undoStory(c1.storyId, b).ok === false, "B's undoStory is refused")

  // (d) public slug gating
  console.log('\n(d) public slug lookup is gated on isPublic')
  assert(getSeriesRowBySlug(series.slug)?.isPublic === false, 'series starts private')
  const shared = setSeriesShared(series.id, a, true)
  assert(shared?.slug === series.slug, 'A publishes the series')
  assert(getSeriesRowBySlug(series.slug)?.isPublic === true, 'public lookup now sees it public')

  // (e) delete SETs NULL on chapters (they survive standalone)
  console.log('\n(e) deleting a series leaves its chapters standalone')
  deleteSeries(series.id, a)
  assert(getSeries(series.id) === null, 'series is gone')
  const orphan = getStoryById(c1.storyId)
  assert(!!orphan, 'chapter story still exists after series delete')
  const row = db.select().from(stories).where(eq(stories.id, c1.storyId)).get()
  assert(row?.seriesId === null, 'chapter seriesId was SET NULL (content preserved)')

  console.log('\nseries data-layer contract verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
