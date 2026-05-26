import type { NodeType, NodeSize, NodeSubtype } from '~/lib/domain/types'

const MS_PER_DAY = 86_400_000
const PX_PER_DAY = 0.5

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
export function instantToX(instant: number, minInstant: number): number {
  return ((instant - minInstant) / MS_PER_DAY) * PX_PER_DAY
}

// Inverse of instantToX — used by the zoom-synced ruler to label screen positions.
export function xToInstant(x: number, minInstant: number): number {
  return minInstant + (x / PX_PER_DAY) * MS_PER_DAY
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
