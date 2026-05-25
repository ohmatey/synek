import type { NodeImage, NodeSize, Precision } from '~/lib/domain/types'

// In-progress edits from the detail panel, overlaid on the node for a live
// preview — never persisted until Save (so closing/canceling reverts).
export type NodeDraft = {
  title: string
  startInstant: number
  endInstant: number | null
  precision: Precision
  size: NodeSize
  color: string | null
  images: NodeImage[]
}

export type CanvasNodeData = {
  title: string
  width?: number
  date?: string
  citations?: number
  images?: NodeImage[]
  size?: NodeSize
  color?: string | null
  // Story-layer affordance (S1): a ▶ marker when the moment has a story.
  storyCount?: number
  hook?: string | null
}
