import type { NodeType, NodeSize, NodeSubtype } from '~/lib/domain/types'
import { BASE_PX_PER_DAY, MIN_PX_PER_DAY, MAX_PX_PER_DAY, clampPxPerDay } from '~/lib/domain/types'

const MS_PER_DAY = 86_400_000

// Horizontal time density: pixels of base layout per day. This is the *axis*
// scale (how far apart dates sit), independent of React Flow's camera zoom
// (which scales node size). The canvas owns this as state; the bounds + default
// live in the domain layer (shared with the MCP set_timeline_view tool) and are
// re-exported here for the canvas controls.
export { BASE_PX_PER_DAY, MIN_PX_PER_DAY, MAX_PX_PER_DAY }

const DAYS_PER_YEAR = 365.25

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
  concept: 225,
  event: 300,
}

// Lanes are laid out top → bottom in this order, each placed below the previous
// lane's full (variable) height.
const LANE_ORDER: NodeType[] = ['period', 'entity', 'concept', 'event']
const LANE_TOP = 24
const LANE_GAP = 40 // vertical gap between lanes
const ROW_GAP = 12 // vertical gap between stacked rows within a lane
const H_GAP = 16 // horizontal clearance between boxes in a row

// Point events have no width; assume a label-sized box when testing overlap.
const NOMINAL_WIDTH = 130

// Rough rendered node heights (px) used for vertical packing. Mirrors the CSS:
// a body height per type, scaled by size, plus an image strip when shown.
const TYPE_BODY: Record<NodeType, number> = { period: 72, entity: 34, concept: 40, event: 26 }
const SIZE_SCALE: Record<NodeSize, number> = { small: 0.85, medium: 1, large: 1.3 }
const IMG_STRIP: Record<NodeSize, number> = { small: 30, medium: 44, large: 66 }
// Portrait images render taller (3:4) than landscape (square) thumbnails, so the
// strip — and the node's packed height — grows when a shown image is portrait.
const IMG_STRIP_PORTRAIT: Record<NodeSize, number> = { small: 40, medium: 58, large: 88 }
// Extra height a node gains when it renders a clamped (~2-line) summary on the card.
const SUMMARY_BODY = 32

// Person "polaroid" card: a framed portrait + a name/date plate. Fixed size
// (anchored at the start instant), not stretched across the lifespan span. The
// frame is always present (silhouette placeholder when no portrait), so the
// height is constant regardless of `hasImages`.
// Card = padding + square portrait frame (≈ width − padding) + caption plate.
// Slightly over-estimated so tall cards never overlap the next row/lane.
const PERSON_CARD_BODY = 160
// A portrait frame (3:4) is taller than the square default, so the polaroid grows.
const PERSON_CARD_BODY_PORTRAIT = 200
const PERSON_CARD_BASE_WIDTH = 124

export function personCardWidth(size: NodeSize = 'medium'): number {
  return Math.round(PERSON_CARD_BASE_WIDTH * SIZE_SCALE[size])
}

// Spanless entity cards (a work/org/place with no end date) get a fixed width,
// applied both to the DOM and to the lane packer's overlap test. Left to
// auto-size, a long title renders the card far wider than NOMINAL_WIDTH and
// same-lane neighbors visually overlap even though the packer saw them clear.
const ENTITY_CARD_BASE_WIDTH = 200

export function entityCardWidth(size: NodeSize = 'medium'): number {
  return Math.round(ENTITY_CARD_BASE_WIDTH * SIZE_SCALE[size])
}

// Event pills render one nowrap line (dot + title + date), so their width is
// text-driven; estimate it for the packer from the title. Deliberately a touch
// generous (≈7px/glyph at the 12px base font, ~70px for the date, ~40px of
// chrome) so the packer stacks before the DOM overlaps.
const PILL_CHROME_PX = 40
const PILL_CHAR_PX = 7
const PILL_DATE_PX = 70

export function eventPillWidth(title: string, size: NodeSize = 'medium'): number {
  return Math.round((PILL_CHROME_PX + title.length * PILL_CHAR_PX + PILL_DATE_PX) * SIZE_SCALE[size])
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

// Only spans that are large RELATIVE TO THIS TIMELINE collapse; anything near
// the data's own rhythm stays linear so a dense cluster keeps its spacing. A
// gap collapses when it dwarfs the median inter-anchor gap (an org founded in
// 1923 before a 1997–2027 cluster) — a uniformly sparse timeline (a node every
// ~20 years) has a large median and never collapses. The floor keeps small-gap
// noise from collapsing ordinary pauses in dense timelines.
const GAP_MEDIAN_FACTOR = 8
const GAP_FLOOR_YEARS = 4
const GAP_FLOOR_DAYS = GAP_FLOOR_YEARS * DAYS_PER_YEAR
// Rendered width a collapsed span shrinks to (px, before camera zoom).
const COLLAPSED_PX = 72

// Median of the positive gaps (days) between consecutive sorted instants.
function medianGapDays(sorted: number[]): number {
  const gaps: number[] = []
  for (let k = 1; k < sorted.length; k++) {
    const d = (sorted[k]! - sorted[k - 1]!) / MS_PER_DAY
    if (d > 0) gaps.push(d)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2
}

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

  // A gap collapses when it dwarfs this timeline's own rhythm.
  const gapMinDays = Math.max(GAP_FLOOR_DAYS, GAP_MEDIAN_FACTOR * medianGapDays(sorted))

  // Piecewise-linear breakpoints: each anchor instant gets a cumulative x.
  const anchorInstant = sorted
  const anchorX: number[] = [0]
  const collapsedRanges: { x0: number; x1: number }[] = []
  for (let k = 1; k < sorted.length; k++) {
    const days = (sorted[k]! - sorted[k - 1]!) / MS_PER_DAY
    const linearPx = days * pxPerDay
    const collapse = days > gapMinDays && linearPx > COLLAPSED_PX
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
// `autoRefresh` drives the canvas's background poll for external MCP writes;
// default on so a freshly-built timeline updates in place. `chosen` marks that
// the USER explicitly adjusted the scale on this device — the pref is also
// auto-saved ambiently on every open, and only an explicit choice should win
// over the timeline's saved default view (setTimelineView / MCP set_timeline_view).
// `speak` drives the story reader's read-aloud narration (Web Speech API);
// default off — narration is opt-in.
export type ScalePref = {
  pxPerDay: number
  collapseGaps: boolean
  autoRefresh: boolean
  speak: boolean
  chosen?: boolean
}

const scaleKey = (timelineId: string) => `synek:scale:${timelineId}`

export function loadScalePref(timelineId: string): ScalePref | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(scaleKey(timelineId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ScalePref>
    const pxPerDay = typeof parsed.pxPerDay === 'number' ? clampPxPerDay(parsed.pxPerDay) : BASE_PX_PER_DAY
    return {
      pxPerDay,
      collapseGaps: !!parsed.collapseGaps,
      autoRefresh: parsed.autoRefresh !== false,
      speak: !!parsed.speak,
      chosen: !!parsed.chosen,
    }
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

// --- Per-timeline viewport (camera pan/zoom) ------------------------------
// Persisted so a reload (or a live refetch) restores the user's framing
// instead of snapping back to fitView.
export type SavedViewport = { x: number; y: number; zoom: number }

const viewportKey = (timelineId: string) => `synek:viewport:${timelineId}`

export function loadViewport(timelineId: string): SavedViewport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(viewportKey(timelineId))
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<SavedViewport>
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.zoom !== 'number') return null
    return { x: p.x, y: p.y, zoom: p.zoom }
  } catch {
    return null
  }
}

export function saveViewport(timelineId: string, vp: SavedViewport): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(viewportKey(timelineId), JSON.stringify(vp))
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
  hasSummary = false,
  hasPortraitImage = false,
): number {
  const summary = hasSummary ? Math.round(SUMMARY_BODY * SIZE_SCALE[size]) : 0
  if (subtype === 'person') {
    const frame = hasPortraitImage ? PERSON_CARD_BODY_PORTRAIT : PERSON_CARD_BODY
    return Math.round(frame * SIZE_SCALE[size]) + summary
  }
  const strip = hasImages ? (hasPortraitImage ? IMG_STRIP_PORTRAIT[size] : IMG_STRIP[size]) : 0
  return Math.round(TYPE_BODY[type] * SIZE_SCALE[size]) + strip + summary
}

type LayoutItem = { id: string; type: NodeType; x: number; width?: number; height?: number; lane?: string | null }

// Pack one lane's items so none overlap: greedily into rows by x (a node takes
// the first row whose last box has cleared), stacking rows by their *actual*
// heights. Writes the top-left y per id into `out`; returns the y just below
// this lane's full extent (so the next lane can start there).
function packLane(arr: LayoutItem[], base: number, out: Map<string, number>): number {
  if (arr.length === 0) return base
  arr.sort((a, b) => a.x - b.x)

  const rowRight: number[] = [] // right edge (x) currently occupied per row
  const rowHeight: number[] = [] // tallest box in each row
  const rowOf = new Map<string, number>()
  for (const it of arr) {
    const w = it.width ?? NOMINAL_WIDTH
    const h = it.height ?? estimateNodeHeight(it.type)
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
  for (const it of arr) out.set(it.id, rowY[rowOf.get(it.id)!]!)

  return acc - ROW_GAP + LANE_GAP // next lane starts below this one's extent
}

// Lay nodes out so none overlap, top → bottom. Two kinds of lane:
//   1. Named swimlanes — nodes that carry a `lane` string are grouped by it, one
//      horizontal row-group each, so parallel tracks (e.g. rival companies) read
//      as clean waterfalls left→right by date. Lanes are ordered by their
//      earliest node, so the canvas cascades by first activity.
//   2. Type lanes — nodes with no `lane` fall back to the per-type lanes
//      (period → entity → concept → event), stacked below any swimlanes.
// Returns the top-left y per id. With no laned nodes this is exactly the old
// type-lane layout, so existing timelines are unaffected.
export function layoutLaneY(items: LayoutItem[]): Map<string, number> {
  const yById = new Map<string, number>()
  const hasLane = (it: LayoutItem) => it.lane != null && it.lane !== ''

  let base = LANE_TOP

  // 1. Named swimlanes, ordered by each lane's earliest (leftmost) node.
  const byName = new Map<string, LayoutItem[]>()
  for (const it of items) {
    if (!hasLane(it)) continue
    const arr = byName.get(it.lane!) ?? []
    arr.push(it)
    byName.set(it.lane!, arr)
  }
  const ordered = [...byName.entries()]
    .map(([lane, arr]) => ({ lane, arr, minX: Math.min(...arr.map((i) => i.x)) }))
    .sort((a, b) => a.minX - b.minX || a.lane.localeCompare(b.lane))
  for (const { arr } of ordered) base = packLane(arr, base, yById)

  // 2. Unlaned nodes → per-type lanes, below the swimlanes.
  const byType = new Map<NodeType, LayoutItem[]>()
  for (const it of items) {
    if (hasLane(it)) continue
    const arr = byType.get(it.type) ?? []
    arr.push(it)
    byType.set(it.type, arr)
  }
  for (const type of LANE_ORDER) {
    const arr = byType.get(type)
    if (arr && arr.length) base = packLane(arr, base, yById)
  }

  return yById
}
