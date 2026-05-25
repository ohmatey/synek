export const NODE_TYPES = ['event', 'entity', 'period'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const EDGE_KINDS = ['caused', 'succeeded', 'influenced', 'acquired', 'competed_with'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const PRECISIONS = ['year', 'quarter', 'month', 'day'] as const
export type Precision = (typeof PRECISIONS)[number]

export const NODE_SIZES = ['small', 'medium', 'large'] as const
export type NodeSize = (typeof NODE_SIZES)[number]

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

// Plain DTO for the chat-thread (session) list — times as epoch-ms (no Date over the RPC).
export type ChatSessionSummary = {
  id: string
  timelineId: string
  title: string
  createdAt: number
  updatedAt: number
}
