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
  // The docked reader is the leftmost occluder; fall back to the detail panel.
  const dock = (document.querySelector('.story-reader') ?? document.querySelector('.detail-panel')) as HTMLElement | null
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
