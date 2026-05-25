import { Panel, useViewport, useStore } from '@xyflow/react'
import { instantToX, xToInstant } from './useTimelineScale'

function instantOfYear(year: number): number {
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCFullYear(year)
  return d.getTime()
}

function yearLabel(year: number): string {
  return year <= 0 ? `${-year + 1} BCE` : `${year}`
}

// A horizontal date axis that tracks pan/zoom. Reads the live React Flow
// viewport, projects the visible span to years, and draws ticks at a "nice"
// interval chosen by how much time is on screen.
export function TimeRuler({ minInstant }: { minInstant: number }) {
  const { x, zoom } = useViewport()
  const width = useStore((s) => s.width)
  if (!width || !zoom) return null

  const screenToInstant = (sx: number) => xToInstant((sx - x) / zoom, minInstant)
  const leftYear = new Date(screenToInstant(0)).getUTCFullYear()
  const rightYear = new Date(screenToInstant(width)).getUTCFullYear()
  const span = Math.max(1, rightYear - leftYear)
  const step = span > 200 ? 50 : span > 80 ? 20 : span > 30 ? 10 : span > 12 ? 5 : 1

  const ticks: { year: number; left: number }[] = []
  const start = Math.ceil(leftYear / step) * step
  for (let year = start; year <= rightYear && ticks.length < 60; year += step) {
    const left = x + instantToX(instantOfYear(year), minInstant) * zoom
    if (left >= -10 && left <= width + 10) ticks.push({ year, left })
  }

  return (
    <Panel position="bottom-center" className="time-ruler">
      {ticks.map((t) => (
        <div key={t.year} className="time-tick" style={{ left: t.left }}>
          <span className="time-tick-mark" />
          <span className="time-tick-label">{yearLabel(t.year)}</span>
        </div>
      ))}
    </Panel>
  )
}
