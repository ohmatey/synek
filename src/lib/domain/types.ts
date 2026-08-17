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

// Why a node carries NO lat/lng — the explicit "cannot be pinned" marker,
// mutually exclusive with coordinates. 'global' = happened everywhere (a
// worldwide era); 'diffuse' = several real sites with no honest single anchor
// (the four Gospels); 'unknown' = the place is genuinely lost to history.
// Distinguishes "reviewed, deliberately unpinned" from "not yet located", so
// coverage math converges and backfill prompts stop re-litigating the node.
export const GEO_SCOPES = ['global', 'diffuse', 'unknown'] as const
export type GeoScope = (typeof GEO_SCOPES)[number]

// Reader-facing copy for each scope — shown wherever a located node would show
// its place (detail-panel location row, globe captions).
export const GEO_SCOPE_LABELS: Record<GeoScope, string> = {
  global: 'Worldwide — no single place',
  diffuse: 'Several places — no single anchor',
  unknown: 'Location unknown',
}

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
  // Optional geo coordinates for `location` (decimal degrees); null when unset.
  // The globe lens plots nodes that carry both. MCP-client-supplied.
  lat: number | null
  lng: number | null
  // Explicit placeless marker (mutually exclusive with lat/lng): the node was
  // reviewed and cannot be pinned. Null = either located or not yet reviewed.
  geoScope: GeoScope | null
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
export type TimelineViewSettings = {
  pxPerDay: number
  collapseGaps: boolean
  nodeOrientation?: NodeOrientation
}

// Card shape for the row-style nodes (event pills, concept chips). 'horizontal'
// is the original one-line pill; 'vertical' wraps the title above the date so a
// long title costs height instead of axis width. Span/card nodes (period,
// entity, person, work) already stack and ignore this.
export type NodeOrientation = 'horizontal' | 'vertical'
// Stacked ("vertical") is the default: a horizontal pill's width is dictated by its
// TITLE, which both crowds the axis and makes width meaningless as a signal. Stacking
// the title over the date frees width to mean what it should on a timeline, namely the
// node's start..end span. Timelines with a saved viewSettings.nodeOrientation keep it.
export const DEFAULT_NODE_ORIENTATION: NodeOrientation = 'vertical'

// Bounds + default for the horizontal time density (px of base layout per day).
// Domain-level so both the canvas controls and the MCP set_timeline_view tool
// validate against the same range.
export const BASE_PX_PER_DAY = 0.5
export const MIN_PX_PER_DAY = 0.005 // compressed enough to fit millennia on screen
export const MAX_PX_PER_DAY = 4

// Sparse-time compression (gap collapsing) is on unless the timeline's saved
// viewSettings or the user's explicit device pref says otherwise.
export const DEFAULT_COLLAPSE_GAPS = true

export function clampPxPerDay(v: number): number {
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, v))
}

// --- Per-timeline styled theme ---------------------------------------------
// A timeline's own visual identity, saved by the owner (settings UI) or the MCP
// client (set_timeline_theme). Freeform hex colors over the canvas accent
// system, an optional canvas wash, a curated display font and texture — plus
// AI-facing metadata (imageStyle/mood) the MCP client reads back and folds into
// the image/copy prompts it generates for this timeline. Stored as one JSON
// column; replace-on-write (null clears), never part of the Patch/undo stack.

// Curated display-font keys — the canvas maps these to real font stacks
// (resolveTimelineTheme); the data layer stores only the key.
export const THEME_FONTS = ['default', 'serif', 'slab', 'mono', 'rounded', 'grotesk'] as const
export type ThemeFont = (typeof THEME_FONTS)[number]

export const THEME_TEXTURES = ['none', 'dots', 'grid', 'paper'] as const
export type ThemeTexture = (typeof THEME_TEXTURES)[number]

// Freeform hex (#rgb | #rrggbb) overrides, every slot optional. An unset slot
// falls back to the default token for the active color scheme.
export type ThemeColorSlots = {
  accentPrimary?: string // --color-accent-primary (selection, primary UI)
  accentStory?: string // --color-accent-story (story badges, caused edges)
  accentInfluence?: string // --color-accent-influence (influenced edges)
  accentDialogue?: string // --color-accent-dialogue (succeeded edges)
  accentEra?: string // --color-accent-era (period rails)
  canvasBg?: string // the canvas pane wash behind the graph
}

export type TimelineTheme = {
  name?: string // display name, e.g. "Imperial Marble"
  // Per-scheme colors so a theme adapts to the global light/dark mode. Accents
  // cross-fall-back to the other scheme; canvasBg is strictly per-scheme.
  colors?: { dark?: ThemeColorSlots; light?: ThemeColorSlots }
  font?: { display?: ThemeFont }
  texture?: ThemeTexture
  imageStyle?: string // image-generation style fragment ("engraved lithograph, sepia")
  mood?: string[] // style keywords for AI art/copy coherence
}

export type TimelineGraphResult =
  | ({
      status: 'ok'
      isOwner: boolean
      isPublic: boolean
      viewSettings: TimelineViewSettings | null
      // The timeline's saved visual theme (null = brand default look).
      theme: TimelineTheme | null
      // A cheap content signature over every story on this timeline. It changes
      // whenever any story is written/rewritten, so the canvas can detect a
      // separate-process (stdio) story write via the graph poll and refresh an
      // already-open reader even when the depth badge is unchanged.
      storyVersion: string
    } & TimelineGraph)
  | { status: 'notFound' }
  | { status: 'forbidden' }

// --- Shared entities (ADR 0004) — cross-timeline aggregation DTOs ----------
// The full-screen entity page is per-placement (keyed by timelineId+nodeId) but
// shows, for the OWNER, every timeline the underlying entity appears on plus the
// entity's own content undo/redo state. Non-owner / signed-out → `forbidden`
// (they still get the read-only per-timeline view); a bare legacy node with no
// entity → `none` (no aggregation to show).
export type EntityPlacement = { timelineId: string; timelineTitle: string; nodeId: string }
export type EntityContextResult =
  | { status: 'none' }
  | { status: 'forbidden' }
  | { status: 'ok'; entityId: string; placements: EntityPlacement[]; canUndo: boolean; canRedo: boolean }

// One hit in the canvas "add existing entity" picker.
export type EntitySearchHit = { entityId: string; type: NodeType; title: string; summary: string | null }

// Plain DTO for the home list — createdAt as epoch-ms (no Date over the RPC).
export type TimelineSummary = {
  id: string
  title: string
  description: string | null
  createdAt: number
  // Last change to the timeline — metadata edits AND graph writes (commitPatch
  // bumps it), as epoch-ms. The home's "Recently updated" sort key. No Date over
  // the RPC.
  updatedAt: number
  isPublic: boolean
  // The project this timeline belongs to (ADR 0002 D7), or null for a legacy
  // null-project row. The cinematic home reads it for the move-to-project "current"
  // marker + the undo path (which project to send the timeline back to).
  projectId: string | null
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

// Which canvas surface a beat plays on while a story reads — the author's camera
// choreography. `globe` pulls the orthographic globe up and frames the beat's place;
// `timeline` keeps the horizontal time axis. Null = auto: the reader derives it from
// whether the beat's focus node is located (lat/lng → globe, else timeline). Driving
// this per beat makes a story switch surfaces as it tells — a place beat on the globe,
// a time/idea beat on the timeline — for a fully immersive read.
export const STORY_LENSES = ['globe', 'timeline'] as const
export type StoryLens = (typeof STORY_LENSES)[number]

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

// --- Per-beat live widget (sharable stories) ------------------------------
// A small, read-only render of the timeline, the globe, or a single entity
// card embedded INTO a story beat — the panel's hero visual when there is no
// (or alongside an) image. References nodes by id (soft refs, like focusNodeId),
// resolved at READ time so a widget stays LIVE as the underlying graph changes
// (a public story tracking a competitor updates the moment its nodes do).
// `layout` reuses the beat-image treatment vocabulary.
export const STORY_WIDGET_KINDS = ['timeline', 'globe', 'entity'] as const
export type StoryWidgetKind = (typeof STORY_WIDGET_KINDS)[number]

export type StoryBeatWidget = {
  kind: StoryWidgetKind
  // The nodes the widget renders: a `timeline` strip plots these by date, a
  // `globe` pins the located ones, an `entity` card uses the first id.
  nodeIds: string[]
  // The node to spotlight — highlighted on the strip, centered on the globe.
  // Implied by nodeIds[0] for an entity widget; optional for the others.
  focusNodeId?: string
  // How the widget sits in the panel (same treatment vocab as a beat image).
  layout?: StoryImageLayout
  // Optional one-line caption shown under the widget.
  caption?: string
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
  // The canvas surface this beat plays on (globe / timeline), or null = auto (derive
  // from the focus node's location). Lets a story switch surfaces beat-to-beat for an
  // immersive read. See StoryLens.
  lens: StoryLens | null
  // Real sources backing this beat — inline one-offs and/or artifact-backed
  // citations, merged for display (ADR 0001, Decision 8).
  citations: StoryBeatCitation[]
  // Optional art for this beat; `layout` picks its reader treatment
  // (full/inset-left/inset-right/bleed). Null → text-only beat.
  image: StoryImage | null
  // Optional LIVE widget for this beat (a mini timeline / globe / entity card),
  // resolved from node ids at read time. Null → no widget. The sharable public
  // reader renders these as the panel's hero visual.
  widget: StoryBeatWidget | null
}

export type StoryDTO = {
  id: string
  // URL-safe public handle (unique). Backs the sharable /s/$slug page.
  slug: string
  // Per-story public visibility — independent of the timeline. The /s/$slug page
  // gates on this; the in-app reader + Share dialog reflect it. false = private.
  isPublic: boolean
  // The moment (node id) this story is anchored to. The reader uses it as the
  // story's camera/title anchor, so playback is decoupled from canvas selection
  // (a story runs by itself; opening an entity is a separate, explicit gesture).
  momentId: string
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
  // The story's OWN theme, or null to inherit. The renderer resolves the chain
  // story.theme ?? timeline.theme ?? project.theme; this is the raw story row so
  // the editor can "read the current theme to tweak it".
  theme: TimelineTheme | null
  beats: StoryBeat[]
}

// The payload the public, no-auth /s/$slug share page loads (SSR). Carries the
// story plus the lightweight nodes its cast / beat-focus / widgets reference
// (resolved at read time so the page stays live), the timeline's theme for a
// branded artifact, the axis scale a timeline widget reads, and `updatedAt` for
// the "updated X ago" live stamp. Gated on the timeline being public.
export type PublicStoryDTO = {
  story: StoryDTO
  timelineId: string
  timelineTitle: string
  theme: TimelineTheme | null
  viewSettings: TimelineViewSettings | null
  updatedAt: number
  nodes: GraphNode[]
}

// --- Serialized stories (ADR 0006) — the public "season" page -------------
// What /sr/$slug needs to play a series in order: series meta + its PUBLIC chapters
// (each a full StoryDTO, ordered by chapterNumber) + the union of nodes those
// chapters reference (no full-graph leak). `theme` is the resolved chain
// (series.theme ?? project.theme ?? defaults).
// `momentInstant` is the chapter's anchor-moment instant (epoch-ms) — the spine's
// dateline (right column). null when the moment has no resolvable date.
export type PublicSeriesChapter = { chapterNumber: number | null; momentInstant: number | null; story: StoryDTO }
export type PublicSeriesDTO = {
  series: { id: string; slug: string; title: string; hook: string | null; coverImage: StoryImage | null; theme: TimelineTheme | null }
  chapters: PublicSeriesChapter[]
  nodes: GraphNode[]
  updatedAt: number
}

// The in-app (owner) series detail view (local-161 slice B). ALL chapters incl.
// drafts, each with status + dateline; the derived frontier; and the parent project
// for the breadcrumb. Distinct from PublicSeriesDTO (no auth, public chapters only).
export type SeriesDetailChapter = {
  storyId: string
  number: number | null
  title: string
  hook: string | null
  momentInstant: number | null
  status: StoryStatus
  isPublic: boolean
  slug: string
  // The timeline this chapter's moment lives on — lets the series-detail spine
  // deep-link into the canvas reader (/timelines/$timelineId?story=$storyId). null
  // when the moment can't be resolved to a timeline (an orphaned chapter).
  timelineId: string | null
}
export type SeriesDetailDTO = {
  series: {
    id: string
    slug: string
    title: string
    hook: string | null
    coverImage: StoryImage | null
    theme: TimelineTheme | null
    brandId: string | null
    isPublic: boolean
    // Owner review gate (local-175): when ON, chapters written into this series are
    // born `draft` until the owner publishes them. Drives the detail "Review mode" switch.
    reviewMode: boolean
  }
  project: { slug: string; title: string } | null
  chapters: SeriesDetailChapter[]
  frontier: { lastChapterNumber: number | null; lastInstant: number | null }
  updatedAt: number
}

// A series card for the cinematic home (slice 5) — owner-scoped list row.
export type HomeSeriesCard = {
  seriesId: string
  slug: string
  title: string
  hook: string | null
  coverImage: StoryImage | null
  isPublic: boolean
  chapterCount: number
  updatedAt: number
}

// --- Projects (ADR 0002) — the top-level owned container ------------------
// A Project sits above timelines and holds the project-level metadata every
// later phase reads (`kind`, `world`, `brandRef`, `theme`). Slice 1 only ever
// writes `kind='nonfiction'` and leaves `world` null (Earth); the columns are
// reserved now so P2 (Realscript brand), P4 (fiction / generated worlds +
// basemap) become additive, not populated-table migrations.

// Project truth model (ADR 0002 D2). Designed in now; slice 1 only writes
// 'nonfiction'. Fiction is P4-additive (set kind='fiction', populate `world`).
export const PROJECT_KINDS = ['nonfiction', 'fiction'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

// World / basemap config (ADR 0002 D3). RESERVED seam — the full shape is a P4
// concern (the globe-basemap ADR). null (or `{ basemap: 'earth' }`) == real
// Earth; slice 1 leaves it null for every project. A nullable JSON column carries
// future basemap config without a schema change.
export type ProjectWorld = { basemap: 'earth' } | { basemap: 'custom'; topojsonUrl: string }

// Plain DTO for the home list — createdAt as epoch-ms (no Date over the RPC),
// mirroring TimelineSummary. The project-level theme drives timeline theme
// inheritance (timeline.theme ?? project.theme ?? defaults).
export type ProjectSummary = {
  id: string
  slug: string
  title: string
  description: string | null
  kind: ProjectKind
  createdAt: number
}

// One entry in the cinematic home's story rows + hero (every story the owner has,
// across all their timelines, optionally narrowed to one project). A superset of
// StoryListItem: it ALSO carries the parent `timelineId` (so a card can deep-link
// into the in-app reader at /timelines/$id?story=$storyId) and `updatedAt` (the
// featured-selection + "Your stories" sort key). Sorted newest-`updatedAt`-first.
export type HomeStoryCard = StoryListItem & {
  // The timeline this story is anchored to (its moment's timeline). The card
  // navigates here for Play (?story=&autoplay) and Continue writing (?story=) — both
  // open the docked reader via the canvas's ?story → reader bridge.
  timelineId: string
  // The owner-saved title of the parent timeline — the hero eyebrow's TIMELINE half.
  timelineTitle: string
  // Last write to the story (write_story / apply_patch bump it) as epoch-ms — the
  // home's sort + featured-selection signal. No Date over the RPC.
  updatedAt: number
  // Display names of the story's cast for the hero chips — node-backed members
  // resolved to their node title, name-only members kept as-is, in cast order. The
  // home doesn't ship the cast nodes, so these are pre-resolved server-side.
  castNames: string[]
  // When this story is a chapter of a series, the series it belongs to — lets the
  // featured hero badge "Chapter N · {series}" and link straight to the season
  // (local-161 slice E). null for standalone stories. Pairs with `chapterNumber`.
  series: { id: string; slug: string; title: string } | null
}

// One entry in the cinematic home's "Entities" row — a canonical, owner-scoped
// `entities` row (ADR 0004) surfaced as a browsable card. Entities are SHARED: one
// entity can be placed on many timelines (across projects), so the card carries
// `timelineCount` (its reach) and a `primary*` placement to open. The home has no
// dedicated entity page, so "Open" deep-links to the full-screen node page of the
// first-placed node. Sorted newest-`updatedAt`-first (most recently edited content).
export type HomeEntityCard = {
  entityId: string
  title: string
  type: NodeType
  summary: string | null
  // First displayable image (metadata.images, `show !== false`), else null → the
  // card renders a type-icon wash keyed off entityId (same fallback as StoryCard).
  thumbnail: { url: string; alt: string | null } | null
  // How many distinct timelines this entity is placed on — its cross-timeline reach,
  // the signal that distinguishes a shared entity from a one-off node.
  timelineCount: number
  // The first-placed node (earliest `createdAt`) — the canonical "Open" target. The
  // card deep-links to /timelines/$primaryTimelineId/nodes/$primaryNodeId.
  primaryTimelineId: string
  primaryNodeId: string
  // Last content edit (entities.updatedAt) as epoch-ms — the row's sort key.
  updatedAt: number
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
  // URL-safe public handle (unique) — lets a list row build its share link.
  slug: string
  title: string
  hook: string | null
  depthTier: DepthTier
  povType: PovType
  estimatedMinutes: number | null
  beatCount: number
  // Cover art for the story card in the Stories view (null = text-only card).
  coverImage: StoryImage | null
  // Per-story public visibility — lets the Share dialog show + toggle each story's
  // own public state, independent of the timeline's.
  isPublic: boolean
  // Serialized stories (ADR 0006): the chapter number when this story belongs to a
  // series, else null — lets the Stories popover badge "Ch. N".
  chapterNumber: number | null
  // Epoch ms. The DB returns rows in timeline (moment-date) order; the Stories
  // panel defaults to newest-written, which is a different axis entirely.
  createdAt: number
}
