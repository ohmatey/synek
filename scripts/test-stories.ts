// Data-layer test for the story service — no AI key needed (drives the DB layer
// directly with a synthetic story object). Run under Node (better-sqlite3 ABI):
//   NODE_ENV=test bunx tsx scripts/test-stories.ts
// NODE_ENV=test → in-memory DB (see src/lib/db/index.ts), migrations apply on import.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { timelines, nodes, edges, generations } from '../src/lib/db/schema'
import {
  ensureStoryTemplate,
  computeCacheKey,
  commitStory,
  getStoryById,
  getLiveStoriesForMoment,
  findLiveStoryByCacheKey,
  loadMomentContext,
} from '../src/lib/db/stories'
import type { StoryObject } from '../src/lib/ai/generate'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name}`)
  }
}

// --- fixture: a timeline with a moment + two neighbors; only nbrA is edge-linked
const TL = randomUUID()
db.insert(timelines).values({ id: TL, title: 'Test' }).run()
const moment = randomUUID()
const nbrA = randomUUID()
const nbrB = randomUUID()
for (const [id, title] of [
  [moment, 'Moment'],
  [nbrA, 'Neighbor A'],
  [nbrB, 'Neighbor B'],
] as const) {
  db.insert(nodes).values({ id, timelineId: TL, type: 'event', title, startInstant: 0, precision: 'year' }).run()
}
db.insert(edges).values({ timelineId: TL, sourceId: moment, targetId: nbrA, kind: 'caused' }).run()

// --- 1: template find-or-create is idempotent
const t1 = ensureStoryTemplate()
const t2 = ensureStoryTemplate()
check('ensureStoryTemplate is idempotent', t1.id === t2.id)
check('template purpose is story', t1.purpose === 'story')

// --- 2: cache key is deterministic and input-sensitive
const inputs = { model: 'm', moment: { id: moment }, neighbors: [{ id: nbrA }] }
const key = computeCacheKey(t1.id, inputs)
check('computeCacheKey is deterministic', key === computeCacheKey(t1.id, inputs))
check('computeCacheKey varies by inputs', key !== computeCacheKey(t1.id, { ...inputs, model: 'n' }))

// --- 3: context = moment + edge-linked neighbors only
const ctx = loadMomentContext(moment)
check('loadMomentContext finds the moment', ctx?.moment.id === moment)
check('context includes edge-linked neighbor (nbrA)', !!ctx?.neighbors.some((n) => n.id === nbrA))
check('context excludes non-linked node (nbrB)', !ctx?.neighbors.some((n) => n.id === nbrB))

// --- 4: commit writes story+segments+generation in one txn; filters relatedNodeIds
const obj: StoryObject = {
  title: 'A Test Story',
  hook: 'A hook.',
  estimatedMinutes: 2,
  segments: [
    { kind: 'narration', bodyText: 'Beat one.', relatedNodeIds: [nbrA, 'BOGUS-ID'] },
    { kind: 'sensory', bodyText: 'Rain on stone.', settingNote: 'cold' },
    { kind: 'dialogue', bodyText: '"Hello."' },
  ],
}
const story = commitStory({
  momentId: moment,
  template: t1,
  modelSlug: 'test-model',
  cacheKey: key,
  promptInputs: inputs,
  object: obj,
  neighborIds: [nbrA],
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 5,
})
check('commit returns 3 segments', story.segments.length === 3)
check('segments are sequence-ordered', story.segments.every((s, i) => s.sequence === i))
check('relatedNodeIds keeps the real neighbor', story.segments[0].relatedNodeIds.includes(nbrA))
check('relatedNodeIds drops the bogus id', !story.segments[0].relatedNodeIds.includes('BOGUS-ID'))
check(
  'story is draft + light + omniscient',
  story.status === 'draft' && story.depthTier === 'light' && story.povType === 'omniscient',
)
const genRow = db.select().from(generations).where(eq(generations.targetId, story.id)).get()
check('generation recorded (model + tokens + latency)', genRow?.model === 'test-model' && genRow?.inputTokens === 10)
check('generation stores the cache key', genRow?.cacheKey === key)

// --- 5: cache hit — a live story exists for the key (generateStory short-circuits)
check('findLiveStoryByCacheKey returns the committed story', findLiveStoryByCacheKey(key)?.id === story.id)

// --- 6: regenerate archives the prior; cache resolves to the new live story
const story2 = commitStory({
  momentId: moment,
  template: t1,
  modelSlug: 'test-model',
  cacheKey: key,
  promptInputs: inputs,
  object: { ...obj, title: 'A Test Story v2' },
  neighborIds: [nbrA],
  inputTokens: 11,
  outputTokens: 21,
  latencyMs: 6,
  archivePriorId: story.id,
})
const live = getLiveStoriesForMoment(moment)
check('after regenerate, exactly one live story', live.length === 1)
check('the live story is the new one', live[0]?.id === story2.id)
check('the prior story is archived', getStoryById(story.id)?.status === 'archived')
check('cache (same key) now resolves to the new live story', findLiveStoryByCacheKey(key)?.id === story2.id)

console.log(`\n${fail === 0 ? '✅' : '❌'} stories data-layer: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
