// Demo-readiness guard for the seed timelines. Each one must (1) clear the globe
// coverage gate — globeCoverage().sufficient, the same gate the ViewSwitcher uses —
// and (2) carry at least one *cross-globe* story: a story whose beats focus ≥3
// distinct LOCATED nodes, so pressing Play on it actually sweeps the globe across
// places (GS1). A timeline that quietly drops below the gate, loses its story, or
// whose story collapses to one location fails loudly here.
//
// Run under Node (Node 22 ABI for better-sqlite3), e.g. `tsx scripts/verify-seed-demo.ts`.
// Reads whatever DATABASE_URL points at (default local.db) — run after a seed.
import { eq, inArray } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { nodes, stories, storySegments } from '../src/lib/db/schema'
import { globeCoverage } from '../src/components/canvas/globe-coverage'
import type { GraphNode } from '../src/lib/domain/types'

const SEED_IDS = ['stoicism', 'observability', 'deep-learning', 'space-race', 'roman-republic', 'figures']
const MIN_STORY_SPREAD = 3 // distinct located beat foci required in at least one story

let failures = 0
for (const id of SEED_IDS) {
  const rows = db.select().from(nodes).where(eq(nodes.timelineId, id)).all()
  // Hoist lat/lng/geoScope/location out of the metadata JSON, the shape globeCoverage
  // reads (mirrors src/lib/server/graph.ts). Only those fields are exercised, so a
  // partial cast to GraphNode is safe here.
  const gnodes = rows.map((n) => {
    const m = (n.metadata ?? {}) as { lat?: number; lng?: number; geoScope?: string; location?: string }
    return { ...n, lat: m.lat ?? null, lng: m.lng ?? null, geoScope: m.geoScope ?? null, location: m.location ?? null }
  }) as unknown as GraphNode[]
  const cov = globeCoverage(gnodes)
  const locatedIds = new Set(gnodes.filter((n) => n.lat != null && n.lng != null).map((n) => n.id))

  const nodeIds = rows.map((n) => n.id)
  const tlStories = nodeIds.length
    ? db.select().from(stories).where(inArray(stories.momentId, nodeIds)).all()
    : []
  let bestSpread = 0
  let bestStory = ''
  for (const s of tlStories) {
    const segs = db.select().from(storySegments).where(eq(storySegments.storyId, s.id)).all()
    const distinct = new Set(
      segs.map((g) => g.focusNodeId).filter((f): f is string => !!f && locatedIds.has(f)),
    )
    if (distinct.size > bestSpread) {
      bestSpread = distinct.size
      bestStory = s.title
    }
  }

  const ok = cov.sufficient && tlStories.length >= 1 && bestSpread >= MIN_STORY_SPREAD
  if (!ok) failures++
  console.log(
    `${ok ? '✓' : '✗'} ${id.padEnd(16)} ` +
      `globe ${cov.located}/${cov.total - cov.placeless} located (${cov.coveragePct}%${cov.sufficient ? '' : ', BELOW GATE'}) · ` +
      `${tlStories.length} stor${tlStories.length === 1 ? 'y' : 'ies'} · ` +
      `best story "${bestStory}" spans ${bestSpread} located place${bestSpread === 1 ? '' : 's'}`,
  )
}

if (failures) {
  console.error(`\n✗ ${failures} seed timeline(s) are not demo-ready (globe gate + cross-globe story).`)
  process.exit(1)
}
console.log('\n✓ All seed timelines clear the globe gate and carry a cross-globe story.')
