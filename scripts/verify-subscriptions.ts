import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { ensureDefaultProject } from '../src/lib/db/projects'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, patchStory } from '../src/lib/db/stories'
import { createSeries, setSeriesShared, nextChapterNumber } from '../src/lib/db/series'
import { follow, unfollow, unfollowByToken, isFollowing, listFollowers, chapterNotifyInfo } from '../src/lib/db/subscriptions'

// Series-subscriptions contract test (local-160), at the DATA layer. Proves:
//   (a) follow is idempotent (same token on re-follow); isFollowing tracks it
//   (b) listFollowers EXCLUDES the series owner (you never email yourself)
//   (c) unfollow + token-based unsubscribe both remove the row; token is idempotent
//   (d) the publish-notification SIGNAL: writeStory reports created/status; patchStory
//       reports publishedChapter ONLY on a genuine draft→published transition; and
//       chapterNotifyInfo gates on published + series-public.
// Email itself no-ops without RESEND_API_KEY, so this asserts the wiring that DECIDES
// to send, not the send. Run under Node: `bun run verify:subscriptions`.

const TL = 'verify-subs'
const OWNER = 'subs-owner@synek.app'
const FAN1 = 'subs-fan1@synek.app'
const FAN2 = 'subs-fan2@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'subs-pw-123', name: email } })
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

async function main() {
  const owner = await ensureUser(OWNER)
  const fan1 = await ensureUser(FAN1)
  const fan2 = await ensureUser(FAN2)
  ensureTimeline(TL, owner, 'Subs verify')
  const projectId = ensureDefaultProject(owner)

  // A public series with one published chapter.
  const series = createSeries(projectId, owner, { title: 'A Living Season', hook: 'it grows' })
  setSeriesShared(series.id, owner, true)
  const m1 = addMoment('Opening', '2020')
  const ch1 = writeStory(m1, { title: 'Chapter I', seriesId: series.id, chapterNumber: nextChapterNumber(series.id) }, [
    { bodyText: 'it begins' },
  ])

  // (d.1) writeStory publish signal
  console.log('\n(d) publish signal from writeStory/patchStory')
  assert(ch1.created && ch1.status === 'published', 'a new chapter in a non-review series is born created+published')
  const info = chapterNotifyInfo(ch1.storyId)
  assert(!!info && info.status === 'published' && info.seriesIsPublic, 'chapterNotifyInfo: published chapter in a public series → notifiable')

  // (a) follow idempotency + isFollowing
  console.log('\n(a) follow is idempotent; isFollowing tracks it')
  assert(!isFollowing(series.id, fan1), 'fan1 does not follow yet')
  const t1 = follow(series.id, fan1).unsubscribeToken
  const t1again = follow(series.id, fan1).unsubscribeToken
  assert(!!t1 && t1 === t1again, 're-follow is idempotent and returns the same unsubscribe token')
  assert(isFollowing(series.id, fan1), 'fan1 now follows')

  // (b) listFollowers excludes the owner
  console.log('\n(b) listFollowers excludes the series owner')
  follow(series.id, fan2)
  const ownerToken = follow(series.id, owner).unsubscribeToken // even if the owner row exists…
  const followers = listFollowers(series.id)
  const ids = followers.map((f) => f.userId).sort()
  assert(ids.length === 2 && ids.includes(fan1) && ids.includes(fan2), 'listFollowers returns exactly the two fans')
  assert(!ids.includes(owner), 'the owner is excluded even though an owner subscription row exists')
  assert(followers.every((f) => !!f.email && !!f.unsubscribeToken), 'each follower carries an email + unsubscribe token')
  void ownerToken

  // (c) unfollow + token unsubscribe
  console.log('\n(c) unfollow + token unsubscribe both remove the row')
  unfollow(series.id, fan1)
  assert(!isFollowing(series.id, fan1), 'unfollow removed fan1')
  const t2 = follow(series.id, fan1).unsubscribeToken // re-follow → NEW token (row was deleted)
  assert(t2 !== t1, 're-follow after unfollow mints a fresh token')
  assert(unfollowByToken(t2), 'unfollowByToken removes the row and reports a change')
  assert(!isFollowing(series.id, fan1), 'token unsubscribe cleared the follow')
  assert(!unfollowByToken(t2), 'a stale/used token is a no-op (returns false)')

  // (d.2) reviewMode: born draft → NOT notifiable; publish transition fires ONCE
  console.log('\n(d) reviewMode chapter: draft birth, publish transition fires once')
  const reviewSeries = createSeries(projectId, owner, { title: 'Reviewed Season', reviewMode: true })
  setSeriesShared(reviewSeries.id, owner, true)
  const m2 = addMoment('Draft moment', '2021')
  const draft = writeStory(m2, { title: 'Held Chapter', seriesId: reviewSeries.id, chapterNumber: nextChapterNumber(reviewSeries.id) }, [
    { bodyText: 'unreviewed' },
  ])
  assert(draft.created && draft.status === 'draft', 'reviewMode births the chapter as a draft (not notifiable yet)')
  assert(chapterNotifyInfo(draft.storyId)?.status === 'draft', 'chapterNotifyInfo reflects the draft status')
  const pub1 = patchStory(draft.storyId, [{ op: 'update_meta', meta: { status: 'published' } }], owner)
  assert(!!pub1 && pub1.publishedChapter === true, 'draft→published transition sets publishedChapter (notify fires)')
  const pub2 = patchStory(draft.storyId, [{ op: 'update_meta', meta: { status: 'published' } }], owner)
  assert(!!pub2 && pub2.publishedChapter === false, 're-publishing an already-published chapter does NOT re-fire')

  // A standalone (series-less) publish never notifies.
  const solo = writeStory(m1, { title: 'Solo story' }, [{ bodyText: 'no series' }])
  assert(chapterNotifyInfo(solo.storyId) === null, 'a series-less story has no notify info (never emails)')

  console.log('\nsubscriptions data-layer contract verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
