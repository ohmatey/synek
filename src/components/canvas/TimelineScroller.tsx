import { useMemo, useRef } from 'react'
import { Panel, useReactFlow, useStore, useViewport } from '@xyflow/react'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { GraphNode } from '~/lib/domain/types'
import { saveViewport, type TimeScale } from './useTimelineScale'

// The timeline view's bottom transport + left zoom controls — the same visual
// language as the globe lens (.globe-* scrubber/zoom atoms), adapted for the
// React Flow canvas. The globe's bottom bar PLAYS a cursor through time; the
// timeline's instead SCROLLS the canvas: it shows the full time extent with an
// era ribbon + year axis, and a draggable window marking the portion currently
// in view. Drag the window (or click the track) to pan the canvas horizontally.

const ERA_ROW_H = 15 // px per era-band row (mirrors GlobeLens)
const AXIS_MIN_PCT_GAP = 7 // min % between kept year labels (de-bunch a collapsed scale)
const MIN_WIN_PCT = 2.5 // floor on the view-window width so it stays grabbable when zoomed in

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function instantOfYear(year: number): number {
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCFullYear(year)
  return d.getTime()
}
function yearLabel(year: number): string {
  return year <= 0 ? `${-year + 1} BCE` : `${year}`
}

// ── Left zoom controls ──────────────────────────────────────────────────────
// A vertical +/−/fit stack at the canvas's left-center, styled identically to
// the globe's GS2 zoom control. Drives React Flow's camera zoom (not the time
// axis density — that lives in the display-settings popover).
export function TimelineZoomControls() {
  const rf = useReactFlow()
  const zoom = useViewport().zoom
  const minZoom = useStore((s) => s.minZoom)
  const maxZoom = useStore((s) => s.maxZoom)
  return (
    <Panel position="center-left" className="tl-zoom nopan nodrag" role="group" aria-label="Zoom">
      <button
        type="button"
        className="globe-zoom-btn"
        aria-label="Zoom in"
        onClick={() => rf.zoomIn({ duration: 200 })}
        disabled={zoom >= maxZoom - 0.001}
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        className="globe-zoom-btn"
        aria-label="Zoom out"
        onClick={() => rf.zoomOut({ duration: 200 })}
        disabled={zoom <= minZoom + 0.001}
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        className="globe-zoom-btn"
        aria-label="Fit timeline"
        onClick={() => rf.fitView({ padding: 0.2, duration: 300 })}
      >
        <Maximize size={15} />
      </button>
    </Panel>
  )
}

// ── Bottom scroller ─────────────────────────────────────────────────────────
export function TimelineScrubber({
  nodes,
  scale,
  timelineId,
  rightInset,
  onFillGap,
}: {
  nodes: GraphNode[]
  scale: TimeScale
  timelineId: string
  // px the open detail/story docks occupy on the right — keeps the bar clear of
  // them, exactly like the globe scrubber's inline `right`.
  rightInset: number
  // Owner-only: a collapsed empty span becomes a "fill this gap" affordance (the
  // collapse-mode twin of the dashed gap-invitation ghost), receiving the gap's
  // bracketing instants. Mirrors the old TimeRuler break marker.
  onFillGap?: (fromInstant: number, toInstant: number) => void
}) {
  const rf = useReactFlow()
  const { x, y, zoom } = useViewport()
  const width = useStore((s) => s.width)
  const trackRef = useRef<HTMLDivElement>(null)

  // Full time extent of the graph, in the shared (gap-collapsing) x-space. The
  // track's origin is x=0 (the scale's earliest anchor); maxX its right edge.
  const { minInstant, maxInstant } = useMemo(() => {
    let mn = Infinity
    let mx = -Infinity
    for (const n of nodes) {
      mn = Math.min(mn, n.startInstant)
      mx = Math.max(mx, n.endInstant ?? n.startInstant)
    }
    return { minInstant: mn === Infinity ? 0 : mn, maxInstant: mx === -Infinity ? 0 : mx }
  }, [nodes])
  const maxX = Math.max(scale.toX(maxInstant), 1)

  // Year ticks at a "nice" step across the extent, positioned in the track's
  // percentage space so gap-collapse is honored (mirrors GlobeLens.axisTicks).
  const axisTicks = useMemo(() => {
    const minY = new Date(minInstant).getUTCFullYear()
    const maxY = new Date(maxInstant).getUTCFullYear()
    const span = Math.max(1, maxY - minY)
    const step = span > 200 ? 50 : span > 80 ? 20 : span > 30 ? 10 : span > 12 ? 5 : 1
    const out: { year: number; pct: number }[] = []
    let lastPct = -Infinity
    for (let year = Math.ceil(minY / step) * step; year <= maxY && out.length < 40; year += step) {
      const pct = (scale.toX(instantOfYear(year)) / maxX) * 100
      if (pct < -0.5 || pct > 100.5) continue
      if (pct - lastPct < AXIS_MIN_PCT_GAP) continue
      out.push({ year, pct })
      lastPct = pct
    }
    return out
  }, [minInstant, maxInstant, scale, maxX])

  // The era ribbon — `period` spans greedy-packed into ≤2 rows in the same
  // percentage space (mirrors GlobeLens.eraBand).
  const eraBand = useMemo(() => {
    const periods = nodes
      .filter((n) => n.type === 'period' && n.endInstant != null)
      .sort((a, b) => a.startInstant - b.startInstant)
    const rowEndX: number[] = []
    const segs: { id: string; title: string; left: number; width: number; row: number }[] = []
    for (const p of periods) {
      const x0 = scale.toX(p.startInstant)
      const x1 = scale.toX(p.endInstant as number)
      if (x1 <= x0) continue
      let row = rowEndX.findIndex((e) => e <= x0)
      if (row === -1) {
        if (rowEndX.length >= 2) continue
        row = rowEndX.length
        rowEndX.push(x1)
      } else {
        rowEndX[row] = x1
      }
      segs.push({
        id: p.id,
        title: p.title,
        left: (x0 / maxX) * 100,
        width: Math.max(((x1 - x0) / maxX) * 100, 0.8),
        row,
      })
    }
    return { segs, rows: rowEndX.length }
  }, [nodes, scale, maxX])

  // The visible-viewport window, in track percentage space. worldLeft = the
  // world-x at the canvas's left edge (screen x=0); the window's width is the
  // visible world span. Both update live as the canvas pans/zooms.
  const worldLeft = zoom > 0 ? -x / zoom : 0
  const visibleWorldW = zoom > 0 ? width / zoom : maxX
  const winPct = clamp((visibleWorldW / maxX) * 100, MIN_WIN_PCT, 100)
  const leftPct = clamp((worldLeft / maxX) * 100, 0, 100 - winPct)

  // Live readout of the in-view year range (recovers the precise current-view
  // dates the whole-extent axis can't show when zoomed in).
  const viewYears = useMemo(() => {
    if (zoom <= 0 || width <= 0) return null
    const l = new Date(scale.toInstant(worldLeft)).getUTCFullYear()
    const r = new Date(scale.toInstant(worldLeft + visibleWorldW)).getUTCFullYear()
    return l === r ? yearLabel(l) : `${yearLabel(l)} – ${yearLabel(r)}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldLeft, visibleWorldW, zoom, width, scale])

  // Drag the window (or click the track) to pan the canvas. Zoom/width/maxX are
  // constant through a horizontal scroll, so capturing them at pointerdown is
  // safe; the move handler only rewrites the viewport's x.
  function onTrackPointerDown(e: React.PointerEvent) {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const trackW = rect.width
    if (trackW <= 0 || maxX <= 0 || zoom <= 0) return
    const winPx = Math.max((visibleWorldW / maxX) * trackW, (MIN_WIN_PCT / 100) * trackW)
    const curLeftPx = clamp((worldLeft / maxX) * trackW, 0, Math.max(0, trackW - winPx))
    const pointerPx = e.clientX - rect.left
    // Grab the window where you clicked it; clicking the bare track centers it
    // under the cursor (a jump-then-drag).
    const inside = pointerPx >= curLeftPx && pointerPx <= curLeftPx + winPx
    const grab = inside ? pointerPx - curLeftPx : winPx / 2
    const apply = (clientX: number) => {
      const leftPx = clamp(clientX - rect.left - grab, 0, Math.max(0, trackW - winPx))
      const nextWorldLeft = (leftPx / trackW) * maxX
      rf.setViewport({ x: -nextWorldLeft * zoom, y, zoom })
    }
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // Programmatic setViewport doesn't fire React Flow's onMoveEnd, so persist
      // the scrolled camera ourselves (keeps reload/refetch framing in sync).
      saveViewport(timelineId, rf.getViewport())
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <Panel
      position="bottom-left"
      className="tl-scrubber nopan nowheel nodrag"
      style={{ right: rightInset + 16 }}
      aria-label="Timeline scroller"
    >
      <div className="globe-timeline">
        {eraBand.segs.length > 0 && (
          <div className="globe-era-band" style={{ height: eraBand.rows * ERA_ROW_H }} aria-hidden>
            {eraBand.segs.map((s) => (
              <div
                key={s.id}
                className="globe-era-seg"
                style={{ left: `${s.left}%`, width: `${s.width}%`, top: s.row * ERA_ROW_H }}
                title={s.title}
              >
                <span className="globe-era-label">{s.title}</span>
              </div>
            ))}
          </div>
        )}
        <div ref={trackRef} className="globe-track" onPointerDown={onTrackPointerDown}>
          {scale.collapsedRanges.map((r, i) => {
            const pos = { left: `${(r.x0 / maxX) * 100}%`, width: `${((r.x1 - r.x0) / maxX) * 100}%` }
            // Owner: the collapsed hatch doubles as a fill-this-gap button (the
            // collapse-mode twin of the dashed gap-invitation ghost). It reuses
            // the .globe-collapsed hatch + positioning and re-enables pointer
            // events via .tl-collapsed-fill.
            return onFillGap ? (
              <button
                key={i}
                type="button"
                className="globe-collapsed tl-collapsed-fill"
                style={pos}
                title="Fill this empty span"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => onFillGap(scale.toInstant(r.x0), scale.toInstant(r.x1))}
              />
            ) : (
              <span key={i} className="globe-collapsed" style={pos} />
            )
          })}
          {axisTicks.map((t) => (
            <span key={t.year} className="globe-axis-tick" style={{ left: `${t.pct}%` }} />
          ))}
          <span
            className="tl-window"
            style={{ left: `${leftPct}%`, width: `${winPct}%` }}
            aria-hidden
          />
        </div>
        <div className="globe-axis" aria-hidden>
          {axisTicks.map((t) => (
            <span key={t.year} className="globe-axis-label" style={{ left: `${t.pct}%` }}>
              {yearLabel(t.year)}
            </span>
          ))}
        </div>
      </div>
      {viewYears && (
        <div className="globe-date" style={{ whiteSpace: 'nowrap' }}>
          {viewYears}
        </div>
      )}
    </Panel>
  )
}
