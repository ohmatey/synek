import { Panel, useViewport, useStore } from '@xyflow/react'
import type { TimeScale } from './useTimelineScale'

function instantOfYear(year: number): number {
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCFullYear(year)
  return d.getTime()
}

function yearLabel(year: number): string {
  return year <= 0 ? `${-year + 1} BCE` : `${year}`
}

// Minimum on-screen px between two kept ticks — prevents labels bunching where a
// gap-collapsing scale squeezes many years into a few pixels.
const MIN_TICK_GAP = 30

// A horizontal date axis that tracks pan/zoom. Reads the live React Flow
// viewport, projects the visible span to years through the shared TimeScale
// (linear or gap-collapsing), and draws ticks at a "nice" interval. Where the
// scale collapsed an empty stretch, it draws a break marker instead.
export function TimeRuler({
  scale,
  onFillGap,
}: {
  scale: TimeScale
  // When provided (owner only), the collapsed-gap break marker becomes a "fill
  // this empty span" affordance — the collapse-mode counterpart of the dashed
  // gap-invitation ghost (NEXT.5 Tier 2). Receives the gap's bracketing instants.
  onFillGap?: (fromInstant: number, toInstant: number) => void
}) {
  const { x, zoom } = useViewport()
  const width = useStore((s) => s.width)
  if (!width || !zoom) return null

  const screenToInstant = (sx: number) => scale.toInstant((sx - x) / zoom)
  const worldToScreen = (wx: number) => x + wx * zoom
  const leftYear = new Date(screenToInstant(0)).getUTCFullYear()
  const rightYear = new Date(screenToInstant(width)).getUTCFullYear()
  const span = Math.max(1, rightYear - leftYear)
  const step = span > 200 ? 50 : span > 80 ? 20 : span > 30 ? 10 : span > 12 ? 5 : 1

  const ticks: { year: number; left: number }[] = []
  const start = Math.ceil(leftYear / step) * step
  let lastLeft = -Infinity
  for (let year = start; year <= rightYear && ticks.length < 60; year += step) {
    const left = worldToScreen(scale.toX(instantOfYear(year)))
    if (left < -10 || left > width + 10) continue
    if (left - lastLeft < MIN_TICK_GAP) continue // skip ticks squeezed by a collapsed gap
    ticks.push({ year, left })
    lastLeft = left
  }

  const breaks = scale.collapsedRanges
    .map((r) => ({
      left: worldToScreen((r.x0 + r.x1) / 2),
      // World-space x → instant maps back to the dates bracketing the collapsed
      // gap, so a click can build a fill prompt for that exact span.
      fromInstant: scale.toInstant(r.x0),
      toInstant: scale.toInstant(r.x1),
    }))
    .filter((b) => b.left >= -10 && b.left <= width + 10)

  return (
    <Panel position="bottom-center" className="time-ruler">
      {breaks.map((b, i) =>
        onFillGap ? (
          <button
            key={`break-${i}`}
            type="button"
            className="time-break time-break-fill"
            style={{ left: b.left }}
            title="Fill this empty span"
            onClick={() => onFillGap(b.fromInstant, b.toInstant)}
          >
            ⁓
          </button>
        ) : (
          <div key={`break-${i}`} className="time-break" style={{ left: b.left }} title="Empty span collapsed">
            ⁓
          </div>
        ),
      )}
      {ticks.map((t) => (
        <div key={t.year} className="time-tick" style={{ left: t.left }}>
          <span className="time-tick-mark" />
          <span className="time-tick-label">{yearLabel(t.year)}</span>
        </div>
      ))}
    </Panel>
  )
}
