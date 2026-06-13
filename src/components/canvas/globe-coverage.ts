import type { GraphNode } from '~/lib/domain/types'

// The globe lens plots a node only when it carries BOTH lat and lng. This light
// (no-d3) helper computes the coverage the lens gate and the ViewSwitcher read —
// it lives apart from GlobeLens.tsx so TimelineCanvas can import it without
// pulling the lazy d3-geo chunk into the main bundle.

// A globe with three dots is sad: the lens shows itself proudly only past a
// floor of located nodes AND a fraction of the timeline. Below that it still
// opens (degraded), but the switcher tooltip explains the gap.
export const GLOBE_MIN_LOCATED = 5
export const GLOBE_MIN_COVERAGE = 0.3

// A node is in one of THREE states, not two: located (has coords), placeless
// (reviewed — `geoScope` records it cannot be pinned), or unset (nobody has
// decided yet). Placeless nodes are resolved: they leave the coverage
// denominator and the backfill targets, so the backfill loop converges to
// "done" instead of re-litigating the unpinnable forever.
export type GlobeCoverage = {
  total: number
  located: number
  placeless: number // reviewed: cannot be pinned (geoScope) — resolved, not missing
  coveragePct: number // 0..100, over placeable nodes (total − placeless)
  uncoordinated: number // place-bearing nodes still undecided (backfill targets)
  unset: number // nodes with neither coords nor a geoScope verdict
  hasAny: boolean // ≥1 located node — the switcher is visible at all
  sufficient: boolean // meets the gate — the lens is rewarding, no nag
}

export function isLocated(n: GraphNode): boolean {
  return n.lat != null && n.lng != null
}

// Reviewed-and-unpinnable: an explicit geoScope verdict and no coordinates.
export function isPlaceless(n: GraphNode): boolean {
  return !isLocated(n) && n.geoScope != null
}

export function globeCoverage(nodes: GraphNode[]): GlobeCoverage {
  const total = nodes.length
  const located = nodes.filter(isLocated).length
  const placeless = nodes.filter(isPlaceless).length
  const placeable = total - placeless
  const unset = total - located - placeless
  const uncoordinated = nodes.filter((n) => n.location && !isLocated(n) && n.geoScope == null).length
  return {
    total,
    located,
    placeless,
    coveragePct: placeable > 0 ? Math.round((located / placeable) * 100) : total ? 100 : 0,
    uncoordinated,
    unset,
    hasAny: located >= 1,
    sufficient: located >= GLOBE_MIN_LOCATED && placeable > 0 && located / placeable >= GLOBE_MIN_COVERAGE,
  }
}
