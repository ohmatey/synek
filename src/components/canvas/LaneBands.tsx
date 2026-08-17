import { ViewportPortal } from '@xyflow/react'
import type { LaneBand } from './useTimelineScale'

// Draws the SWIMLANES the graph already carries.
//
// `lane` has been the timeline's main grouping primitive since swimlanes shipped,
// and it was completely invisible: layoutLaneY returned only a y per node, and a
// grep for "lane" across styles.css found nothing. So a well-laned timeline
// rendered as anonymous rows of cards and the reader had to infer the grouping
// from the titles. The one place a lane name was ever drawn was the owner-only
// "thin lane" invitation ghost, which by definition only appears on lanes that
// are nearly empty.
//
// Rendered through ViewportPortal so the bands live in FLOW coordinates: they pan
// and zoom with the graph instead of floating over it, and they cost nothing in
// the node/edge diff. Non-interactive, and aria-hidden because the grouping is
// already in each node's own text.
export function LaneBands({ bands }: { bands: LaneBand[] }) {
  if (bands.length === 0) return null
  return (
    <ViewportPortal>
      <div className="lane-bands" aria-hidden="true">
        {bands.map((b) => (
          <div
            key={b.lane}
            className="lane-band"
            style={{
              transform: `translate(${b.x}px, ${b.y}px)`,
              width: b.width,
              height: b.height,
            }}
          >
            <span className="lane-band-label">{b.lane}</span>
          </div>
        ))}
      </div>
    </ViewportPortal>
  )
}
