import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, nodes } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import {
  writeStory,
  getStoryForMoment,
  storyDepthByMoment,
  storyVersionForMoments,
  listStoriesForTimeline,
  getMomentTimelineId,
} from '../src/lib/db/stories'

// Proves the write_story data path (N.5.1/N.5.2/N.5.3) WITHOUT the SDK: add a
// node (a "moment") via the normal Patch path, write a story onto it, then assert
// playback (ordered beats), the depth-badge lookup, and replace-semantics. Run
// under Node: `tsx scripts/verify-story.ts`.

const TL = 'verify-story'
const VERIFY_EMAIL = 'verify-story@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureVerifyUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: VERIFY_EMAIL, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    // already exists — fine
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, VERIFY_EMAIL)).get()
  if (!row) throw new Error('could not create the verify user')
  return row.id
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Story verify')
  // Fresh slate: the timeline id is fixed, so prior runs leave moments + stories
  // behind and the per-timeline count assertions below would drift. Node deletes
  // cascade to edges and stories.
  db.delete(nodes).where(eq(nodes.timelineId, TL)).run()

  // Add a fresh moment node to attach the story to, plus a second node a beat can
  // FOCUS on (the per-beat spotlight that drives the canvas + dialog).
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [
    { op: 'add_node', ref: 'm', type: 'event', title: 'A moment', start: '2008' },
    { op: 'add_node', ref: 'f', type: 'entity', title: 'A focused entity', start: '2008' },
  ])
  commitPatch(TL, builder, 'verify story moment')
  const momentId = (results[0] as { id: string }).id
  const focusId = (results[1] as { id: string }).id
  assert(!!momentId, 'created a moment node')
  assert(!!focusId, 'created a focus-target node')

  // moment → timeline resolution (the owner-check seam for write_story).
  assert(getMomentTimelineId(momentId) === TL, 'getMomentTimelineId resolves the moment to its timeline')
  assert(getMomentTimelineId('does-not-exist') === null, 'getMomentTimelineId returns null for a missing node')

  // Write a 3-beat story (with cover art, a cast, and one beat image — the
  // story-texture fields added alongside the MCP write_story upgrade).
  const w = writeStory(
    momentId,
    {
      title: 'The Turn',
      hook: 'How it began',
      depthTier: 'deep',
      coverImage: { url: 'https://example.com/cover.jpg', alt: 'Cover art', aspect: 'landscape' },
      cast: [
        { nodeId: focusId, role: 'the witness' },
        { name: 'Unmade Character', role: 'mentioned only' },
      ],
    },
    [
      { bodyText: 'Beat one.', kind: 'narration' },
      {
        bodyText: 'Beat two.',
        kind: 'dialogue',
        settingNote: 'rain on glass',
        focusNodeId: focusId,
        image: { url: 'https://example.com/beat.jpg', aspect: 'portrait', layout: 'inset-left' },
      },
      {
        bodyText: 'Beat three.',
        kind: 'sensory',
        relatedNodeIds: [momentId],
        citations: [
          { title: 'A primary source', url: 'https://example.com/doc', quote: 'the exact words' },
          { title: 'A second source' },
        ],
      },
    ],
  )
  assert(w.segmentCount === 3, 'writeStory reports 3 segments')

  // Playback DTO: title/hook/depth + ordered beats.
  const story = getStoryForMoment(momentId)
  assert(!!story, 'getStoryForMoment returns the story')
  assert(story!.title === 'The Turn' && story!.hook === 'How it began', 'story title + hook round-trip')
  assert(story!.depthTier === 'deep', 'depthTier round-trips')
  assert(story!.beats.length === 3, 'story has 3 beats')
  assert(
    story!.beats[0]!.sequence === 0 && story!.beats[1]!.sequence === 1 && story!.beats[2]!.sequence === 2,
    'beats are ordered by sequence',
  )
  assert(story!.beats[2]!.relatedNodeIds.length === 1, 'beat relatedNodeIds round-trip')

  // Per-beat focus (the entity the canvas + dialog spotlight on that beat) round-trips.
  assert(story!.beats[1]!.focusNodeId === focusId, 'beat focusNodeId round-trips')
  assert(story!.beats[0]!.focusNodeId === null, 'a beat without a focus reads back as null')

  // Story texture: cover art, cast, and beat images round-trip.
  assert(story!.coverImage?.url === 'https://example.com/cover.jpg', 'coverImage round-trips')
  assert(
    story!.cast.length === 2 && story!.cast[0]!.nodeId === focusId && story!.cast[1]!.name === 'Unmade Character',
    'cast (node-backed + name-only) round-trips',
  )
  assert(
    story!.beats[1]!.image?.url === 'https://example.com/beat.jpg' && story!.beats[1]!.image?.layout === 'inset-left',
    'beat image + layout round-trip',
  )
  assert(story!.beats[0]!.image === null, 'a beat without an image reads back as null')

  // S2 slice 1 — per-beat citations (real source grounding) round-trip.
  assert(story!.beats[0]!.citations.length === 0, 'a beat without citations reads back as []')
  const cites = story!.beats[2]!.citations
  assert(cites.length === 2, 'beat citations round-trip (count)')
  assert(
    cites[0]!.title === 'A primary source' &&
      cites[0]!.url === 'https://example.com/doc' &&
      cites[0]!.quote === 'the exact words',
    'beat citation title + url + quote round-trip',
  )
  assert(cites[1]!.title === 'A second source' && !cites[1]!.url && !cites[1]!.quote, 'a title-only citation round-trips')

  // Depth-badge lookup for the canvas.
  const depths = storyDepthByMoment([momentId])
  assert(depths.get(momentId) === 'deep', 'storyDepthByMoment reports the moment + depth')

  // Story-version signature (the poll-based seam that refreshes an open reader for
  // separate-process/stdio writes the in-process SSE bus can't reach).
  assert(storyVersionForMoments([]) === '', 'storyVersionForMoments is empty for no moments')
  const ver1 = storyVersionForMoments([momentId])
  assert(ver1 !== '' && ver1.startsWith(momentId), 'storyVersionForMoments reflects the moment with a story')

  // AppBar Stories dropdown source: the timeline lists its one story with metadata.
  const list = listStoriesForTimeline(TL)
  assert(list.length === 1, 'listStoriesForTimeline returns the timeline’s one story')
  assert(list[0]!.momentId === momentId && list[0]!.title === 'The Turn', 'list item carries moment id + story title')
  assert(list[0]!.momentTitle === 'A moment', 'list item carries the moment title')
  assert(list[0]!.beatCount === 3 && list[0]!.depthTier === 'deep', 'list item reports beat count + depth')
  assert(listStoriesForTimeline('no-such-timeline').length === 0, 'listStoriesForTimeline is empty for an unknown timeline')

  // Multi-story semantics: a no-storyId write CREATES A SECOND story on the
  // moment (update-in-place requires the storyId — covered by verify:multi-story).
  const w2 = writeStory(momentId, { title: 'The Turn (v2)' }, [{ bodyText: 'Only beat.' }])
  assert(w2.segmentCount === 1, 'second write reports 1 segment')
  assert(w2.storyId !== w.storyId, 'a no-storyId write mints a NEW story')
  const story2 = getStoryForMoment(momentId)
  assert(story2!.title === 'The Turn (v2)' && story2!.beats.length === 1, 'getStoryForMoment returns the newest story')
  assert(listStoriesForTimeline(TL).length === 2, 'the moment now holds BOTH stories')
  assert(storyDepthByMoment([momentId]).get(momentId) === 'deep', 'depth badge reports the DEEPEST story across the set')

  // A new story shifts the signature even though the depth badge is unchanged —
  // this is exactly what lets the canvas refresh an open reader on a stdio write.
  const ver2 = storyVersionForMoments([momentId])
  assert(ver2 !== ver1, 'storyVersionForMoments shifts after a write (open reader will refresh)')

  console.log('\nwrite_story path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
