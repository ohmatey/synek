import type { Graph } from '~/lib/db/graph'
import type { Citation, NodeRow } from '~/lib/db/schema'
import { BASE_PX_PER_DAY, type TimelineTheme, type TimelineViewSettings } from '~/lib/domain/types'
import { formatInstant } from '~/lib/domain/dates'
import { findDeadZones } from '~/lib/domain/dead-zones'
import { listStoriesForTimeline, listSegmentCitationsForTimeline } from '~/lib/db/stories'
import { collectPatchWarnings } from './warnings'
import { themeContrastWarnings } from './theme-warnings'

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

  // --- eras (periods) + story coverage ---------------------------------------
  const storyList = listStoriesForTimeline(timelineId)
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
  const sources = sourceRegistry([...nodeCitations, ...listSegmentCitationsForTimeline(timelineId)])

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
      view: { pxPerDay, collapseGaps: view?.collapseGaps ?? false },
    },
    lanes: {
      lanes,
      unlanedCount: unlaned,
      nameSuspects: laneNameSuspects([...byLane.keys()]),
      fragments,
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
