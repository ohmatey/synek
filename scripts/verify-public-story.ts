import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, nodes } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import {
  ensureTimeline,
  loadGraph,
  getTimelineMeta,
  setTimelinePublic,
  nodesByIds,
  nodeRowToGraphNode,
} from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, getStoryBySlug, referencedNodeIds, getMomentTimelineId } from '../src/lib/db/stories'

// Proves the SHARABLE-STORY data path WITHOUT a browser: write a story carrying
// per-beat widgets (entity / globe / timeline) onto a moment, then assert the
// widget JSON round-trips through hydrate, the slug resolves, the referenced node
// set (cast + focus + widget ids) is collected and fetchable, and the public gate
// keys off the timeline's isPublic flag. Run under Node: `tsx scripts/verify-public-story.ts`.

const TL = 'verify-public-story'
const VERIFY_EMAIL = 'verify-public-story@synek.app'

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
  ensureTimeline(TL, ownerId, 'Public story verify')
  db.delete(nodes).where(eq(nodes.timelineId, TL)).run()

  // A moment + the cast/focus/widget targets: a place, two located people, an era.
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [
    { op: 'add_node', ref: 'm', type: 'event', title: 'The founding', start: '2008' },
    { op: 'add_node', ref: 'place', type: 'entity', title: 'The Porch', start: '2008', location: 'Athens', lat: 37.97, lng: 23.72 },
    { op: 'add_node', ref: 'p1', type: 'entity', title: 'Zeno', start: '2008', location: 'Citium', lat: 34.92, lng: 33.63 },
    { op: 'add_node', ref: 'p2', type: 'entity', title: 'Marcus', start: '2010', location: 'Rome', lat: 41.89, lng: 12.49 },
    { op: 'add_node', ref: 'era', type: 'period', title: 'Early Stoa', start: '2008', end: '2009' },
  ])
  commitPatch(TL, builder, 'verify public story nodes')
  const [moment, place, p1, p2, era] = results.map((r) => (r as { id: string }).id)
  assert(!!moment && !!place && !!p1 && !!p2 && !!era, 'created moment + cast/focus/widget target nodes')

  // Write a story with a PINNED slug, a cast, and a widget on each beat.
  writeStory(
    moment,
    {
      title: 'A shared story',
      slug: 'a-shared-story-fixed',
      hook: 'A live, widget-rich tale.',
      depthTier: 'deep',
      cast: [{ nodeId: p1, role: 'founder' }, { nodeId: p2, role: 'emperor' }],
    },
    [
      {
        bodyText: 'It began at a porch.',
        focusNodeId: p1,
        widget: { kind: 'entity', nodeIds: [place], caption: 'Where it began.' },
      },
      {
        bodyText: 'The idea crossed the sea.',
        widget: { kind: 'globe', nodeIds: [p1, p2], focusNodeId: p1, caption: 'Cyprus to Rome.' },
      },
      {
        bodyText: 'Across five centuries.',
        widget: { kind: 'timeline', nodeIds: [era, p1, p2], focusNodeId: era },
      },
    ],
  )

  // The slug resolves and the story + widget JSON round-trip through hydrate.
  const found = getStoryBySlug('a-shared-story-fixed')
  assert(!!found, 'getStoryBySlug resolves the pinned slug')
  assert(found!.story.slug === 'a-shared-story-fixed', 'StoryDTO carries the slug')
  assert(found!.momentId === moment, 'getStoryBySlug returns the moment id')
  assert(found!.status === 'published', 'a written story is published')

  const beats = found!.story.beats
  assert(beats.length === 3, 'the story has 3 beats')
  assert(beats[0]!.widget?.kind === 'entity' && beats[0]!.widget.nodeIds[0] === place, 'entity widget round-trips')
  assert(
    beats[1]!.widget?.kind === 'globe' && beats[1]!.widget.focusNodeId === p1 && beats[1]!.widget.nodeIds.length === 2,
    'globe widget round-trips (nodeIds + focus)',
  )
  assert(
    beats[2]!.widget?.kind === 'timeline' && beats[2]!.widget.caption == null && beats[2]!.widget.focusNodeId === era,
    'timeline widget round-trips (focus; optional caption absent)',
  )

  // The referenced-node set: cast (p1,p2) + beat focus (p1) + widget ids (place, p1, p2, era).
  const refs = new Set(referencedNodeIds(found!.story))
  for (const [id, name] of [
    [place, 'widget place'],
    [p1, 'cast/focus/widget person'],
    [p2, 'cast/widget person'],
    [era, 'widget era'],
  ] as const) {
    assert(refs.has(id), `referencedNodeIds includes the ${name}`)
  }
  assert(!refs.has(moment), 'referencedNodeIds does not include the un-referenced moment')

  // …and those nodes are fetchable as render-ready DTOs for the page.
  const shipped = nodesByIds(TL, [...refs]).map(nodeRowToGraphNode)
  assert(shipped.length === refs.size, 'nodesByIds returns one DTO per referenced id')
  const zeno = shipped.find((n) => n.id === p1)!
  assert(zeno.lat === 34.92 && zeno.lng === 33.63, 'a located node ships its coordinates (globe widget)')

  // The public GATE keys off the timeline's isPublic flag (no per-story flag).
  setTimelinePublic(TL, ownerId, true)
  assert(getTimelineMeta(TL)!.isPublic === true, 'after share, the timeline is public (page serves)')
  setTimelinePublic(TL, ownerId, false)
  assert(getTimelineMeta(TL)!.isPublic === false, 'a private timeline gates the page (getPublicStory → null)')

  // moment → timeline resolution (the loader seam).
  assert(getMomentTimelineId(moment) === TL, 'getMomentTimelineId resolves the moment to its timeline')

  console.log('\nsharable-story data path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
