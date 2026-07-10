import type { NodeRow, EdgeRow } from '~/lib/db/schema'

// Shared graph-shape helpers behind the connected-distance feedback loop: the
// apply_patch warning (warnings.ts) and the layout report's `grouping` section
// (layout-report.ts) both measure "connected but far apart on the axis" with
// these, so the two surfaces always agree.

// Events + periods define the timeline's "active span" — the same rule as the
// axis-outlier warning. Falls back to all nodes when there are too few anchors.
export function activeSpan(nodes: NodeRow[]): { lo: number; hi: number; span: number } | null {
  let anchors: number[] = []
  for (const n of nodes) {
    if (n.type !== 'event' && n.type !== 'period') continue
    anchors.push(n.startInstant)
    if (n.endInstant != null) anchors.push(n.endInstant)
  }
  if (anchors.length < 2) {
    anchors = nodes.flatMap((n) => [n.startInstant, ...(n.endInstant != null ? [n.endInstant] : [])])
  }
  if (anchors.length < 2) return null
  const lo = Math.min(...anchors)
  const hi = Math.max(...anchors)
  return hi > lo ? { lo, hi, span: hi - lo } : null
}

// Distance between two nodes' TIME INTERVALS [start, end ?? start] — 0 when
// they overlap, so a long-lived entity linked to an event inside its span never
// reads as "far apart".
export function intervalDistance(a: NodeRow, b: NodeRow): number {
  const aEnd = a.endInstant ?? a.startInstant
  const bEnd = b.endInstant ?? b.startInstant
  return Math.max(0, a.startInstant - bEnd, b.startInstant - aEnd)
}

// Connected components over the edge graph (undirected). NOTE — deliberately
// report-only: components are never used to auto-assign lanes. Lanes are
// semantic labels the author names, and the best cross-lane story edges merge
// rival lanes into one component by design; a server-invented lane would fight
// the author and pollute the Patch history. The grouping report + warnings
// nudge the agent instead.
export function connectedComponents(nodes: NodeRow[], edges: EdgeRow[]): NodeRow[][] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!byId.has(e.sourceId) || !byId.has(e.targetId)) continue
    adj.set(e.sourceId, [...(adj.get(e.sourceId) ?? []), e.targetId])
    adj.set(e.targetId, [...(adj.get(e.targetId) ?? []), e.sourceId])
  }
  const seen = new Set<string>()
  const components: NodeRow[][] = []
  for (const n of nodes) {
    if (seen.has(n.id) || !adj.has(n.id)) continue
    const component: NodeRow[] = []
    const queue = [n.id]
    seen.add(n.id)
    while (queue.length) {
      const id = queue.pop()!
      component.push(byId.get(id)!)
      for (const next of adj.get(id) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    components.push(component)
  }
  return components
}
