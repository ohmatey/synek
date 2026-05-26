export const NODE_TYPES = ['event', 'entity', 'period'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const EDGE_KINDS = ['caused', 'succeeded', 'influenced', 'acquired', 'competed_with'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const PRECISIONS = ['year', 'quarter', 'month', 'day'] as const
export type Precision = (typeof PRECISIONS)[number]

export const NODE_SIZES = ['small', 'medium', 'large'] as const
export type NodeSize = (typeof NODE_SIZES)[number]

// Entity subtype — drives the card treatment on the canvas (person → portrait
// polaroid, org → logo lockup). Only meaningful for `entity` nodes.
export const NODE_SUBTYPES = ['person', 'org', 'place', 'work'] as const
export type NodeSubtype = (typeof NODE_SUBTYPES)[number]

// An image attached to a node; `show` marks it for display on the timeline.
export type NodeImage = { url: string; alt?: string; show?: boolean }

// Note: GraphOp lives in `~/lib/db/schema` (alongside the rows it references).
// It is intentionally NOT re-exported here — this module is reachable from
// client code, and pulling the schema (drizzle/bun:sqlite) across the
// server/client boundary breaks TanStack Start's server virtual modules.

// Serializable graph DTOs sent from the server fn to the client canvas
// (plain primitives only — no Date/unknown that the RPC serializer rejects).
// Mirrors `Citation` in ~/lib/db/schema, re-declared here so this client-reachable
// module never imports the schema (drizzle/server-only).
export type CanvasCitation = { title: string; url?: string; quote?: string }

export type GraphNode = {
  id: string
  type: NodeType
  title: string
  summary: string | null
  startInstant: number
  endInstant: number | null
  precision: Precision
  citations: CanvasCitation[]
  images: NodeImage[]
  size: NodeSize
  color: string | null
  subtype: NodeSubtype | null
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  kind: EdgeKind
  label: string | null
}

export type TimelineGraph = { title: string; nodes: GraphNode[]; edges: GraphEdge[] }

// Plain DTO for the home list — createdAt as epoch-ms (no Date over the RPC).
export type TimelineSummary = {
  id: string
  title: string
  description: string | null
  createdAt: number
}

// --- Story layer (S1), currently inert ------------------------------------
// These enums back the dormant story tables in the schema (story generation was
// removed when the app became MCP-driven). Kept so the schema stays migratable
// and the capability can be re-exposed through MCP later.

export const POV_TYPES = ['first_person', 'witness', 'omniscient', 'diary'] as const
export type PovType = (typeof POV_TYPES)[number]

export const DEPTH_TIERS = ['light', 'deep'] as const
export type DepthTier = (typeof DEPTH_TIERS)[number]

export const STORY_STATUS = ['draft', 'published', 'archived'] as const
export type StoryStatus = (typeof STORY_STATUS)[number]

export const SEGMENT_KINDS = ['narration', 'dialogue', 'sensory', 'interior'] as const
export type SegmentKind = (typeof SEGMENT_KINDS)[number]
