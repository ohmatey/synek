import type { DepthTier, NodeImage, NodeOrientation, NodeSize, NodeSubtype, Precision } from '~/lib/domain/types'

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
  subtype: NodeSubtype | null
}

export type CanvasNodeData = {
  title: string
  width?: number
  date?: string
  // Formatted end date for span nodes (period/entity) — rendered as `start–end`.
  endDate?: string
  // Truncated description shown on the card body (clamped via CSS).
  summary?: string
  // True when the node has a summary — drives a "more here" affordance on cards
  // (e.g. EventNode) that don't render the summary text inline.
  hasSummary?: boolean
  citations?: number
  images?: NodeImage[]
  size?: NodeSize
  color?: string | null
  subtype?: NodeSubtype | null
  // True when a story is attached to this moment — drives the canvas depth badge.
  hasStory?: boolean
  storyDepth?: DepthTier | null
  // Faint, date-range-derived background tint for period nodes ("mood of the
  // age"). Precomputed in TimelineCanvas via eraTint; applied as a CSS var.
  tint?: string
  // Card shape for the row-style nodes (event/concept): the one-line pill, or a
  // wrapped title over the date. A view setting, not node data.
  orientation?: NodeOrientation
}
