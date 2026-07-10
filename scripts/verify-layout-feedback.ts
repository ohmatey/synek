import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps, type Op, type OpResult } from '../src/lib/mcp/ops'
import { collectPatchWarnings } from '../src/lib/mcp/warnings'
import { buildLayoutReport } from '../src/lib/mcp/layout-report'

// Proves the connected-distance feedback loop WITHOUT the SDK or a model: the
// batch-scoped "connected but far apart" apply_patch warning (fires, stays
// silent, respects its cap) and the layout report's `grouping` section. No op
// carries an image/citation URL, so no network is touched. Run under Node:
// `bun run verify:layout-feedback`.

const TL = 'verify-layout-feedback'
const VERIFY_EMAIL = 'verify@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

const isDistanceWarning = (w: string) => w.includes('are connected (')

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

async function patch(ops: Op[], summary: string): Promise<{ results: OpResult[]; warnings: string[] }> {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, ops)
  commitPatch(TL, builder, summary)
  const warnings = await collectPatchWarnings(loadGraph(TL), ops, null, results)
  return { results, warnings }
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Layout feedback verify')

  // Two dense clusters (1900s + 1980s) and a spanning entity — no edges yet.
  const seed = await patch(
    [
      { op: 'add_node', ref: 'a1', type: 'event', title: 'Alpha 1900', start: '1900', lane: 'Alpha' },
      { op: 'add_node', ref: 'a2', type: 'event', title: 'Alpha 1902', start: '1902', lane: 'Alpha' },
      { op: 'add_node', ref: 'a3', type: 'event', title: 'Alpha 1904', start: '1904', lane: 'Alpha' },
      { op: 'add_node', ref: 'a4', type: 'event', title: 'Alpha 1906', start: '1906', lane: 'Alpha' },
      { op: 'add_node', ref: 'a5', type: 'event', title: 'Alpha 1908', start: '1908', lane: 'Alpha' },
      { op: 'add_node', ref: 'b1', type: 'event', title: 'Beta 1980', start: '1980' },
      { op: 'add_node', ref: 'b2', type: 'event', title: 'Beta 1982', start: '1982' },
      { op: 'add_node', ref: 'b3', type: 'event', title: 'Beta 1984', start: '1984' },
      { op: 'add_node', ref: 'b4', type: 'event', title: 'Beta 1986', start: '1986' },
      { op: 'add_node', ref: 'b5', type: 'event', title: 'Beta 1988', start: '1988' },
      { op: 'add_node', ref: 'org', type: 'entity', subtype: 'org', title: 'Long Org', start: '1900', end: '1990' },
    ],
    'seed two clusters',
  )
  assert(seed.results.every((r) => 'id' in r), 'seed batch applied cleanly')
  const idOf = (title: string) => loadGraph(TL).nodes.find((n) => n.title === title)!.id

  // 1. A cross-cluster edge in this batch fires the warning.
  const long = await patch(
    [{ op: 'add_edge', sourceId: idOf('Alpha 1900'), targetId: idOf('Beta 1988'), kind: 'caused' }],
    'long edge',
  )
  const longHits = long.warnings.filter(isDistanceWarning)
  assert(longHits.length === 1, 'cross-cluster edge warns exactly once')
  assert(
    longHits[0]!.includes('Alpha 1900') && longHits[0]!.includes('Beta 1988') && longHits[0]!.includes('caused'),
    'warning names both titles and the edge kind',
  )
  assert(/~\d+y apart/.test(longHits[0]!), 'warning states the distance in years')

  // 2. A short edge (2y apart) stays silent.
  const short = await patch(
    [{ op: 'add_edge', sourceId: idOf('Beta 1982'), targetId: idOf('Beta 1984'), kind: 'succeeded' }],
    'short edge',
  )
  assert(short.warnings.filter(isDistanceWarning).length === 0, '2y edge does not warn')

  // 3. A spanning entity overlapping its target stays silent (interval distance 0).
  const overlap = await patch(
    [{ op: 'add_edge', sourceId: idOf('Long Org'), targetId: idOf('Beta 1984'), kind: 'influenced' }],
    'overlapping entity edge',
  )
  assert(overlap.warnings.filter(isDistanceWarning).length === 0, 'spanning-entity edge does not warn')

  // 4. Batch scoping: a summary-only edit on a long-edge endpoint does not re-warn.
  const summaryOnly = await patch(
    [{ op: 'update_node', id: idOf('Alpha 1900'), summary: 'just prose' }],
    'summary-only edit',
  )
  assert(summaryOnly.warnings.filter(isDistanceWarning).length === 0, 'summary-only patch does not re-warn old edges')

  // 5. Cap: four long edges in one batch → 3 warnings + one aggregate line.
  const capped = await patch(
    [
      { op: 'add_edge', sourceId: idOf('Alpha 1902'), targetId: idOf('Beta 1982'), kind: 'influenced' },
      { op: 'add_edge', sourceId: idOf('Alpha 1904'), targetId: idOf('Beta 1984'), kind: 'influenced' },
      { op: 'add_edge', sourceId: idOf('Alpha 1906'), targetId: idOf('Beta 1986'), kind: 'influenced' },
      { op: 'add_edge', sourceId: idOf('Alpha 1908'), targetId: idOf('Beta 1980'), kind: 'influenced' },
    ],
    'four long edges',
  )
  assert(capped.warnings.filter(isDistanceWarning).length === 3, 'distance warnings cap at 3 per batch')
  assert(capped.warnings.some((w) => w.includes('more long-reach')), 'overflow is summarized in an aggregate line')

  // 6. The layout report's grouping section.
  const report = await buildLayoutReport(TL, loadGraph(TL), null)
  const g = report.grouping
  assert(g.componentCount >= 2, `connected components counted (${g.componentCount})`)
  assert(g.components[0]!.note != null, 'sprawling component is flagged first with a note')
  assert(g.components[0]!.spanPct >= 60, `flagged component spans most of the axis (${g.components[0]!.spanPct}%)`)
  assert(g.components[0]!.lanes.includes('Alpha'), 'component lane spread lists the lane')
  assert(g.components[0]!.unlanedCount > 0, 'component reports its unlaned members')
  const top = g.longestEdges[0]!
  assert(top.source === 'Alpha 1900' && top.target === 'Beta 1988', 'longest edge names the widest pair')
  assert(top.years >= 80 && top.pctOfSpan >= 90, `longest edge measured (${top.years}y, ${top.pctOfSpan}%)`)
  assert(top.crossesDeadZone === true, 'longest edge crosses the inter-cluster dead zone')
  assert(g.isolatedNodeCount === 0, 'every node is edge-connected in this fixture')

  console.log('\nLayout feedback loop verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
