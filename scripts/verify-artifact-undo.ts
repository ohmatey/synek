import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, storySegments, segmentCitations, storyArtifacts, momentArtifacts } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch, undo, redo } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, getStoryForMoment } from '../src/lib/db/stories'
import { registerArtifact, getArtifactById } from '../src/lib/db/artifacts'

// Proves the S2.2 join writes AND the two-site undo-safety (ADR 0001):
//  - write_story v2 writes segment_citations + story_artifacts; hydrate merges them.
//  - deleting a moment (or undoing the patch that created it) cascades the story +
//    ALL its join rows + moment_artifacts; undo restores every one; redo drops them.
//  - the artifacts THEMSELVES survive a node delete (only the joins cascade).
// Run under Node: `bun run verify:artifact-undo`.

const TL = 'verify-artifact-undo'
const VERIFY_EMAIL = 'verify-artifact-undo@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureVerifyUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: VERIFY_EMAIL, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    /* exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, VERIFY_EMAIL)).get()
  if (!row) throw new Error('could not create the verify user')
  return row.id
}

function addMoment(title: string): string {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [{ op: 'add_node', ref: 'm', type: 'event', title, start: '100' }])
  commitPatch(TL, builder, `add ${title}`)
  return (results[0] as { id: string }).id
}

function deleteMoment(momentId: string): void {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  applyOps(builder, [{ op: 'delete_node', id: momentId }])
  commitPatch(TL, builder, `delete ${momentId}`)
}

// Join-row counts for a story / moment.
function segCites(storyId: string): number {
  return db
    .select({ id: segmentCitations.segmentId })
    .from(segmentCitations)
    .innerJoin(storySegments, eq(segmentCitations.segmentId, storySegments.id))
    .where(eq(storySegments.storyId, storyId))
    .all().length
}
const storyArts = (storyId: string) =>
  db.select().from(storyArtifacts).where(eq(storyArtifacts.storyId, storyId)).all().length
const momentArts = (momentId: string) =>
  db.select().from(momentArtifacts).where(eq(momentArtifacts.momentId, momentId)).all().length

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Artifact undo verify')

  // === join writes + hydrate merge =========================================
  console.log('write_story v2 — segment_citations + story_artifacts + hydrate merge')
  const m = addMoment('Vindolanda')
  const a1 = registerArtifact({ ownerId, artifact: { title: 'Tablet 291', artifactType: 'letter', transcript: 'birthday invitation' }, momentId: m }).artifactId
  const a2 = registerArtifact({ ownerId, artifact: { title: 'Tablet 343', artifactType: 'letter', transcript: 'a request for supplies' } }).artifactId
  assert(momentArts(m) === 1, 'registerArtifact linked a1 to the moment (moment_artifacts)')

  const { storyId } = writeStory(
    m,
    { title: 'Letters from the wall', depthTier: 'deep' },
    [
      { bodyText: 'She wrote inviting her friend.', artifactCitations: [{ artifactId: a1, excerptUsed: 'birthday invitation' }] },
      { bodyText: 'A passing remark.', citations: [{ title: 'Bowman 1994', sourceType: 'scholarship' }] },
      { bodyText: 'And the garrison needed supplies.', artifactCitations: [{ artifactId: a2 }] },
    ],
  )
  assert(segCites(storyId) === 2, 'two segment_citations written (a1, a2)')
  assert(storyArts(storyId) === 2, 'two story_artifacts derived from the cited artifacts')

  const story = getStoryForMoment(m)!
  assert(story.beats[0]!.citations.some((c) => c.artifactId === a1 && c.title === 'Tablet 291'), 'beat 0 merges artifact a1 (title from the artifact)')
  assert(story.beats[1]!.citations.some((c) => c.title === 'Bowman 1994' && !c.artifactId), 'beat 1 keeps its inline one-off citation')
  assert(story.beats[2]!.citations.some((c) => c.artifactId === a2), 'beat 2 merges artifact a2')

  // replace-in-place: rewrite citing only a2 → old joins cascade, new ones replace
  writeStory(m, { title: 'Letters from the wall' }, [{ bodyText: 'Only supplies now.', artifactCitations: [{ artifactId: a2 }] }], { storyId })
  assert(segCites(storyId) === 1 && storyArts(storyId) === 1, 'same-storyId rewrite cascaded old joins and replaced them')

  // === Case A: delete the moment → undo restores story + ALL joins =========
  console.log('\nCase A — delete moment with artifacts+story → undo restores everything')
  deleteMoment(m)
  assert(getStoryForMoment(m) === null, 'delete cascades the story away')
  assert(segCites(storyId) === 0 && storyArts(storyId) === 0 && momentArts(m) === 0, 'all join rows cascaded away')
  assert(!!getArtifactById(a1, ownerId) && !!getArtifactById(a2, ownerId), 'the artifacts THEMSELVES survive (only joins cascaded)')

  assert(undo(TL), 'undo of the delete succeeds')
  assert(getStoryForMoment(m)?.beats.length === 1, 'undo restores the story')
  assert(segCites(storyId) === 1, 'undo restores segment_citations')
  assert(storyArts(storyId) === 1, 'undo restores story_artifacts')
  assert(momentArts(m) === 1, 'undo restores moment_artifacts')
  assert(getStoryForMoment(m)!.beats[0]!.citations.some((c) => c.artifactId === a2), 'restored story still merges its artifact citation')

  assert(redo(TL), 'redo re-deletes')
  assert(segCites(storyId) === 0 && storyArts(storyId) === 0 && momentArts(m) === 0, 'redo drops all joins again')
  assert(undo(TL), 'second undo')
  assert(segCites(storyId) === 1 && storyArts(storyId) === 1 && momentArts(m) === 1, 'second undo restores all joins (survives cycles)')

  // === Case B: undo the CREATING patch → redo restores joins ===============
  console.log('\nCase B — undo the patch that created the moment → redo restores its joins')
  const b = addMoment('Bremenium')
  const a3 = registerArtifact({ ownerId, artifact: { title: 'Altar of Mithras', artifactType: 'inscription', transcript: 'a dedication' }, momentId: b }).artifactId
  const { storyId: sb } = writeStory(b, { title: 'The dedication' }, [{ bodyText: 'He carved it.', artifactCitations: [{ artifactId: a3 }] }])
  assert(segCites(sb) === 1 && momentArts(b) === 1, 'story + joins present on the new moment')

  assert(undo(TL), 'undo of the creating patch')
  assert(getStoryForMoment(b) === null && momentArts(b) === 0, 'undo removes the node and cascades story + moment_artifacts')
  assert(!!getArtifactById(a3, ownerId), 'the artifact survives the create-undo')

  assert(redo(TL), 'redo re-creates the moment')
  assert(getStoryForMoment(b)?.beats.length === 1 && segCites(sb) === 1 && momentArts(b) === 1, 'redo restores node + story + all joins')

  console.log('\nS2.2 join writes + two-site undo-safety ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
