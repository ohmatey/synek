import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch, undo, redo } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, getStoryForMoment } from '../src/lib/db/stories'

// Proves undo/redo is FAITHFUL across the story FK cascade (the known limitation
// fix). Stories hang off nodes.id with onDelete: 'cascade' and live outside the
// Patch engine, so without snapshotting, deleting a moment — or undoing the patch
// that created it — would lose its story irreversibly. We exercise both cases here.
// Run under Node: `tsx scripts/verify-story-undo.ts` (or `bun run verify:story-undo`).

const TL = 'verify-story-undo'
const VERIFY_EMAIL = 'verify-story-undo@synek.app'

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

// Add one moment node via the normal Patch path and return its id.
function addMoment(title: string): string {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [{ op: 'add_node', ref: 'm', type: 'event', title, start: '2008' }])
  commitPatch(TL, builder, `add ${title}`)
  return (results[0] as { id: string }).id
}

// Delete a moment via a delete_node Patch op (the bug's trigger).
function deleteMoment(momentId: string): void {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  applyOps(builder, [{ op: 'delete_node', id: momentId }])
  commitPatch(TL, builder, `delete ${momentId}`)
}

const THREE_BEATS = [
  { bodyText: 'Beat one.', kind: 'narration' as const },
  { bodyText: 'Beat two.', kind: 'dialogue' as const, settingNote: 'rain on glass' },
  { bodyText: 'Beat three.', kind: 'sensory' as const },
]

function storyShapeOk(momentId: string): boolean {
  const s = getStoryForMoment(momentId)
  return (
    !!s &&
    s.title === 'The Turn' &&
    s.hook === 'How it began' &&
    s.depthTier === 'deep' &&
    s.beats.length === 3 &&
    s.beats[0]!.bodyText === 'Beat one.' &&
    s.beats[1]!.settingNote === 'rain on glass' &&
    s.beats[0]!.sequence === 0 &&
    s.beats[1]!.sequence === 1 &&
    s.beats[2]!.sequence === 2
  )
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Story undo verify')

  // === Case A: delete a moment that HAS a story, then undo ==================
  console.log('Case A — delete a moment with a story → undo restores it')
  const a = addMoment('Moment A')
  writeStory(a, { title: 'The Turn', hook: 'How it began', depthTier: 'deep' }, THREE_BEATS)
  assert(storyShapeOk(a), 'story present after writeStory')

  deleteMoment(a)
  assert(getStoryForMoment(a) === null, 'delete_node cascades the story away')

  assert(undo(TL), 'undo of the delete succeeds')
  assert(storyShapeOk(a), 'undo restores the story faithfully (title, hook, depth, ordered beats)')

  // Redo re-deletes; a second undo restores again (snapshot survives cycles).
  assert(redo(TL), 'redo re-applies the delete')
  assert(getStoryForMoment(a) === null, 'redo cascades the story away again')
  assert(undo(TL), 'second undo succeeds')
  assert(storyShapeOk(a), 'second undo restores the story again')

  // === Case B: undo the patch that CREATED a moment whose story came later ==
  console.log('\nCase B — undo the patch that created the moment → redo restores its story')
  const b = addMoment('Moment B')
  writeStory(b, { title: 'The Turn', hook: 'How it began', depthTier: 'deep' }, THREE_BEATS)
  assert(storyShapeOk(b), 'story present on the freshly created moment')

  // Undo the *creation* patch: this is the most recent applied patch (the writeStory
  // was NOT a patch), so undo() targets the add_node and deletes the node + story.
  assert(undo(TL), 'undo of the creating patch succeeds')
  assert(getStoryForMoment(b) === null, 'undo removes the node and cascades its story')

  assert(redo(TL), 'redo re-creates the moment')
  assert(storyShapeOk(b), 'redo restores the node AND its story (snapshot captured at undo)')

  console.log('\nundo is faithful across the story cascade ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
