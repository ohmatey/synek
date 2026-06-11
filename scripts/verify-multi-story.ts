import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch, undo } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, getStoriesForMoment, getStoryById } from '../src/lib/db/stories'

// Proves a moment can hold SEVERAL stories and that write_story's storyId option
// updates in place (vs. creating new) — and that undo restores ALL of a deleted
// moment's stories (snapshot array). Run under Node: `bun run verify:multi-story`.

const TL = 'verify-multi-story'
const VERIFY_EMAIL = 'verify-multi-story@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureVerifyUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({
      body: { email: VERIFY_EMAIL, password: 'verify-password-123', name: 'Verify' },
    })
  } catch {
    // already exists — fine
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, VERIFY_EMAIL)).get()
  if (!row) throw new Error('could not create the verify user')
  return row.id
}

function addMoment(title: string): string {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [{ op: 'add_node', ref: 'm', type: 'event', title, start: '2008' }])
  commitPatch(TL, builder, `add ${title}`)
  return (results[0] as { id: string }).id
}

function deleteMoment(momentId: string): void {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  applyOps(builder, [{ op: 'delete_node', id: momentId }])
  commitPatch(TL, builder, `delete ${momentId}`)
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Multi-story verify')

  const m = addMoment('A crowded moment')

  // (a) Two writes with NO storyId → two distinct stories on the one moment.
  console.log('Two stories on one moment')
  const first = writeStory(m, { title: 'First take', hook: 'angle one' }, [{ bodyText: 'one' }, { bodyText: 'two' }])
  const second = writeStory(m, { title: 'Second take', hook: 'angle two', depthTier: 'deep' }, [{ bodyText: 'alpha' }])
  assert(first.storyId !== second.storyId, 'two writes without storyId mint two distinct stories')
  let list = getStoriesForMoment(m)
  assert(list.length === 2, 'getStoriesForMoment returns both stories')
  assert(list.some((s) => s.title === 'First take') && list.some((s) => s.title === 'Second take'), 'both titles present')
  assert(list.find((s) => s.storyId === first.storyId)!.beatCount === 2, 'first story keeps its 2 beats')
  assert(list.find((s) => s.storyId === second.storyId)!.depthTier === 'deep', 'second story is deep')

  // (b) Write WITH the first story's id → update in place (still 2; beats replaced).
  console.log('\nUpdate one in place via storyId')
  const updated = writeStory(
    m,
    { title: 'First take, revised', hook: 'sharper' },
    [{ bodyText: 'x' }, { bodyText: 'y' }, { bodyText: 'z' }],
    { storyId: first.storyId },
  )
  assert(updated.storyId === first.storyId, 'update reuses the same story id')
  list = getStoriesForMoment(m)
  assert(list.length === 2, 'still exactly two stories (no duplicate)')
  const revised = getStoryById(first.storyId)
  assert(!!revised && revised.title === 'First take, revised', 'getStoryById sees the new title')
  assert(revised!.beats.length === 3 && revised!.beats[0]!.bodyText === 'x', 'segments were replaced (now 3)')

  // (c) Delete the moment, then undo → BOTH stories come back.
  console.log('\nUndo restores all of a deleted moment’s stories')
  deleteMoment(m)
  assert(getStoriesForMoment(m).length === 0, 'delete cascades all stories away')
  assert(undo(TL), 'undo of the delete succeeds')
  const restored = getStoriesForMoment(m)
  assert(restored.length === 2, 'undo restores BOTH stories (snapshot array)')
  assert(
    restored.some((s) => s.title === 'First take, revised') && restored.some((s) => s.title === 'Second take'),
    'both restored stories keep their content',
  )

  console.log('\nmulti-story write + update-in-place + undo all faithful ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
