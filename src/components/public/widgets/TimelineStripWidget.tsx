import { useMemo } from 'react'
import type { GraphNode } from '~/lib/domain/types'
import { formatInstant } from '~/lib/domain/dates'

// A compact, read-only timeline strip — the `timeline` beat widget. Plots the
// given nodes by date on a single axis (periods as bars, points as dots), with
// the focus node emphasized + labelled. Pure SVG with a fixed viewBox that scales
// to the container, so it's SSR-safe and crisp on any width.

const W = 480
const H = 128
const PAD_X = 26
const BASE_Y = 78
const AXIS_X0 = PAD_X
const AXIS_X1 = W - PAD_X

export function TimelineStripWidget({ nodes, focusId }: { nodes: GraphNode[]; focusId?: string }) {
  const model = useMemo(() => {
    const valid = nodes.filter((n) => Number.isFinite(n.startInstant))
    if (valid.length === 0) return null
    const ends = valid.flatMap((n) => [n.startInstant, ...(n.endInstant != null ? [n.endInstant] : [])])
    const min = Math.min(...ends)
    const max = Math.max(...ends)
    const span = Math.max(1, max - min)
    const toX = (i: number) => AXIS_X0 + ((i - min) / span) * (AXIS_X1 - AXIS_X0)
    const items = valid
      .map((n) => ({
        n,
        x0: toX(n.startInstant),
        x1: n.endInstant != null ? toX(n.endInstant) : null,
        focus: n.id === focusId,
      }))
      .sort((a, b) => a.x0 - b.x0)
    const focus = items.find((it) => it.focus) ?? items[Math.floor(items.length / 2)]!
    return { min, max, items, focus }
  }, [nodes, focusId])

  if (!model) return null
  const { min, max, items, focus } = model

  return (
    <div className="wg-timeline">
      <svg viewBox={`0 0 ${W} ${H}`} className="wg-timeline-svg" role="img" aria-label="Timeline of the moments in this beat">
        {/* baseline */}
        <line className="wg-tl-axis" x1={AXIS_X0} y1={BASE_Y} x2={AXIS_X1} y2={BASE_Y} />
        {/* end-year ticks */}
        <text className="wg-tl-year" x={AXIS_X0} y={BASE_Y + 22} textAnchor="start">
          {formatInstant(min, 'year')}
        </text>
        <text className="wg-tl-year" x={AXIS_X1} y={BASE_Y + 22} textAnchor="end">
          {formatInstant(max, 'year')}
        </text>

        {/* period spans as bars */}
        {items.map(
          (it) =>
            it.x1 != null && (
              <rect
                key={`bar-${it.n.id}`}
                className="wg-tl-bar"
                data-focus={it.focus || undefined}
                x={it.x0}
                y={BASE_Y - 4}
                width={Math.max(2, it.x1 - it.x0)}
                height={8}
                rx={4}
              />
            ),
        )}

        {/* point dots */}
        {items.map((it) => (
          <circle
            key={`dot-${it.n.id}`}
            className="wg-tl-dot"
            data-focus={it.focus || undefined}
            cx={it.x0}
            cy={BASE_Y}
            r={it.focus ? 6 : 3.5}
          >
            <title>{it.n.title}</title>
          </circle>
        ))}

        {/* focus stem + label */}
        <line className="wg-tl-stem" x1={focus.x0} y1={BASE_Y - 8} x2={focus.x0} y2={34} />
        <text
          className="wg-tl-label"
          x={Math.min(Math.max(focus.x0, AXIS_X0 + 4), AXIS_X1 - 4)}
          y={26}
          textAnchor={focus.x0 < W * 0.25 ? 'start' : focus.x0 > W * 0.75 ? 'end' : 'middle'}
        >
          {focus.n.title}
        </text>
      </svg>
    </div>
  )
}
