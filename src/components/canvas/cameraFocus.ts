import type { ReactFlowInstance } from '@xyflow/react'

// Center one or more nodes in the canvas region LEFT of the docked panels
// (detail / story reader), not under them. Shared by StoryCamera (per-beat
// framing) and the detail panel's "Focus" button so both frame nodes the same
// way against the same occluder math. Falls back to fitView when measurements
// aren't available yet.
export function centerOnNodes(
  rf: ReactFlowInstance,
  ids: string[],
  { duration = 0, maxZoom = 1.2, pad = 0.28 }: { duration?: number; maxZoom?: number; pad?: number } = {},
) {
  if (!ids.length) return
  const fallback = () =>
    rf.fitView({ nodes: ids.map((id) => ({ id })), padding: pad, duration, maxZoom })

  const targets = ids.map((id) => rf.getNode(id)).filter(Boolean) as NonNullable<ReturnType<typeof rf.getNode>>[]
  if (!targets.length) return fallback()

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const n of targets) {
    const w = n.measured?.width ?? n.width ?? 0
    const h = n.measured?.height ?? n.height ?? 0
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const pane = document.querySelector('.react-flow') as HTMLElement | null
  if (!pane) return fallback()
  const pr = pane.getBoundingClientRect()
  const dock = leftmostDock()
  // When the dock sits beside the canvas (not a narrow full-width overlay), the
  // usable width is everything left of it; otherwise use the whole pane.
  let visibleW = pr.width
  if (dock) {
    const dr = dock.getBoundingClientRect()
    if (dr.left > pr.left + 160) visibleW = dr.left - pr.left
  }
  const zoom = Math.max(
    0.1,
    Math.min(maxZoom, (visibleW * (1 - 2 * pad)) / bw, (pr.height * (1 - 2 * pad)) / bh),
  )
  // Center the node within the visible (left) region, not the whole pane.
  const x = visibleW / 2 - cx * zoom
  const y = pr.height / 2 - cy * zoom
  rf.setViewport({ x, y, zoom }, { duration })
}

// The leftmost mounted dock, whichever panel that happens to be — the edge every
// camera has to frame against.
//
// Deliberately order-INDEPENDENT rather than a `.story-reader ?? .detail-panel`
// chain. The dock order has already changed once (the reader now owns the
// flush-right slot and the entity panel opens to its left), and a hard-coded
// chain mis-frames silently the next time it changes. Measuring both and taking
// the smaller `left` is also correct when only one is mounted, which the chain
// got wrong in the story-only case.
//
// `.node-page` is excluded: that variant is the full-screen entity route, where
// the dock positioning is neutralized and there is no canvas to frame.
export function leftmostDock(): HTMLElement | null {
  const docks = Array.from(
    document.querySelectorAll('.story-reader, .detail-panel:not(.node-page)'),
  ) as HTMLElement[]
  if (docks.length === 0) return null
  return docks.reduce((a, b) => (a.getBoundingClientRect().left <= b.getBoundingClientRect().left ? a : b))
}
