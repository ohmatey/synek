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

// What kind of source a citation is — lets the reader distinguish Tacitus
// (primary) from a 2014 trade book (scholarship) at a glance. Optional;
// untyped citations render unchanged.
export const CITATION_SOURCE_TYPES = ['primary', 'scholarship', 'data', 'press'] as const
export type CitationSourceType = (typeof CITATION_SOURCE_TYPES)[number]

// --- S2 artifact grounding (ADR 0001) -------------------------------------
// A bibliographic record (book, archive, museum collection) an artifact came from.
export const SOURCE_TYPES = ['book', 'archive', 'paper', 'museum', 'letter_collection', 'website'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

// The kind of primary-source object an artifact is.
export const ARTIFACT_TYPES = ['letter', 'diary_entry', 'photo', 'object', 'inscription', 'record', 'document'] as const
export type ArtifactType = (typeof ARTIFACT_TYPES)[number]

// Provenance distance from the event — orthogonal to CitationSourceType (genre).
// A `press` source can be `primary` (same-day) or `tertiary` (a retrospective).
export const RELIABILITY = ['primary', 'secondary', 'tertiary'] as const
export type Reliability = (typeof RELIABILITY)[number]

// How a story leans on an artifact it links to.
export const STORY_ARTIFACT_REL = ['anchor', 'referenced', 'background'] as const
export type StoryArtifactRel = (typeof STORY_ARTIFACT_REL)[number]

// How a beat's image sits in the story reader: `full` (block above the text),
// `inset-left`/`inset-right` (floated beside it), `bleed` (full-panel backdrop
// behind the beat with a scrim). Defaults to `full`.
export const STORY_IMAGE_LAYOUTS = ['full', 'inset-left', 'inset-right', 'bleed'] as const
export type StoryImageLayout = (typeof STORY_IMAGE_LAYOUTS)[number]

// An image attached to a story beat (or a story's cover, where `layout` is
// ignored). Same sourcing rules as node images: a real, web-accessible URL.
export type StoryImage = { url: string; alt?: string; aspect?: ImageAspect; layout?: StoryImageLayout }

// A story's cast: entries either point at a node on the same timeline
// (clickable, tourable) or carry just a name — a character the writer used in
// prose that has no node yet (write_story warns about these so the client can
// materialize them with apply_patch).
export type StoryCastMember = { nodeId?: string; name?: string; role?: string }

// Note: GraphOp lives in `~/lib/db/schema` (alongside the rows it references).
// It is intentionally NOT re-exported here — this module is reachable from
// client code, and pulling the schema (drizzle/bun:sqlite) across the
// server/client boundary breaks TanStack Start's server virtual modules.

// Serializable graph DTOs sent from the server fn to the client canvas
// (plain primitives only — no Date/unknown that the RPC serializer rejects).
// Mirrors `Citation` in ~/lib/db/schema, re-declared here so this client-reachable
// module never imports the schema (drizzle/server-only).
export type CanvasCitation = { title: string; url?: string; quote?: string; sourceType?: CitationSourceType }

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
  // Where this happened — a plain display string ("Golgotha, Jerusalem"); no
  // geocoding. Shown in the detail panel's dateline.
  location: string | null
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

// A citation shown on a story beat. Either an unregistered one-off (just the
// CanvasCitation fields — single-home in story_segments.citations) or projected
// from a registered artifact (carries `artifactId` + the artifact metadata the
// S2.4 reader card surfaces). The reader renders `title`/`quote`/`url` for both;
// the artifact fields are additive (older readers ignore them). ADR 0001 Dec. 8.
export type StoryBeatCitation = CanvasCitation & {
  artifactId?: string
  reliability?: Reliability
  transcript?: string | null
  translation?: string | null
  imageUrl?: string | null
}

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
  // Real sources backing this beat — inline one-offs and/or artifact-backed
  // citations, merged for display (ADR 0001, Decision 8).
  citations: StoryBeatCitation[]
  // Optional art for this beat; `layout` picks its reader treatment
  // (full/inset-left/inset-right/bleed). Null → text-only beat.
  image: StoryImage | null
}

export type StoryDTO = {
  id: string
  title: string
  hook: string | null
  povType: PovType
  depthTier: DepthTier
  estimatedMinutes: number | null
  // Optional cover art shown on the reader's cover panel (layout ignored).
  coverImage: StoryImage | null
  // The story's cast — node-backed members are clickable; name-only members
  // exist in prose but have no node yet.
  cast: StoryCastMember[]
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
