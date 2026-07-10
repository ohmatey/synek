import type { Graph } from '~/lib/db/graph'
import type { Citation, NodeRow } from '~/lib/db/schema'
import {
  BASE_PX_PER_DAY,
  DEFAULT_COLLAPSE_GAPS,
  type TimelineTheme,
  type TimelineViewSettings,
} from '~/lib/domain/types'
import { formatInstant } from '~/lib/domain/dates'
import { findDeadZones } from '~/lib/domain/dead-zones'
import { listStoriesForTimeline, listSegmentCitationsForTimeline } from '~/lib/db/stories'
import { collectPatchWarnings } from './warnings'
import { themeContrastWarnings } from './theme-warnings'
import { activeSpan, intervalDistance, connectedComponents } from './graph-shape'

// The whole-graph "shape" review behind the get_layout_report MCP tool. The
// building client works blind — get_timeline returns the FULL graph (every
// summary + citation), far too large to re-read for a layout pass — so this
// computes what the canvas knows and returns it compact: lane health, axis dead
// zones, era + story coverage, the source registry, and a one-line-per-node
// index. Everything here is read-only and advisory.

const MS_PER_DAY = 86_400_000
const DAYS_PER_YEAR = 365.25
const MAX_DEAD_ZONES = 4
const MAX_SOURCES = 15
const MAX_COMPONENTS = 6
const MAX_COMPONENT_LANES = 6
const MAX_LONGEST_EDGES = 5

const fmt = (instant: number) => formatInstant(instant, 'year')

// Lane names that probably mean the same track: identical after case/whitespace
// normalization (and a trailing "s") but typed differently. One typo silently
// forks a lane, so this is the drift check the canvas itself can't surface.
function laneNameSuspects(names: string[]): string[][] {
  const groups = new Map<string, Set<string>>()
  for (const name of names) {
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim().replace(/s$/, '')
    const set = groups.get(key) ?? new Set()
    set.add(name)
    groups.set(key, set)
  }
  return [...groups.values()].filter((s) => s.size > 1).map((s) => [...s])
}

// Dedupe citations by normalized title into a per-timeline source registry —
// the same book cited a dozen times as free text becomes one row with a count,
// which makes the timeline's sourcing (and its gaps) visible at a glance.
function sourceRegistry(citations: Citation[]) {
  const byTitle = new Map<string, { title: string; count: number; withUrl: number; sourceType?: string }>()
  for (const c of citations) {
    const key = c.title.toLowerCase().replace(/\s+/g, ' ').trim()
    const row = byTitle.get(key) ?? { title: c.title, count: 0, withUrl: 0 }
    row.count++
    if (c.url) row.withUrl++
    if (c.sourceType && !row.sourceType) row.sourceType = c.sourceType
    byTitle.set(key, row)
  }
  const sources = [...byTitle.values()].sort((a, b) => b.count - a.count)
  return {
    distinctSources: sources.length,
    totalCitations: citations.length,
    citationsWithUrl: citations.filter((c) => c.url).length,
    topSources: sources.slice(0, MAX_SOURCES),
    ...(sources.length > MAX_SOURCES ? { note: `top ${MAX_SOURCES} of ${sources.length} sources shown` } : {}),
  }
}

export async function buildLayoutReport(
  timelineId: string,
  graph: Graph,
  view: TimelineViewSettings | null,
  theme: TimelineTheme | null = null,
) {
  const { nodes, edges } = graph
  const pxPerDay = view?.pxPerDay ?? BASE_PX_PER_DAY

  // --- totals ---------------------------------------------------------------
  const byType: Record<string, number> = {}
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
  const byKind: Record<string, number> = {}
  for (const e of edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1

  // --- axis: span + dead zones ----------------------------------------------
  const instants = nodes
    .flatMap((n) => [n.startInstant, ...(n.endInstant != null ? [n.endInstant] : [])])
    .sort((a, b) => a - b)
  const span = instants.length >= 2 ? instants[instants.length - 1]! - instants[0]! : 0
  // Same rule the canvas uses for its gap invitations (shared module → no drift).
  const deadZones = findDeadZones(instants).map((z) => ({
    from: fmt(z.fromInstant),
    to: fmt(z.toInstant),
    years: z.years,
  }))

  // --- lanes ------------------------------------------------------------------
  const byLane = new Map<string, NodeRow[]>()
  let unlaned = 0
  for (const n of nodes) {
    const lane = n.metadata?.lane
    if (!lane) {
      unlaned++
      continue
    }
    byLane.set(lane, [...(byLane.get(lane) ?? []), n])
  }
  const lanes = [...byLane.entries()].map(([name, arr]) => {
    const xs = arr.map((n) => n.startInstant).sort((a, b) => a - b)
    const laneSpanDays = (xs[xs.length - 1]! - xs[0]!) / MS_PER_DAY
    return {
      name,
      count: arr.length,
      from: fmt(xs[0]!),
      to: fmt(xs[xs.length - 1]!),
      avgGapPx: arr.length > 1 ? Math.round((laneSpanDays * pxPerDay) / (arr.length - 1)) : null,
    }
  })
  const fragments = lanes.filter((l) => l.count <= 2).map((l) => l.name)

  // --- grouping: graph connectivity vs layout ---------------------------------
  // Position = date + lane; edges never move anything. So a connected component
  // sprawled across most of the axis or many lanes usually means a scattered
  // narrative thread (missing lanes, a date typo, or a missing bridging node).
  const spanInfo = activeSpan(nodes)
  const pct = (ms: number) => (spanInfo ? Math.round((ms / spanInfo.span) * 100) : 0)
  const componentList = connectedComponents(nodes, edges)
  const isolatedNodeCount = nodes.length - componentList.reduce((sum, c) => sum + c.length, 0)
  const components = componentList
    .map((members) => {
      const lo = Math.min(...members.map((n) => n.startInstant))
      const hi = Math.max(...members.map((n) => n.endInstant ?? n.startInstant))
      const laneSet = [...new Set(members.map((n) => n.metadata?.lane).filter((l): l is string => !!l))]
      const unlanedCount = members.filter((n) => !n.metadata?.lane).length
      const spanPct = pct(hi - lo)
      const sorted = [...members].sort((a, b) => a.startInstant - b.startInstant)
      const note =
        spanPct >= 60
          ? `spans ${spanPct}% of the axis${laneSet.length > 1 ? ` across ${laneSet.length} lanes` : ''} — likely several threads sharing edges, a date typo, or missing lane grouping`
          : laneSet.length >= 4
            ? `straddles ${laneSet.length} lanes — consider whether these are really one thread`
            : members.length >= 4 && unlanedCount === members.length
              ? `${members.length} connected nodes, none laned — consider a shared lane`
              : null
      return {
        size: members.length,
        from: fmt(lo),
        to: fmt(hi),
        spanYears: Math.round((hi - lo) / MS_PER_DAY / DAYS_PER_YEAR),
        spanPct,
        lanes: laneSet.slice(0, MAX_COMPONENT_LANES),
        ...(laneSet.length > MAX_COMPONENT_LANES ? { moreLanes: laneSet.length - MAX_COMPONENT_LANES } : {}),
        unlanedCount,
        sample: [...new Set([sorted[0]!, sorted[sorted.length - 1]!])].map((n) => n.title),
        ...(note ? { note } : {}),
      }
    })
    .sort((a, b) => Number(!!b.note) - Number(!!a.note) || b.spanPct - a.spanPct || b.size - a.size)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const allInstants = nodes.flatMap((n) => [n.startInstant, ...(n.endInstant != null ? [n.endInstant] : [])])
  const zones = findDeadZones(allInstants)
  const longestEdges = edges
    .map((e) => {
      const a = nodeById.get(e.sourceId)
      const b = nodeById.get(e.targetId)
      if (!a || !b) return null
      const dist = intervalDistance(a, b)
      if (dist <= 0) return null
      const gapLo = Math.min(a.endInstant ?? a.startInstant, b.endInstant ?? b.startInstant)
      const gapHi = Math.max(a.startInstant, b.startInstant)
      return {
        source: a.title,
        target: b.title,
        kind: e.kind,
        years: Math.round(dist / MS_PER_DAY / DAYS_PER_YEAR),
        pctOfSpan: pct(dist),
        sameLane: a.metadata?.lane != null && a.metadata.lane === b.metadata?.lane,
        crossesDeadZone: zones.some((z) => z.fromInstant >= gapLo && z.toInstant <= gapHi),
        dist,
      }
    })
    .filter((e) => e != null)
    .sort((a, b) => b.dist - a.dist)
    .slice(0, MAX_LONGEST_EDGES)
    .map(({ dist: _dist, ...rest }) => rest)

  // --- eras (periods) + story coverage ---------------------------------------
  // The story layer is read DEFENSIVELY: if its tables are unavailable in this DB
  // (e.g. a migration not yet applied), the report still returns its graph shape
  // rather than throwing — degrade, don't 500. See the resilience note in server.ts.
  let storyList: ReturnType<typeof listStoriesForTimeline> = []
  try {
    storyList = listStoriesForTimeline(timelineId)
  } catch {
    /* stories layer unavailable — report graph shape without story coverage */
  }
  const momentsWithStories = new Set(storyList.map((s) => s.momentId))
  const periods = nodes.filter((n) => n.type === 'period')
  const eras = periods.map((p) => {
    const end = p.endInstant ?? p.startInstant
    const within = nodes.filter(
      (n) => n.id !== p.id && n.type !== 'period' && n.startInstant >= p.startInstant && n.startInstant <= end,
    )
    return {
      title: p.title,
      from: fmt(p.startInstant),
      to: fmt(end),
      nodesWithin: within.length,
      storiesWithin: within.filter((n) => momentsWithStories.has(n.id)).length,
    }
  })

  // --- sources ----------------------------------------------------------------
  const nodeCitations = nodes.flatMap((n) => n.metadata?.citations ?? [])
  let segmentCitations: Citation[] = []
  try {
    segmentCitations = listSegmentCitationsForTimeline(timelineId)
  } catch {
    /* stories layer unavailable — count node citations only */
  }
  const sources = sourceRegistry([...nodeCitations, ...segmentCitations])

  // --- advisories (the same lane-density + axis-outlier checks apply_patch runs;
  // empty ops → no network checks) plus theme contrast problems -----------------
  const advisories = [...(await collectPatchWarnings(graph, [], view)), ...themeContrastWarnings(theme)]

  // --- compact node index — one line per node, for re-laning/repositioning work
  const nodeIndex = [...nodes]
    .sort((a, b) => a.startInstant - b.startInstant)
    .map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      start: formatInstant(n.startInstant, n.precision),
      ...(n.endInstant != null ? { end: formatInstant(n.endInstant, n.precision) } : {}),
      ...(n.metadata?.lane ? { lane: n.metadata.lane } : {}),
      ...(n.metadata?.location ? { location: n.metadata.location } : {}),
      ...(n.metadata?.lat != null && n.metadata?.lng != null
        ? { coords: [n.metadata.lat, n.metadata.lng] as [number, number] }
        : {}),
      ...(n.metadata?.geoScope ? { geoScope: n.metadata.geoScope } : {}),
      ...(momentsWithStories.has(n.id) ? { hasStory: true } : {}),
      ...(n.metadata?.images?.length ? { hasImage: true } : {}),
    }))

  // --- coordinates: globe-lens coverage + the backfill target ----------------
  // Nodes plot on the globe only with BOTH lat and lng. Three buckets, not two:
  // located (has coords), placeless (reviewed — `geoScope` says it CANNOT be
  // pinned: global/diffuse/unknown), and unset (nobody has decided yet). Only
  // unset nodes are backfill targets; placeless ones are resolved, so coverage
  // is computed over placeable nodes and a backfill pass converges to 100%
  // instead of re-litigating the unpinnable forever.
  const isLocated = (n: NodeRow) => n.metadata?.lat != null && n.metadata?.lng != null
  const located = nodes.filter(isLocated)
  const placeless = nodes.filter((n) => !isLocated(n) && n.metadata?.geoScope)
  const placelessByScope: Record<string, number> = {}
  for (const n of placeless) {
    const scope = n.metadata!.geoScope!
    placelessByScope[scope] = (placelessByScope[scope] ?? 0) + 1
  }
  // Unset, location-bearing first — those are the cheapest wins (the place is
  // already known as a string; it just needs resolving or marking placeless).
  const unset = nodes
    .filter((n) => !isLocated(n) && !n.metadata?.geoScope)
    .sort((a, b) => Number(Boolean(b.metadata?.location)) - Number(Boolean(a.metadata?.location)))
  const placeable = nodes.length - placeless.length

  return {
    totals: { nodes: nodes.length, edges: edges.length, byType, edgesByKind: byKind },
    axis: {
      from: instants.length ? fmt(instants[0]!) : null,
      to: instants.length ? fmt(instants[instants.length - 1]!) : null,
      spanYears: Math.round(span / MS_PER_DAY / DAYS_PER_YEAR),
      deadZones: deadZones.slice(0, MAX_DEAD_ZONES),
      view: { pxPerDay, collapseGaps: view?.collapseGaps ?? DEFAULT_COLLAPSE_GAPS },
    },
    lanes: {
      lanes,
      unlanedCount: unlaned,
      nameSuspects: laneNameSuspects([...byLane.keys()]),
      fragments,
    },
    grouping: {
      componentCount: components.length,
      isolatedNodeCount,
      components: components.slice(0, MAX_COMPONENTS),
      ...(components.length > MAX_COMPONENTS
        ? { note: `top ${MAX_COMPONENTS} of ${components.length} components shown` }
        : {}),
      longestEdges,
    },
    eras,
    coordinates: {
      total: nodes.length,
      located: located.length,
      // Reviewed-and-unpinnable (geoScope) — resolved, NOT backfill targets.
      placeless: { count: placeless.length, byScope: placelessByScope },
      unset: unset.length,
      // Coverage over PLACEABLE nodes (total − placeless): 100% means the globe
      // pass is done — every node is either pinned or marked placeless.
      coveragePct: placeable > 0 ? Math.round((located.length / placeable) * 100) : nodes.length ? 100 : 0,
      hasLocationNoCoords: unset.filter((n) => n.metadata?.location).length,
      // The backfill target — up to 12 undecided nodes (place-bearing first).
      // For each: supply lat/lng, or set geoScope if it cannot be pinned.
      sample: unset.slice(0, 12).map((n) => ({
        id: n.id,
        title: n.title,
        location: n.metadata?.location ?? null,
      })),
    },
    stories: {
      total: storyList.length,
      momentsWithStories: momentsWithStories.size,
      totalBeats: storyList.reduce((sum, s) => sum + s.beatCount, 0),
    },
    sources,
    // The saved visual theme (null = default look) — reuse imageStyle/mood in
    // image prompts; change with set_timeline_theme.
    theme,
    advisories,
    nodeIndex,
  }
}
