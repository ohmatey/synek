// `concept` models an idea/doctrine/principle (e.g. "the dichotomy of control")
// — distinct from an event (a point in time) or an entity (a person/org/place/
// work). Its `start` marks when it was first articulated; the span may be open.
export const NODE_TYPES = ['event', 'entity', 'period', 'concept'] as const
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

// How an image is framed when presented: `landscape` (horizontal, wider than
// tall) or `portrait` (vertical, taller than wide). Drives the crop ratio on the
// canvas card and in the detail panel's hero strip. Absent → landscape.
export const IMAGE_ASPECTS = ['landscape', 'portrait'] as const
export type ImageAspect = (typeof IMAGE_ASPECTS)[number]

// An image attached to a node; `show` marks it for display on the timeline,
// `aspect` chooses its framing (landscape/portrait — defaults to landscape).
export type NodeImage = { url: string; alt?: string; show?: boolean; aspect?: ImageAspect }

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
  // Optional swimlane key: nodes sharing a `lane` are laid out in one horizontal
  // row-group (e.g. all of a company's model launches), ordered left→right by
  // date. Null/absent → the node falls back to its type lane. See layoutLaneY.
  lane: string | null
  // True when a story has been written onto this moment (drives the depth badge);
  // `storyDepth` carries its tier when present. Written via the MCP write_story
  // tool, separate from the graph Patch stack.
  hasStory: boolean
  storyDepth: DepthTier | null
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  kind: EdgeKind
  label: string | null
}

export type TimelineGraph = { title: string; nodes: GraphNode[]; edges: GraphEdge[] }

// Result of loading a timeline for viewing. `ok` carries the graph plus access
// flags (isOwner drives read-only UI; isPublic drives the share control). A
// missing timeline is `notFound`; a private one you can't see is `forbidden`.
// Per-timeline display defaults (the time-axis scale), saved by the owner and
// applied on open when the device has no local override.
export type TimelineViewSettings = { pxPerDay: number; collapseGaps: boolean }

// Bounds + default for the horizontal time density (px of base layout per day).
// Domain-level so both the canvas controls and the MCP set_timeline_view tool
// validate against the same range.
export const BASE_PX_PER_DAY = 0.5
export const MIN_PX_PER_DAY = 0.005 // compressed enough to fit millennia on screen
export const MAX_PX_PER_DAY = 4

export function clampPxPerDay(v: number): number {
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, v))
}

export type TimelineGraphResult =
  | ({
      status: 'ok'
      isOwner: boolean
      isPublic: boolean
      viewSettings: TimelineViewSettings | null
      // A cheap content signature over every story on this timeline. It changes
      // whenever any story is written/rewritten, so the canvas can detect a
      // separate-process (stdio) story write via the graph poll and refresh an
      // already-open reader even when the depth badge is unchanged.
      storyVersion: string
    } & TimelineGraph)
  | { status: 'notFound' }
  | { status: 'forbidden' }

// Plain DTO for the home list — createdAt as epoch-ms (no Date over the RPC).
export type TimelineSummary = {
  id: string
  title: string
  description: string | null
  createdAt: number
  isPublic: boolean
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

// Client-serializable story payload for the node-detail playback reader (plain
// primitives only — the RPC serializer rejects Date/unknown). A story is an
// ordered list of beats (segments) attached to a moment/node.
export type StoryBeat = {
  id: string
  sequence: number
  kind: SegmentKind
  bodyText: string
  settingNote: string | null
  relatedNodeIds: string[]
  // The entity this beat spotlights (a node id), or null to stay on the moment.
  // While reading, the canvas pans + rings it and the detail panel switches to it.
  focusNodeId: string | null
  // S2 slice 1 — real sources backing this beat. Same shape as a node's
  // citations (CanvasCitation), so the reader renders them identically.
  citations: CanvasCitation[]
}

export type StoryDTO = {
  id: string
  title: string
  hook: string | null
  povType: PovType
  depthTier: DepthTier
  estimatedMinutes: number | null
  beats: StoryBeat[]
}

// One entry in a story list — the AppBar's "Stories" dropdown (every story on a
// timeline, chronological) and the entity panel's per-moment list (a moment can
// hold several). Carries the moment it sits on so picking one opens + plays it;
// `beatCount` + `estimatedMinutes` + `povType` let the row show meta chips at a
// glance without fetching the full story.
export type StoryListItem = {
  momentId: string
  momentTitle: string
  storyId: string
  title: string
  hook: string | null
  depthTier: DepthTier
  povType: PovType
  estimatedMinutes: number | null
  beatCount: number
}
