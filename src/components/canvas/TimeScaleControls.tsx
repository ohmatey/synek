import { Panel, useReactFlow, useStore } from '@xyflow/react'
import { MIN_PX_PER_DAY, MAX_PX_PER_DAY, pxPerDayForYears, type TimeScale } from './useTimelineScale'

// Multiplicative step so −/+ feel even across scales (compress vs. expand).
const STEP = 1.4

// Timespan presets: roughly how much time should fill the screen.
const PRESETS: { label: string; years: number }[] = [
  { label: 'Decade', years: 10 },
  { label: 'Century', years: 100 },
  { label: 'Millennium', years: 1000 },
]

// Compresses/expands the horizontal time axis (px/day) and toggles gap-collapsing,
// independently of React Flow's camera zoom (which scales node size). Re-anchors
// the viewport so the screen-center instant stays fixed across any change — works
// for both linear and gap-collapsing scales by mapping through the actual scale.
export function TimeScaleControls({
  pxPerDay,
  collapseGaps,
  scale,
  buildScale,
  onPxPerDay,
  onCollapseGaps,
}: {
  pxPerDay: number
  collapseGaps: boolean
  scale: TimeScale
  buildScale: (pxPerDay: number, collapseGaps: boolean) => TimeScale
  onPxPerDay: (next: number) => void
  onCollapseGaps: (next: boolean) => void
}) {
  const rf = useReactFlow()
  const width = useStore((s) => s.width)

  const apply = (nextPxPerDay: number, nextCollapse: boolean) => {
    const clamped = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, nextPxPerDay))
    if (clamped === pxPerDay && nextCollapse === collapseGaps) return

    const vp = rf.getViewport()
    if (width && vp.zoom) {
      // Hold the instant currently at screen-center fixed under the new scale.
      const centerWorldX = (width / 2 - vp.x) / vp.zoom
      const centerInstant = scale.toInstant(centerWorldX)
      const nextScale = buildScale(clamped, nextCollapse)
      rf.setViewport({ x: width / 2 - nextScale.toX(centerInstant) * vp.zoom, y: vp.y, zoom: vp.zoom })
    }
    if (clamped !== pxPerDay) onPxPerDay(clamped)
    if (nextCollapse !== collapseGaps) onCollapseGaps(nextCollapse)
  }

  const presetTarget = (years: number) => pxPerDayForYears(years, (width || 1) / (rf.getZoom() || 1))
  const isActive = (target: number) => Math.abs(pxPerDay / target - 1) < 0.02

  const atMin = pxPerDay <= MIN_PX_PER_DAY * 1.0001
  const atMax = pxPerDay >= MAX_PX_PER_DAY * 0.9999

  return (
    <Panel position="top-left" className="time-scale" data-testid="time-scale-controls">
      <span className="time-scale-label">Time scale</span>
      <div className="time-scale-row">
        <div className="time-scale-step">
          <button
            type="button"
            className="toolbar-btn"
            data-testid="time-scale-compress"
            onClick={() => apply(pxPerDay / STEP, collapseGaps)}
            disabled={atMin}
            title="Compress timeline (less scrolling)"
            aria-label="Compress timeline"
          >
            −
          </button>
          <button
            type="button"
            className="toolbar-btn"
            data-testid="time-scale-expand"
            onClick={() => apply(pxPerDay * STEP, collapseGaps)}
            disabled={atMax}
            title="Expand timeline"
            aria-label="Expand timeline"
          >
            +
          </button>
        </div>
        <div className="time-scale-presets">
          {PRESETS.map((p) => {
            const target = presetTarget(p.years)
            return (
              <button
                key={p.label}
                type="button"
                className={`toolbar-btn time-scale-preset${isActive(target) ? ' is-active' : ''}`}
                data-testid={`time-scale-preset-${p.label.toLowerCase()}`}
                onClick={() => apply(target, collapseGaps)}
                title={`Fit about a ${p.label.toLowerCase()} across the screen`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      <button
        type="button"
        className={`toolbar-btn time-scale-gaps${collapseGaps ? ' is-active' : ''}`}
        data-testid="time-scale-collapse-gaps"
        onClick={() => apply(pxPerDay, !collapseGaps)}
        aria-pressed={collapseGaps}
        title="Collapse long empty stretches between dates"
      >
        {collapseGaps ? '✓ ' : ''}Collapse gaps
      </button>
    </Panel>
  )
}
