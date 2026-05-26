import type { NodeType, NodeSize, NodeSubtype } from '~/lib/domain/types'

const MS_PER_DAY = 86_400_000

// Horizontal time density: pixels of base layout per day. This is the *axis*
// scale (how far apart dates sit), independent of React Flow's camera zoom
// (which scales node size). The canvas owns this as state; these are the bounds
// and the default the TimeScaleControls step between.
export const BASE_PX_PER_DAY = 0.5
export const MIN_PX_PER_DAY = 0.005 // compressed enough to fit millennia on screen
export const MAX_PX_PER_DAY = 4

const DAYS_PER_YEAR = 365.25

function clampPxPerDay(v: number): number {
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, v))
}

// Density (px/day) that fits `years` of time across `worldWidth` base pixels —
// the basis for the timespan presets (Decade/Century/Millennium).
export function pxPerDayForYears(years: number, worldWidth: number): number {
  if (years <= 0 || worldWidth <= 0) return BASE_PX_PER_DAY
  return clampPxPerDay(worldWidth / (years * DAYS_PER_YEAR))
}

// Vertical lane per node type (fallback only — real layout is computed by
// layoutLaneY, which stacks lanes dynamically so they never overlap).
export const LANE_Y: Record<NodeType, number> = {
  period: 24,
  entity: 150,
  event: 300,
}

// Lanes are laid out top → bottom in this order, each placed below the previous
// lane's full (variable) height.
const LANE_ORDER: NodeType[] = ['period', 'entity', 'event']
const LANE_TOP = 24
const LANE_GAP = 40 // vertical gap between lanes
const ROW_GAP = 12 // vertical gap between stacked rows within a lane
const H_GAP = 16 // horizontal clearance between boxes in a row

// Point events have no width; assume a label-sized box when testing overlap.
const NOMINAL_WIDTH = 130

// Rough rendered node heights (px) used for vertical packing. Mirrors the CSS:
// a body height per type, scaled by size, plus an image strip when shown.
const TYPE_BODY: Record<NodeType, number> = { period: 56, entity: 34, event: 26 }
const SIZE_SCALE: Record<NodeSize, number> = { small: 0.85, medium: 1, large: 1.3 }
const IMG_STRIP: Record<NodeSize, number> = { small: 30, medium: 44, large: 66 }

// Person "polaroid" card: a framed portrait + a name/date plate. Fixed size
// (anchored at the start instant), not stretched across the lifespan span. The
// frame is always present (silhouette placeholder when no portrait), so the
// height is constant regardless of `hasImages`.
// Card = padding + square portrait frame (≈ width − padding) + caption plate.
// Slightly over-estimated so tall cards never overlap the next row/lane.
const PERSON_CARD_BODY = 160
const PERSON_CARD_BASE_WIDTH = 124

export function personCardWidth(size: NodeSize = 'medium'): number {
  return Math.round(PERSON_CARD_BASE_WIDTH * SIZE_SCALE[size])
}

// x = date. The base scale; the canvas itself pans/zooms on top of this.
export function instantToX(instant: number, minInstant: number, pxPerDay = BASE_PX_PER_DAY): number {
  return ((instant - minInstant) / MS_PER_DAY) * pxPerDay
}

// Inverse of instantToX — used by the zoom-synced ruler to label screen positions.
export function xToInstant(x: number, minInstant: number, pxPerDay = BASE_PX_PER_DAY): number {
  return minInstant + (x / pxPerDay) * MS_PER_DAY
}

// --- Time scale (instant ↔ x), linear or gap-collapsing -------------------
//
// A monotonic mapping the whole canvas (nodes, edges, ruler) shares. Linear by
// default; in collapse mode, long empty spans between consecutive node dates are
// capped to a fixed width so a lone outlier (e.g. a BCE node + a modern cluster)
// doesn't blow the axis out to nothing-but-whitespace. `collapsedRanges` are the
// x-spans that were squeezed, so the ruler can draw a break marker over them.
export type TimeScale = {
  toX: (instant: number) => number
  toInstant: (x: number) => number
  collapsedRanges: { x0: number; x1: number }[]
}

// Only genuinely large empty spans collapse; anything shorter stays linear so a
// dense cluster keeps its natural rhythm (collapsing decade-scale gaps reads as
// cramped). Tuned above typical in-cluster spacing.
const GAP_MIN_YEARS = 75
const GAP_MIN_DAYS = GAP_MIN_YEARS * DAYS_PER_YEAR
// Rendered width a collapsed span shrinks to (px, before camera zoom).
const COLLAPSED_PX = 72

export function makeTimeScale(instants: number[], pxPerDay: number, collapseGaps: boolean): TimeScale {
  const sorted = Array.from(new Set(instants)).sort((a, b) => a - b)
  const min = sorted.length ? sorted[0]! : 0

  if (!collapseGaps || sorted.length < 2) {
    return {
      toX: (i) => instantToX(i, min, pxPerDay),
      toInstant: (x) => xToInstant(x, min, pxPerDay),
      collapsedRanges: [],
    }
  }

  // Piecewise-linear breakpoints: each anchor instant gets a cumulative x.
  const anchorInstant = sorted
  const anchorX: number[] = [0]
  const collapsedRanges: { x0: number; x1: number }[] = []
  for (let k = 1; k < sorted.length; k++) {
    const days = (sorted[k]! - sorted[k - 1]!) / MS_PER_DAY
    const linearPx = days * pxPerDay
    const collapse = days > GAP_MIN_DAYS && linearPx > COLLAPSED_PX
    const width = collapse ? COLLAPSED_PX : linearPx
    const x0 = anchorX[k - 1]!
    anchorX[k] = x0 + width
    if (collapse) collapsedRanges.push({ x0, x1: x0 + width })
  }

  const lastK = sorted.length - 1
  // Local px/day of the segment ending at anchor k (collapsed segments are slower).
  const segPxPerDay = (k: number) => {
    const days = (anchorInstant[k]! - anchorInstant[k - 1]!) / MS_PER_DAY
    return days > 0 ? (anchorX[k]! - anchorX[k - 1]!) / days : pxPerDay
  }

  const toX = (instant: number): number => {
    if (instant <= anchorInstant[0]!) return anchorX[0]! + ((instant - anchorInstant[0]!) / MS_PER_DAY) * pxPerDay
    if (instant >= anchorInstant[lastK]!)
      return anchorX[lastK]! + ((instant - anchorInstant[lastK]!) / MS_PER_DAY) * pxPerDay
    let k = 1
    while (k < lastK && anchorInstant[k]! < instant) k++
    const ppd = segPxPerDay(k)
    return anchorX[k - 1]! + ((instant - anchorInstant[k - 1]!) / MS_PER_DAY) * ppd
  }

  const toInstant = (x: number): number => {
    if (x <= anchorX[0]!) return anchorInstant[0]! + (x - anchorX[0]!) / pxPerDay * MS_PER_DAY
    if (x >= anchorX[lastK]!) return anchorInstant[lastK]! + (x - anchorX[lastK]!) / pxPerDay * MS_PER_DAY
    let k = 1
    while (k < lastK && anchorX[k]! < x) k++
    const ppd = segPxPerDay(k)
    return anchorInstant[k - 1]! + ((x - anchorX[k - 1]!) / ppd) * MS_PER_DAY
  }

  return { toX, toInstant, collapsedRanges }
}

// --- Per-timeline scale preference (localStorage) -------------------------
export type ScalePref = { pxPerDay: number; collapseGaps: boolean }

const scaleKey = (timelineId: string) => `strata:scale:${timelineId}`

export function loadScalePref(timelineId: string): ScalePref | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(scaleKey(timelineId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ScalePref>
    const pxPerDay = typeof parsed.pxPerDay === 'number' ? clampPxPerDay(parsed.pxPerDay) : BASE_PX_PER_DAY
    return { pxPerDay, collapseGaps: !!parsed.collapseGaps }
  } catch {
    return null
  }
}

export function saveScalePref(timelineId: string, pref: ScalePref): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(scaleKey(timelineId), JSON.stringify(pref))
  } catch {
    // ignore quota / disabled storage
  }
}

export function laneY(type: NodeType): number {
  return LANE_Y[type]
}

export function estimateNodeHeight(
  type: NodeType,
  size: NodeSize = 'medium',
  hasImages = false,
  subtype: NodeSubtype | null = null,
): number {
  if (subtype === 'person') return Math.round(PERSON_CARD_BODY * SIZE_SCALE[size])
  return Math.round(TYPE_BODY[type] * SIZE_SCALE[size]) + (hasImages ? IMG_STRIP[size] : 0)
}

// Lay nodes out so none overlap: within each lane, greedily pack into rows by x
// (a node takes the first row whose last box has cleared), stacking rows by their
// *actual* heights; then place each lane below the previous one's full extent so
// tall/imaged nodes never bleed into the next lane. Returns the top-left y per id.
export function layoutLaneY(
  items: { id: string; type: NodeType; x: number; width?: number; height?: number }[],
): Map<string, number> {
  const yById = new Map<string, number>()
  const byLane = new Map<NodeType, typeof items>()
  for (const it of items) {
    const arr = byLane.get(it.type) ?? []
    arr.push(it)
    byLane.set(it.type, arr)
  }

  let base = LANE_TOP
  for (const type of LANE_ORDER) {
    const arr = byLane.get(type)
    if (!arr || arr.length === 0) continue
    arr.sort((a, b) => a.x - b.x)

    const rowRight: number[] = [] // right edge (x) currently occupied per row
    const rowHeight: number[] = [] // tallest box in each row
    const rowOf = new Map<string, number>()
    for (const it of arr) {
      const w = it.width ?? NOMINAL_WIDTH
      const h = it.height ?? estimateNodeHeight(type)
      let row = rowRight.findIndex((right) => it.x >= right)
      if (row === -1) {
        row = rowRight.length
        rowRight.push(0)
        rowHeight.push(0)
      }
      rowRight[row] = it.x + w + H_GAP
      rowHeight[row] = Math.max(rowHeight[row]!, h)
      rowOf.set(it.id, row)
    }

    // Cumulative y for each row, starting at the lane base.
    const rowY: number[] = []
    let acc = base
    for (let r = 0; r < rowHeight.length; r++) {
      rowY[r] = acc
      acc += rowHeight[r]! + ROW_GAP
    }
    for (const it of arr) yById.set(it.id, rowY[rowOf.get(it.id)!]!)

    base = acc - ROW_GAP + LANE_GAP // next lane starts below this one's extent
  }
  return yById
}
