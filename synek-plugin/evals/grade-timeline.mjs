#!/usr/bin/env node
// Deterministic quality grader for a Synek timeline graph. Encodes the
// `building-timelines` skill rubric so a built timeline can be scored without a
// human — and so the swimlane guidance can be regression-tested.
//
// Input: a timeline graph JSON, either the MCP `get_timeline` shape
//   { title, nodes:[{..,metadata:{lane,subtype,citations}}], edges:[..] }
// or the flattened DTO shape ({ nodes:[{lane,subtype,citations,..}] }).
// Both are accepted — fields are read from the top level OR `metadata`.
//
// Usage:
//   node grade-timeline.mjs <graph.json> [--multi-track] [--min-lanes N] [--json]
//   get_timeline-output.json | node grade-timeline.mjs - --multi-track
//
// Exit code: 0 if the timeline passes the rubric, 1 if it fails, 2 on bad input.

import { readFileSync } from 'node:fs'

// A node ~130px wide at the base axis density (0.5 px/day) ≈ 260 days. Two nodes
// in the same layout group whose dates fall within this window collide and get
// pushed onto a new row — the mechanic behind the "stacked spaghetti" failure.
const NOMINAL_DAYS = 260
const MS_PER_DAY = 86_400_000

function readArgs(argv) {
  const args = { file: null, multiTrack: false, minLanes: 2, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--multi-track') args.multiTrack = true
    else if (a === '--json') args.json = true
    else if (a === '--min-lanes') args.minLanes = Number(argv[++i])
    else if (!a.startsWith('--')) args.file = a
  }
  return args
}

function loadGraph(file) {
  const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')
  const g = JSON.parse(raw)
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error('expected JSON with `nodes` and `edges` arrays (get_timeline output)')
  }
  return g
}

// Normalize a node so the grader doesn't care whether it came from the raw MCP
// rows (metadata nested) or the flattened DTO.
function norm(n) {
  const m = n.metadata ?? {}
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    summary: n.summary ?? null,
    startInstant: n.startInstant,
    lane: n.lane ?? m.lane ?? null,
    subtype: n.subtype ?? m.subtype ?? null,
    citations: n.citations ?? m.citations ?? [],
  }
}

// Greedy row-packing mirroring layoutLaneY: within a group, a node needs a new
// row unless it clears (date-wise) the right edge of some existing row. Returns
// the number of rows the group would occupy.
function rowsNeeded(instants) {
  const sorted = [...instants].sort((a, b) => a - b)
  const rowRightDay = [] // right edge (in days) occupied per row
  for (const inst of sorted) {
    const day = inst / MS_PER_DAY
    let row = rowRightDay.findIndex((right) => day >= right)
    if (row === -1) {
      row = rowRightDay.length
      rowRightDay.push(0)
    }
    rowRightDay[row] = day + NOMINAL_DAYS
  }
  return rowRightDay.length
}

function pct(n, d) {
  return d === 0 ? 1 : n / d
}

function grade(graph, opts) {
  const nodes = graph.nodes.map(norm)
  const edges = graph.edges
  const laneOf = new Map(nodes.map((n) => [n.id, n.lane]))
  const total = nodes.length
  const entities = nodes.filter((n) => n.type === 'entity')
  const events = nodes.filter((n) => n.type === 'event')
  const distinctLanes = new Set(nodes.map((n) => n.lane).filter(Boolean))

  // Multi-track means "parallel actors that should be swimlaned". Assert it with
  // --multi-track (eval cases do); otherwise only infer it when lanes are already
  // in use, so a single long narrative isn't wrongly told to add lanes.
  const multiTrack = opts.multiTrack || distinctLanes.size > 1

  // --- layout cleanliness: rows needed per layout group ---------------------
  // Group by lane when any node is laned, else by type (matches layoutLaneY).
  const groups = new Map()
  for (const n of nodes) {
    const key = n.lane ? `lane:${n.lane}` : `type:${n.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(n.startInstant)
  }
  let maxRows = 0
  let crowdedGroup = null
  for (const [key, insts] of groups) {
    const r = rowsNeeded(insts)
    if (r > maxRows) {
      maxRows = r
      crowdedGroup = key
    }
  }

  // --- edge discipline ------------------------------------------------------
  const succeeded = edges.filter((e) => e.kind === 'succeeded')
  const intraLaneSucceeded = succeeded.filter((e) => {
    const a = laneOf.get(e.sourceId)
    const b = laneOf.get(e.targetId)
    return a != null && a === b
  })
  const competedWith = edges.filter((e) => e.kind === 'competed_with')
  const crossLane = edges.filter((e) => {
    const a = laneOf.get(e.sourceId)
    const b = laneOf.get(e.targetId)
    return a != null && b != null && a !== b
  })

  // --- richness -------------------------------------------------------------
  const withSummary = nodes.filter((n) => n.summary && n.summary.trim()).length
  const entitiesTyped = entities.filter((n) => n.subtype).length
  const withCitations = nodes.filter((n) => (n.citations?.length ?? 0) > 0).length
  const laned = nodes.filter((n) => n.lane).length

  const m = {
    summaries: pct(withSummary, total),
    entitySubtypes: pct(entitiesTyped, entities.length),
    citations: pct(withCitations, total),
    laneCoverage: pct(laned, total),
    maxRowsPerGroup: maxRows,
    crowdedGroup,
    intraLaneSucceeded: intraLaneSucceeded.length,
    competedWithEdges: competedWith.length,
    crossLaneEdges: crossLane.length,
    edgeDensity: total === 0 ? 0 : edges.length / total,
    distinctLanes: distinctLanes.size,
    nodes: total,
    events: events.length,
    multiTrack,
  }

  // --- findings + pass/fail -------------------------------------------------
  // Each check is (label, ok, weight, detail). Score = weighted % of points.
  const checks = []
  const add = (label, ok, weight, detail) => checks.push({ label, ok, weight, detail })

  add('summaries ≥ 90%', m.summaries >= 0.9, 2, `${(m.summaries * 100) | 0}% of nodes have a summary`)
  add('entities have subtype', m.entitySubtypes >= 0.99, 1, `${entitiesTyped}/${entities.length} entities typed`)
  add('some citations present', m.citations >= 0.3, 1, `${(m.citations * 100) | 0}% of nodes cited`)

  if (multiTrack) {
    add('multi-track → lanes assigned', m.laneCoverage >= 0.9, 3, `${(m.laneCoverage * 100) | 0}% of nodes laned`)
    add('multi-track → ≥ minLanes lanes', m.distinctLanes >= opts.minLanes, 2, `${m.distinctLanes} distinct lanes (min ${opts.minLanes})`)
    add('no redundant intra-lane succeeded edges', m.intraLaneSucceeded === 0, 3, `${m.intraLaneSucceeded} succeeded edge(s) inside one lane`)
    add('no redundant competed_with edges', m.competedWithEdges === 0, 1, `${m.competedWithEdges} competed_with edge(s) (lanes already show rivalry)`)
  }

  // Layout: each lane/group should be a clean waterfall, not a tall stack.
  // Allow more rows when there genuinely are no lanes to spread across.
  const rowLimit = m.distinctLanes > 0 ? 2 : 3
  add(`no group stacks > ${rowLimit} rows`, m.maxRowsPerGroup <= rowLimit, 3, `tallest group "${crowdedGroup}" needs ${m.maxRowsPerGroup} rows`)
  add('edge density ≤ 1.5/node', m.edgeDensity <= 1.5, 1, `${m.edgeDensity.toFixed(2)} edges per node`)

  const earned = checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0)
  const possible = checks.reduce((s, c) => s + c.weight, 0)
  const score = possible === 0 ? 100 : Math.round((earned / possible) * 100)
  // Fail if any weight-3 (critical) check fails, or score < 80.
  const criticalFail = checks.some((c) => c.weight >= 3 && !c.ok)
  const pass = score >= 80 && !criticalFail

  return { title: graph.title ?? '(untitled)', score, pass, metrics: m, checks }
}

function main() {
  const opts = readArgs(process.argv.slice(2))
  if (!opts.file) {
    console.error('usage: grade-timeline.mjs <graph.json|-> [--multi-track] [--min-lanes N] [--json]')
    process.exit(2)
  }
  let result
  try {
    result = grade(loadGraph(opts.file), opts)
  } catch (e) {
    console.error(`error: ${e.message}`)
    process.exit(2)
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const mark = (ok) => (ok ? '✓' : '✗')
    console.log(`\n  ${result.title}`)
    console.log(`  score ${result.score}/100 — ${result.pass ? 'PASS' : 'FAIL'}\n`)
    for (const c of result.checks) {
      console.log(`  ${mark(c.ok)} ${c.label}${c.detail ? `  (${c.detail})` : ''}`)
    }
    console.log('')
  }
  process.exit(result.pass ? 0 : 1)
}

main()
