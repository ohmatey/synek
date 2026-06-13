import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import type { NodeMetadata } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch, undo } from '../src/lib/db/patches'
import { applyOps, opSchema } from '../src/lib/mcp/ops'
import { collectPatchWarnings } from '../src/lib/mcp/warnings'
import { buildLayoutReport } from '../src/lib/mcp/layout-report'
import { buildGlobeBackfillPrompt } from '../src/lib/node-verb-prompts'

// GLOBE G1 data-layer proof, no SDK / no model: coordinate validation (zod bounds),
// the apply_patch store + clear round-trip, the lone-coordinate / null-island
// warnings, the get_layout_report `coordinates` section, and the backfill prompt.
// Run under Node: `bun run verify:globe`. The graph.ts DTO serializer (lat/lng →
// GraphNode) is covered by `typecheck` + the build.

const TL = 'verify-globe'
const VERIFY_EMAIL = 'verify-globe@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

const coords = (m: NodeMetadata | null) => ({ lat: m?.lat, lng: m?.lng })

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
  ensureTimeline(TL, ownerId, 'Globe verify')

  // --- 1. zod bounds on the op schema -------------------------------------
  assert(
    opSchema.safeParse({ op: 'add_node', type: 'event', title: 'In range', start: '2001', lat: 37.97, lng: 23.72 })
      .success,
    'in-range lat/lng parse on add_node',
  )
  assert(
    !opSchema.safeParse({ op: 'add_node', type: 'event', title: 'Bad lat', start: '2001', lat: 200, lng: 0 }).success,
    'lat 200 rejected (out of [-90,90])',
  )
  assert(
    !opSchema.safeParse({ op: 'add_node', type: 'event', title: 'Bad lng', start: '2001', lat: 0, lng: -200 }).success,
    'lng -200 rejected (out of [-180,180])',
  )
  assert(
    opSchema.safeParse({ op: 'update_node', id: 'x', lat: null, lng: null }).success,
    'update_node accepts lat/lng: null (clear)',
  )
  assert(
    opSchema.safeParse({ op: 'add_node', type: 'period', title: 'Era', start: '-800', geoScope: 'global' }).success,
    'add_node accepts geoScope',
  )
  assert(
    !opSchema.safeParse({ op: 'update_node', id: 'x', geoScope: 'everywhere' }).success,
    'geoScope rejects values outside global|diffuse|unknown',
  )
  assert(
    opSchema.safeParse({ op: 'update_node', id: 'x', geoScope: null }).success,
    'update_node accepts geoScope: null (clear)',
  )

  // --- 2. store round-trip via apply_patch --------------------------------
  const g0 = loadGraph(TL)
  const b1 = new PatchBuilder(TL, g0)
  const { results } = applyOps(b1, [
    {
      op: 'add_node',
      ref: 'zeno',
      type: 'entity',
      subtype: 'person',
      title: 'Globe Zeno',
      start: '-334',
      location: 'Athens, Greece',
      lat: 37.9715,
      lng: 23.7257,
    },
    {
      op: 'add_node',
      ref: 'work',
      type: 'entity',
      title: 'Globe Letters',
      start: '64',
      location: 'Rome, Italy', // location but NO coords → a backfill target
    },
  ])
  assert(results.every((r) => 'id' in r), 'both add_node ops resolved')
  commitPatch(TL, b1, 'globe coords batch')

  const g1 = loadGraph(TL)
  const zeno = g1.nodes.find((n) => n.title === 'Globe Zeno')!
  const letters = g1.nodes.find((n) => n.title === 'Globe Letters')!
  assert(coords(zeno.metadata).lat === 37.9715 && coords(zeno.metadata).lng === 23.7257, 'lat/lng stored on add_node')
  assert(zeno.metadata?.location === 'Athens, Greece', 'location stored alongside coords')
  assert(coords(letters.metadata).lat == null && letters.metadata?.location === 'Rome, Italy', 'location-only node has no coords')

  // --- 3. update sets coords, then null clears them -----------------------
  const b2 = new PatchBuilder(TL, g1)
  applyOps(b2, [{ op: 'update_node', id: letters.id, lat: 41.9028, lng: 12.4964 }])
  commitPatch(TL, b2, 'globe set coords')
  const lettersSet = loadGraph(TL).nodes.find((n) => n.id === letters.id)!
  assert(coords(lettersSet.metadata).lat === 41.9028, 'update_node sets lat/lng on a previously-uncoordinated node')

  const b3 = new PatchBuilder(TL, loadGraph(TL))
  applyOps(b3, [{ op: 'update_node', id: letters.id, lat: null, lng: null }])
  commitPatch(TL, b3, 'globe clear coords')
  const lettersCleared = loadGraph(TL).nodes.find((n) => n.id === letters.id)!
  assert(coords(lettersCleared.metadata).lat == null && coords(lettersCleared.metadata).lng == null, 'update_node lat/lng:null clears coords')
  assert(lettersCleared.metadata?.location === 'Rome, Italy', 'clearing coords leaves the location string intact')

  // --- 4. coordinate warnings (lone + null island) -----------------------
  const gw = loadGraph(TL)
  const loneWarnings = await collectPatchWarnings(
    gw,
    [{ op: 'add_node', type: 'event', title: 'Lone', start: '2001', lat: 48.85 }],
    null,
  )
  assert(loneWarnings.some((w) => w.includes('Lone') && w.includes('lng')), 'lone coordinate (lat only) warns')

  const nullIsland = await collectPatchWarnings(
    gw,
    [{ op: 'add_node', type: 'event', title: 'Null Island', start: '2001', lat: 0, lng: 0 }],
    null,
  )
  assert(nullIsland.some((w) => w.toLowerCase().includes('null island')), 'coordinates (0,0) warn as null island')

  const clean = await collectPatchWarnings(
    gw,
    [{ op: 'add_node', type: 'event', title: 'Fine', start: '2001', lat: 51.5, lng: -0.12 }],
    null,
  )
  assert(!clean.some((w) => w.includes('Fine')), 'a valid lat/lng pair produces no coordinate warning')

  const contradiction = await collectPatchWarnings(
    gw,
    [{ op: 'add_node', type: 'event', title: 'Both', start: '2001', lat: 48.85, lng: 2.35, geoScope: 'global' }],
    null,
  )
  assert(
    contradiction.some((w) => w.includes('Both') && w.includes('mutually exclusive')),
    'coords + geoScope in one op warns (coords win)',
  )

  // --- 5. get_layout_report coordinates section ---------------------------
  const report = await buildLayoutReport(TL, loadGraph(TL), null)
  assert(typeof report.coordinates === 'object', 'layout report has a coordinates section')
  assert(report.coordinates.located >= 1, `located count >= 1 (got ${report.coordinates.located})`)
  assert(report.coordinates.total >= 2, 'total counts all nodes')
  assert(report.coordinates.placeless.count === 0, 'no placeless nodes yet')
  assert(report.coordinates.unset >= 1, 'the undecided node counts as unset')
  assert(
    report.coordinates.coveragePct ===
      Math.round((report.coordinates.located / (report.coordinates.total - report.coordinates.placeless.count)) * 100),
    'coveragePct is located/placeable',
  )
  assert(report.coordinates.hasLocationNoCoords >= 1, 'the location-only node counts as a backfill target')
  assert(
    report.coordinates.sample.some((s) => s.location === 'Rome, Italy'),
    'the backfill sample names the place-bearing uncoordinated node',
  )

  // --- 6. geoScope: the placeless verdict (mutually exclusive with coords) -
  const b4 = new PatchBuilder(TL, loadGraph(TL))
  applyOps(b4, [{ op: 'update_node', id: letters.id, geoScope: 'diffuse' }])
  commitPatch(TL, b4, 'globe mark placeless')
  const lettersPlaceless = loadGraph(TL).nodes.find((n) => n.id === letters.id)!
  assert(lettersPlaceless.metadata?.geoScope === 'diffuse', 'update_node stores geoScope')

  const b5 = new PatchBuilder(TL, loadGraph(TL))
  applyOps(b5, [{ op: 'update_node', id: letters.id, lat: 41.9028, lng: 12.4964 }])
  commitPatch(TL, b5, 'globe re-pin the placeless node')
  const lettersRepinned = loadGraph(TL).nodes.find((n) => n.id === letters.id)!
  assert(
    lettersRepinned.metadata?.geoScope == null && coords(lettersRepinned.metadata).lat === 41.9028,
    'setting coordinates clears geoScope (a pin and placeless never coexist)',
  )

  const b6 = new PatchBuilder(TL, loadGraph(TL))
  applyOps(b6, [{ op: 'update_node', id: letters.id, geoScope: 'unknown' }])
  commitPatch(TL, b6, 'globe back to placeless')
  const lettersUnknown = loadGraph(TL).nodes.find((n) => n.id === letters.id)!
  assert(
    lettersUnknown.metadata?.geoScope === 'unknown' && coords(lettersUnknown.metadata).lat == null,
    'setting geoScope clears coordinates',
  )

  // --- 7. convergence: placeless resolves the coverage loop ----------------
  const report2 = await buildLayoutReport(TL, loadGraph(TL), null)
  assert(report2.coordinates.placeless.count === 1, 'placeless node is counted')
  assert(report2.coordinates.placeless.byScope.unknown === 1, 'placeless byScope tallies the verdict')
  assert(report2.coordinates.unset === 0, 'no undecided nodes remain')
  assert(report2.coordinates.coveragePct === 100, 'coverage converges to 100% once every node is pinned or marked')
  assert(report2.coordinates.hasLocationNoCoords === 0, 'a placeless node is NOT a backfill target')
  assert(report2.coordinates.sample.length === 0, 'the backfill sample is empty — the loop is done')

  // --- 8. backfill prompt -------------------------------------------------
  const prompt = buildGlobeBackfillPrompt({ timelineId: TL, title: 'Globe verify' })
  assert(prompt.includes('lat') && prompt.includes('lng'), 'backfill prompt instructs lat/lng')
  assert(prompt.includes('geoScope'), 'backfill prompt offers the placeless verdict')
  assert(prompt.includes('get_layout_report') && prompt.includes('apply_patch'), 'backfill prompt routes through the MCP tools')

  // --- cleanup (idempotent): undo the 6 committed batches -----------------
  undo(TL)
  undo(TL)
  undo(TL)
  undo(TL)
  undo(TL)
  undo(TL)
  console.log('\nGlobe G1 data contract verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
