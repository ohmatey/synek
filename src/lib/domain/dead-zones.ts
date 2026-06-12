// The "dead zone" rule — a stretch of the time axis with no nodes — shared by the
// canvas (visual gap invitations, NEXT.5 Tier 2) and the get_layout_report MCP tool
// (docs/product/prd/next5-tier2-alive-canvas.md). One rule so the user and Claude
// see the SAME gaps. Pure: it needs only the node instants, which the canvas already
// holds in memory, so the client computes gaps with no fetch.

const MS_PER_DAY = 86_400_000
const DAYS_PER_YEAR = 365.25

export type DeadZone = { fromInstant: number; toInstant: number; years: number }

// A gap larger than this fraction of the whole timeline's span is a dead zone.
export const DEAD_ZONE_THRESHOLD = 0.15

// Given every node instant (start + any end), return the gaps between consecutive
// dates that are large relative to the total span — biggest first. `instants` need
// not be sorted; duplicates are harmless.
export function findDeadZones(instants: number[], threshold = DEAD_ZONE_THRESHOLD): DeadZone[] {
  const sorted = [...instants].sort((a, b) => a - b)
  if (sorted.length < 2) return []
  const span = sorted[sorted.length - 1]! - sorted[0]!
  if (span <= 0) return []

  const zones: DeadZone[] = []
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!
    if (gap > span * threshold) {
      zones.push({
        fromInstant: sorted[i - 1]!,
        toInstant: sorted[i]!,
        years: Math.round(gap / MS_PER_DAY / DAYS_PER_YEAR),
      })
    }
  }
  return zones.sort((a, b) => b.years - a.years)
}
