import type { NodeType } from '~/lib/domain/types'

const MS_PER_DAY = 86_400_000
const PX_PER_DAY = 0.5

// Vertical lane per node type. Period sits behind; entities mid; events front.
export const LANE_Y: Record<NodeType, number> = {
  period: 24,
  entity: 150,
  event: 300,
}

// x = date. The base scale; the canvas itself pans/zooms on top of this.
export function instantToX(instant: number, minInstant: number): number {
  return ((instant - minInstant) / MS_PER_DAY) * PX_PER_DAY
}

export function laneY(type: NodeType): number {
  return LANE_Y[type]
}
