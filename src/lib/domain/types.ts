export const NODE_TYPES = ['event', 'entity', 'period'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const EDGE_KINDS = ['caused', 'succeeded', 'influenced', 'acquired', 'competed_with'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const PRECISIONS = ['year', 'quarter', 'month', 'day'] as const
export type Precision = (typeof PRECISIONS)[number]

// Note: GraphOp lives in `~/lib/db/schema` (alongside the rows it references).
// It is intentionally NOT re-exported here — this module is reachable from
// client code, and pulling the schema (drizzle/bun:sqlite) across the
// server/client boundary breaks TanStack Start's server virtual modules.

// Serializable graph DTOs sent from the server fn to the client canvas
// (plain primitives only — no Date/unknown that the RPC serializer rejects).
export type GraphNode = {
  id: string
  type: NodeType
  title: string
  startInstant: number
  endInstant: number | null
  precision: Precision
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  kind: EdgeKind
  label: string | null
}

export type TimelineGraph = { nodes: GraphNode[]; edges: GraphEdge[] }
