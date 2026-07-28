import { z, type ZodRawShape } from 'zod'
import {
  ensureTimeline,
  createTimeline,
  listTimelines,
  loadGraph,
  getTimelineMeta,
  resolveTimelineTheme,
  setTimelineView,
  setTimelineTheme,
} from '~/lib/db/graph'
import {
  createProject,
  listProjects,
  getProjectMeta,
  ensureDefaultProject,
  makeRequireOwnedProject,
} from '~/lib/db/projects'
import { listEntitiesForHome } from '~/lib/db/entities'
import {
  BASE_PX_PER_DAY,
  MIN_PX_PER_DAY,
  MAX_PX_PER_DAY,
  DEFAULT_COLLAPSE_GAPS,
  DEFAULT_NODE_ORIENTATION,
  clampPxPerDay,
} from '~/lib/domain/types'
import { PatchBuilder, commitPatch, undo, redo, historyState, maxAppliedSeq } from '~/lib/db/patches'
import {
  writeStory,
  patchStory,
  undoStory,
  redoStory,
  storyHistoryState,
  getMomentTimelineId,
  getStoriesForMoment,
  storyDepthByMoment,
  setStoryTheme,
  setStoryBrand,
  getStoryTimelineId,
  type StoryOp,
} from '~/lib/db/stories'
import {
  createSeries,
  getSeries,
  seriesWatermark,
  setSeriesShared,
  setSeriesReviewMode,
  makeRequireOwnedSeries,
  updateSeries,
  nextChapterNumber,
} from '~/lib/db/series'
import { listBrands, getBrand, makeRequireOwnedBrand } from '~/lib/db/brands'
import { deriveThemeFromBrand } from '~/lib/theme/deriveThemeFromBrand'
import { registerArtifact, searchArtifacts, existingArtifactIds } from '~/lib/db/artifacts'
import { emitTimelineEvent } from '~/lib/server/bus'
import { notifyNewChapter } from '~/lib/server/notify-chapter'
import {
  POV_TYPES,
  DEPTH_TIERS,
  SEGMENT_KINDS,
  STORY_LENSES,
  IMAGE_ASPECTS,
  STORY_IMAGE_LAYOUTS,
  STORY_WIDGET_KINDS,
  NODE_TYPES,
  ARTIFACT_TYPES,
  RELIABILITY,
  SOURCE_TYPES,
  CITATION_SOURCE_TYPES,
} from '~/lib/domain/types'
import { parseDate, formatInstant } from '~/lib/domain/dates'
import { BASE_URL } from '~/lib/auth'
import { timelineThemeSchema } from '~/lib/domain/theme'
import { opSchema, applyOps } from './ops'
import { collectPatchWarnings, imageUrlWarnings } from './warnings'
import { themeContrastWarnings } from './theme-warnings'
import { buildLayoutReport } from './layout-report'
import type { Graph } from '~/lib/db/graph'

// The per-call context every tool handler receives. `ownerId` scopes all reads
// and writes to one user's timelines; `requireOwned` is the shared id guard.
// `projectId` is the OPTIONAL active project for a build session — an
// ORGANIZATIONAL narrowing WITHIN the owner, never a second security boundary
// (ownerId stays the only one). When absent, create_timeline falls back to the
// owner's default project and list_timelines returns all the owner's timelines
// (today's behavior preserved). `requireOwnedProject` is the project-level guard.
// buildMcpServer (MCP transport) and the in-app agent runner both build this and
// run the SAME handlers — one tool surface, two callers.
export type ToolCtx = {
  ownerId: string
  projectId?: string
  requireOwned: (timelineId: string) => void
  requireOwnedProject?: (projectId: string) => void
}

// A transport-agnostic tool definition. Handlers return the RAW result object;
// each caller wraps it for its own protocol (MCP -> { content:[{type:'text'}] },
// the agent runner -> JSON.stringify into a tool message).
export type ToolDef = {
  name: string
  title: string
  description: string
  inputSchema: ZodRawShape
  handler: (args: any, ctx: ToolCtx) => Promise<unknown>
}

// Build the shared owner guard: a timeline id must exist and belong to this
// owner, else a tool error. Shared so the MCP server and the runner guard identically.
export function makeRequireOwned(ownerId: string) {
  return (timelineId: string) => {
    const meta = getTimelineMeta(timelineId)
    if (!meta || meta.ownerId !== ownerId) {
      throw new Error(`timeline "${timelineId}" not found`)
    }
  }
}

// A tiny running tally returned with every apply_patch so the building client
// keeps a mental map of the graph without ever paying for a full get_timeline.
function graphSummary(graph: Graph) {
  const byType: Record<string, number> = {}
  const byLane: Record<string, number> = {}
  let lo = Infinity
  let hi = -Infinity
  for (const n of graph.nodes) {
    byType[n.type] = (byType[n.type] ?? 0) + 1
    const lane = n.metadata?.lane
    if (lane) byLane[lane] = (byLane[lane] ?? 0) + 1
    lo = Math.min(lo, n.startInstant)
    hi = Math.max(hi, n.endInstant ?? n.startInstant)
  }
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    byType,
    byLane,
    span: graph.nodes.length ? `${formatInstant(lo, 'year')} – ${formatInstant(hi, 'year')}` : null,
  }
}

// The viewer URL a client hands back to the user so they can watch the canvas
// build live. BASE_URL is the same origin the app + auth run on.
const viewerUrl = (id: string) => `${BASE_URL}/timelines/${id}`

// An image on a story (cover) or a beat. `layout` only applies to beats.
const storyImageInput = z.object({
  url: z
    .string()
    .describe('Public image URL you sourced (Wikimedia art, archival photo) — real URLs only, never invented.'),
  alt: z.string().optional().describe('Short caption / alt text.'),
  aspect: z.enum(IMAGE_ASPECTS).optional().describe('"portrait" for tall subjects, "landscape" for wide scenes.'),
  layout: z
    .enum(STORY_IMAGE_LAYOUTS)
    .optional()
    .describe(
      'Reader treatment for a BEAT image: "full" (block above the text — the default), "inset-left"/' +
        '"inset-right" (small, floated beside the text), "bleed" (full-panel backdrop behind the beat with a ' +
        'scrim — cinematic; use sparingly). Ignored on coverImage.',
    ),
})

// A LIVE per-beat widget (sharable stories): a mini timeline strip, an
// orthographic globe, or an entity card — referencing nodes by id and resolved
// at read time, so it stays live as the graph changes. The sharable public
// reader renders it as the panel's hero visual.
const storyWidgetInput = z.object({
  kind: z
    .enum(STORY_WIDGET_KINDS)
    .describe(
      'Which live mini-view this beat shows: "timeline" (a small dated strip of the listed nodes, the focus one ' +
        'highlighted), "globe" (an orthographic globe pinning the located nodes, centered on the focus), or "entity" ' +
        '(a card for ONE node — portrait, dates, place).',
    ),
  nodeIds: z
    .array(z.string())
    .min(1)
    .describe(
      'Node ids this widget renders — events/periods on a timeline strip, places to pin on a globe, or a single ' +
        'node for an entity card (first id used). All must be nodes on this timeline.',
    ),
  focusNodeId: z.string().optional().describe('The node to spotlight — highlighted on the strip, centered on the globe.'),
  layout: z
    .enum(STORY_IMAGE_LAYOUTS)
    .optional()
    .describe('How the widget sits in the panel (same vocab as a beat image; "bleed" backs the whole panel).'),
  caption: z.string().optional().describe('Optional one-line caption shown under the widget.'),
})

// A single beat citation — single-home (ADR 0001 Dec. 8): an artifact-backed ref
// `{ artifactId, excerptUsed? }` to a REGISTERED artifact (preferred), OR an inline
// one-off `{ title, url?, quote?, sourceType? }`. Disjoint by their keys.
const citationInput = z.union([
  z.object({
    artifactId: z.string().describe('Id of a registered artifact (from register_artifact / search_artifacts).'),
    excerptUsed: z.string().optional().describe('The passage of the artifact this beat draws on.'),
  }),
  z.object({
    title: z.string(),
    url: z.string().optional(),
    quote: z.string().optional(),
    sourceType: z.enum(CITATION_SOURCE_TYPES).optional(),
  }),
])

// One story beat (segment) — the shared shape write_story and patch_story both
// accept. Extracted so the two tools never drift.
const storyBeatInput = z.object({
  bodyText: z.string(),
  kind: z.enum(SEGMENT_KINDS).optional(),
  settingNote: z.string().optional(),
  relatedNodeIds: z.array(z.string()).optional(),
  // Spotlight one entity for this beat: the canvas pans + rings it and the entity
  // panel beside the story switches to show it. A node id on the same timeline.
  focusNodeId: z.string().optional(),
  // Choreograph the camera: 'globe' (frame its place) or 'timeline' (the time axis).
  // Omit for auto (globe when the focus node is located, else timeline).
  lens: z.enum(STORY_LENSES).optional(),
  citations: z.array(citationInput).optional(),
  image: storyImageInput.optional().describe('Optional art for this beat; `layout` picks its treatment.'),
  widget: storyWidgetInput
    .optional()
    .describe('Optional LIVE widget for this beat (a mini timeline / globe / entity card from node ids).'),
})

// The viewer/home URL for a project — slug-addressable (D6).
const projectUrl = (p: { slug: string }) => `${BASE_URL}/p/${p.slug}`
// The public "season" page for a series (D10) — slug-addressable.
const seriesUrl = (s: { slug: string }) => `${BASE_URL}/sr/${s.slug}`

// The shared tool surface. Order mirrors the original server.ts registration.
export const toolRegistry: ToolDef[] = [
  {
    name: 'create_project',
    title: 'Create project',
    description:
      'Create a new PROJECT — the top-level container that holds many timelines, stories, and resources. ' +
      'Returns its id, slug, title, and url. New timelines you create in this session land in a project; ' +
      'create one first when starting a fresh body of work, then build timelines inside it (pass its id as ' +
      '`projectId` to create_timeline, or rely on it being the active project).',
    inputSchema: {
      title: z.string(),
      description: z.string().optional().describe('Optional one-line description of what this project covers.'),
    },
    handler: async ({ title, description }, { ownerId }) => {
      const p = createProject(title, ownerId, { description: description ?? null })
      return { id: p.id, slug: p.slug, title: p.title, url: projectUrl(p) }
    },
  },

  {
    name: 'list_projects',
    title: 'List projects',
    description: 'List your projects (id, slug, title, kind), newest first — the containers your timelines live in.',
    inputSchema: {},
    handler: async (_args, { ownerId }) =>
      listProjects(ownerId).map((p) => ({ id: p.id, slug: p.slug, title: p.title, kind: p.kind })),
  },

  {
    name: 'get_project',
    title: 'Get one project',
    description:
      'One project\'s metadata (id, slug, title, description, kind, theme) plus the timelines it contains ' +
      '(id + title, newest first). Use it to see what a project holds before building into it.',
    inputSchema: { projectId: z.string() },
    handler: async ({ projectId }, { ownerId, requireOwnedProject }) => {
      ;(requireOwnedProject ?? makeRequireOwnedProject(ownerId))(projectId)
      const meta = getProjectMeta(projectId)!
      return {
        id: meta.id,
        slug: meta.slug,
        title: meta.title,
        kind: meta.kind,
        theme: meta.theme ?? null,
        timelines: listTimelines(ownerId, projectId).map((t) => ({ id: t.id, title: t.title })),
      }
    },
  },

  {
    name: 'list_timelines',
    title: 'List timelines',
    description:
      'List your timelines (id + title), newest first. Pass `projectId` to list only that project\'s timelines; ' +
      'omit it for all your timelines (or the active project\'s, if this session has one).',
    inputSchema: {
      projectId: z
        .string()
        .optional()
        .describe('Scope to one project\'s timelines. Omit for all your timelines (or the active project\'s).'),
    },
    handler: async ({ projectId }, { ownerId, projectId: activeProjectId, requireOwnedProject }) => {
      const scope = projectId ?? activeProjectId
      if (scope) (requireOwnedProject ?? makeRequireOwnedProject(ownerId))(scope)
      return listTimelines(ownerId, scope).map((t) => ({ id: t.id, title: t.title }))
    },
  },

  {
    name: 'list_entities',
    title: 'List entities',
    description:
      'List your canonical entities — the SHARED content a node renders (ADR 0004). One entity can be placed on ' +
      'many timelines, so each row reports `timelineCount` (its reach) and a `primaryTimelineId`/`primaryNodeId` ' +
      '(its first placement). Use this to REUSE an existing entity across timelines instead of recreating it: find ' +
      'one here, then place it via an add_node op that points at this entity. Pass `projectId` to scope to one ' +
      'project; omit for all your entities (or the active project\'s).',
    inputSchema: {
      projectId: z
        .string()
        .optional()
        .describe('Scope to one project\'s entities. Omit for all your entities (or the active project\'s).'),
    },
    handler: async ({ projectId }, { ownerId, projectId: activeProjectId, requireOwnedProject }) => {
      const scope = projectId ?? activeProjectId
      if (scope) (requireOwnedProject ?? makeRequireOwnedProject(ownerId))(scope)
      return listEntitiesForHome(ownerId, scope).map((e) => ({
        entityId: e.entityId,
        title: e.title,
        type: e.type,
        summary: e.summary,
        timelineCount: e.timelineCount,
        primaryTimelineId: e.primaryTimelineId,
        primaryNodeId: e.primaryNodeId,
      }))
    },
  },

  {
    name: 'create_timeline',
    title: 'Create timeline',
    description:
      'Create a new empty timeline. Returns its id, title, and viewer url — share the url with the user. ' +
      'It lands in the given `projectId` (or this session\'s active project, else your default project). ' +
      'Optionally pass `theme` to style it at birth (same shape as set_timeline_theme).',
    inputSchema: {
      title: z.string(),
      projectId: z
        .string()
        .optional()
        .describe('The project to create the timeline in. Omit to use the active / default project.'),
      theme: timelineThemeSchema.optional().describe('Optional initial theme — same shape as set_timeline_theme.'),
    },
    handler: async ({ title, projectId, theme }, { ownerId, projectId: activeProjectId, requireOwnedProject }) => {
      // Resolve the target project: explicit arg → session active → owner default.
      const target = projectId ?? activeProjectId ?? ensureDefaultProject(ownerId)
      ;(requireOwnedProject ?? makeRequireOwnedProject(ownerId))(target)
      const t = createTimeline(title, ownerId, target)
      // No SSE emit needed: a brand-new timeline has no live viewers yet.
      if (theme) setTimelineTheme(t.id, ownerId, theme)
      const warnings = theme ? themeContrastWarnings(theme) : []
      return { id: t.id, title: t.title, projectId: target, url: viewerUrl(t.id), ...(warnings.length ? { warnings } : {}) }
    },
  },

  {
    name: 'get_timeline',
    title: 'Get timeline graph',
    description:
      'Return a timeline\'s full graph: { title, viewSettings, theme, nodes, edges }. Use node ids for update/delete/edge ops. ' +
      '`viewSettings` is the saved default time-axis scale ({ pxPerDay, collapseGaps }; null = defaults, with sparse-time compression on) — change it with set_timeline_view. ' +
      '`theme` is the saved visual theme + AI style metadata (null if unset) — reuse its `imageStyle`/`mood` when ' +
      'generating art or copy for this timeline; change it with set_timeline_theme.',
    inputSchema: { timelineId: z.string() },
    handler: async ({ timelineId }, { requireOwned }) => {
      requireOwned(timelineId)
      const meta = getTimelineMeta(timelineId)!
      return {
        title: meta.title,
        viewSettings: meta.viewSettings ?? null,
        // Effective theme: the timeline's own, else inherited from its project (D5).
        theme: resolveTimelineTheme(meta),
        ...loadGraph(timelineId),
      }
    },
  },

  {
    name: 'query_timeline',
    title: 'Query timeline nodes',
    description:
      'Context-cheap read: filter a timeline\'s nodes and get COMPACT rows ({ id, title, type, start, end?, lane?, ' +
      'location?, coords?, geoScope?, hasStory? }) instead of the full graph. Use this (not get_timeline) for mid-build lookups — ' +
      'finding a node id, listing a lane, checking an era. Pass full:true to include summaries + citations for ' +
      'the matched rows only. Filters combine with AND.',
    inputSchema: {
      timelineId: z.string(),
      q: z.string().optional().describe('Case-insensitive text match on title + summary.'),
      type: z.enum(NODE_TYPES).optional(),
      lane: z.string().optional().describe('Exact lane name; pass "" to match nodes with NO lane.'),
      from: z.string().optional().describe('Only nodes starting on/after this date ("49 BCE", "1995", "2014-03").'),
      to: z.string().optional().describe('Only nodes starting on/before this date.'),
      hasStory: z.boolean().optional().describe('Only moments with (true) / without (false) a story.'),
      full: z.boolean().optional().describe('Include summary, citations, images, and edges count per row.'),
      limit: z.number().int().positive().max(200).optional().describe('Max rows (default 50).'),
      offset: z.number().int().nonnegative().optional(),
    },
    handler: async ({ timelineId, q, type, lane, from, to, hasStory, full, limit, offset }, { requireOwned }) => {
      requireOwned(timelineId)
      const graph = loadGraph(timelineId)
      const storyDepth = storyDepthByMoment(graph.nodes.map((n) => n.id))
      const needle = q?.toLowerCase()
      const fromInstant = from ? parseDate(from).instant : null
      const toInstant = to ? parseDate(to).instant : null
      const matched = graph.nodes
        .filter((n) => {
          if (needle && !`${n.title}\n${n.summary ?? ''}`.toLowerCase().includes(needle)) return false
          if (type && n.type !== type) return false
          if (lane !== undefined && (n.metadata?.lane ?? '') !== lane) return false
          if (fromInstant != null && n.startInstant < fromInstant) return false
          if (toInstant != null && n.startInstant > toInstant) return false
          if (hasStory !== undefined && storyDepth.has(n.id) !== hasStory) return false
          return true
        })
        .sort((a, b) => a.startInstant - b.startInstant)
      const page = matched.slice(offset ?? 0, (offset ?? 0) + (limit ?? 50))
      const edgeCounts = new Map<string, number>()
      if (full) {
        for (const e of graph.edges) {
          edgeCounts.set(e.sourceId, (edgeCounts.get(e.sourceId) ?? 0) + 1)
          edgeCounts.set(e.targetId, (edgeCounts.get(e.targetId) ?? 0) + 1)
        }
      }
      return {
        total: matched.length,
        returned: page.length,
        nodes: page.map((n) => ({
          id: n.id,
          title: n.title,
          type: n.type,
          start: formatInstant(n.startInstant, n.precision),
          ...(n.endInstant != null ? { end: formatInstant(n.endInstant, n.precision) } : {}),
          ...(n.metadata?.lane ? { lane: n.metadata.lane } : {}),
          ...(n.metadata?.location ? { location: n.metadata.location } : {}),
          ...(n.metadata?.lat != null && n.metadata?.lng != null
            ? { coords: [n.metadata.lat, n.metadata.lng] }
            : {}),
          ...(n.metadata?.geoScope ? { geoScope: n.metadata.geoScope } : {}),
          ...(storyDepth.has(n.id) ? { hasStory: true } : {}),
          ...(full
            ? {
                summary: n.summary,
                citations: n.metadata?.citations ?? [],
                images: (n.metadata?.images ?? []).map((im) => im.url),
                edgeCount: edgeCounts.get(n.id) ?? 0,
              }
            : {}),
        })),
      }
    },
  },

  {
    name: 'get_node',
    title: 'Get one node in full',
    description:
      'Everything about ONE node: all fields (summary, citations, images, lane, location), its edges with the ' +
      'other endpoint\'s title, and the stories attached to it. The context-cheap companion to query_timeline — ' +
      'query for ids, then drill in here.',
    inputSchema: { nodeId: z.string() },
    handler: async ({ nodeId }, { ownerId }) => {
      const timelineId = getMomentTimelineId(nodeId)
      const meta = timelineId ? getTimelineMeta(timelineId) : null
      if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`node "${nodeId}" not found`)
      const graph = loadGraph(timelineId)
      const node = graph.nodes.find((n) => n.id === nodeId)!
      const titles = new Map(graph.nodes.map((n) => [n.id, n.title]))
      return {
        id: node.id,
        timelineId,
        // The canonical entity this placement renders (ADR 0004). Pass it to
        // place_entity to add the SAME entity onto another timeline; editing the
        // entity (via update_node on any placement) propagates to all of them.
        entityId: node.entityId,
        type: node.type,
        subtype: node.metadata?.subtype ?? null,
        title: node.title,
        summary: node.summary,
        start: formatInstant(node.startInstant, node.precision),
        end: node.endInstant != null ? formatInstant(node.endInstant, node.precision) : null,
        precision: node.precision,
        lane: node.metadata?.lane ?? null,
        location: node.metadata?.location ?? null,
        lat: node.metadata?.lat ?? null,
        lng: node.metadata?.lng ?? null,
        geoScope: node.metadata?.geoScope ?? null,
        citations: node.metadata?.citations ?? [],
        images: node.metadata?.images ?? [],
        edges: graph.edges
          .filter((e) => e.sourceId === nodeId || e.targetId === nodeId)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            label: e.label,
            direction: e.sourceId === nodeId ? 'out' : 'in',
            other: e.sourceId === nodeId
              ? { id: e.targetId, title: titles.get(e.targetId) ?? '?' }
              : { id: e.sourceId, title: titles.get(e.sourceId) ?? '?' },
          })),
        stories: getStoriesForMoment(nodeId),
      }
    },
  },

  {
    name: 'get_layout_report',
    title: 'Review the timeline\'s layout',
    description:
      'A compact whole-graph shape review — the canvas\'s view of the build, sized for an agent to reason over ' +
      '(get_timeline is the full data dump; this is the X-ray). Returns lane health (counts, density, ' +
      'near-duplicate lane names, fragments), axis span + dead zones, graph grouping (each connected component\'s ' +
      'time span and lane spread, plus the longest edges), era coverage (nodes + stories per period), ' +
      'story coverage, globe coordinates (located / placeless / unset counts + undecided-node sample), the ' +
      'deduplicated source registry, the same advisories apply_patch computes, and a one-line-per-node index. ' +
      'Call it after a multi-patch build or reshape, then ACT on what it shows: merge drifted lanes, re-anchor ' +
      'outliers, clump scattered narrative threads into shared lanes, fill story-poor eras, balance thin sourcing, ' +
      'resolve undecided coordinates (pin or mark placeless).',
    inputSchema: { timelineId: z.string() },
    handler: async ({ timelineId }, { requireOwned }) => {
      requireOwned(timelineId)
      const meta = getTimelineMeta(timelineId)
      return await buildLayoutReport(
        timelineId,
        loadGraph(timelineId),
        meta?.viewSettings ?? null,
        // The report's theme view reflects inheritance (D5) — what the canvas renders.
        meta ? resolveTimelineTheme(meta) : null,
      )
    },
  },

  {
    name: 'apply_patch',
    title: 'Apply a batch of edits',
    description:
      'Apply a batch of graph edits as ONE atomic, undoable Patch. ops is an ordered list of add_node/update_node/delete_node/add_edge/update_edge/delete_edge. Use `ref` on add_node to reference the new node from a later add_edge in the same batch. ' +
      'The result includes `warnings` — broken image URLs, lanes too dense for the current scale, dates that stretch the axis, and connected nodes placed far apart on the axis (possible date error or missing lane grouping). The patch is COMMITTED regardless; act on warnings with a follow-up apply_patch or set_timeline_view.',
    inputSchema: { timelineId: z.string(), summary: z.string(), ops: z.array(opSchema) },
    handler: async ({ timelineId, summary, ops }, { ownerId }) => {
      // Create-if-missing owned by this user; if it exists, it must be theirs.
      const meta = getTimelineMeta(timelineId)
      if (meta && meta.ownerId !== ownerId) throw new Error(`timeline "${timelineId}" not found`)
      ensureTimeline(timelineId, ownerId)
      const builder = new PatchBuilder(timelineId, loadGraph(timelineId), ownerId)
      const { results } = applyOps(builder, ops, { ownerId })
      const patchId = commitPatch(timelineId, builder, (summary || 'MCP edit').slice(0, 200))
      // Advisory only, computed after the commit (image checks hit the network);
      // live viewers already got the SSE nudge from commitPatch.
      const graph = loadGraph(timelineId)
      const warnings = await collectPatchWarnings(graph, ops, getTimelineMeta(timelineId)?.viewSettings ?? null, results)
      return { patchId, results, warnings, graphSummary: graphSummary(graph), ...historyState(timelineId) }
    },
  },

  {
    name: 'set_timeline_view',
    title: 'Set timeline view defaults',
    description:
      'Save the timeline\'s default time-axis view, applied when a viewer opens it (a device where the user ' +
      'already adjusted the scale keeps its own). Call this once AFTER building so the first open isn\'t the ' +
      'wrong zoom. `pxPerDay` is horizontal pixels per day of the base layout, clamped to ' +
      `[${MIN_PX_PER_DAY}, ${MAX_PX_PER_DAY}] (default ${BASE_PX_PER_DAY}) — pick it so the dense era fills a few screens: ` +
      'pxPerDay ≈ 3000 / (days spanned by the bulk of the nodes). `collapseGaps` squeezes sparse stretches between ' +
      'clusters of activity into compact axis breaks — ON by default; disable it only when the axis must stay ' +
      'strictly linear. `nodeOrientation` picks the card shape for event/concept nodes: `horizontal` is the ' +
      'one-line pill (default); `vertical` wraps the title above the date, which reads far better when titles ' +
      'are long or the graph has labelled edges that need room. Omitted fields keep their current value. ' +
      'Read the current settings via get_timeline\'s `viewSettings`.',
    inputSchema: {
      timelineId: z.string(),
      pxPerDay: z.number().positive().optional().describe('Pixels per day, clamped to the allowed range.'),
      collapseGaps: z
        .boolean()
        .optional()
        .describe('Compress sparse stretches into fixed-width axis breaks (default on).'),
      nodeOrientation: z
        .enum(['horizontal', 'vertical'])
        .optional()
        .describe('Card shape for event/concept nodes: one-line pill (default) or title-over-date.'),
    },
    handler: async ({ timelineId, pxPerDay, collapseGaps, nodeOrientation }, { ownerId, requireOwned }) => {
      requireOwned(timelineId)
      const current = getTimelineMeta(timelineId)?.viewSettings ?? null
      const next = {
        pxPerDay: clampPxPerDay(pxPerDay ?? current?.pxPerDay ?? BASE_PX_PER_DAY),
        collapseGaps: collapseGaps ?? current?.collapseGaps ?? DEFAULT_COLLAPSE_GAPS,
        nodeOrientation: nodeOrientation ?? current?.nodeOrientation ?? DEFAULT_NODE_ORIENTATION,
      }
      setTimelineView(timelineId, ownerId, next)
      // Live viewers re-pull the graph (which carries viewSettings) on any event.
      emitTimelineEvent({ timelineId, kind: 'view', seq: maxAppliedSeq(timelineId) })
      return { ok: true, viewSettings: next }
    },
  },

  {
    name: 'set_timeline_theme',
    title: 'Set timeline theme',
    description:
      'Give the timeline a STYLED THEME the canvas renders for every viewer: freeform hex accent colors per ' +
      'color scheme (dark/light — the canvas adapts to the user\'s mode, so provide BOTH), an optional canvas ' +
      'background wash (canvasBg), a curated display font (default | serif | slab | mono | rounded | grotesk), ' +
      'a texture (none | dots | grid | paper), plus AI-facing metadata: `imageStyle` (a short image-generation ' +
      'style fragment, e.g. "engraved 19th-century lithograph, muted sepia") and `mood` keywords. READ the theme ' +
      'back via get_timeline and fold imageStyle/mood into every image or copy prompt you produce for this ' +
      'timeline so its art stays coherent. REPLACE semantics: the theme you pass becomes the whole theme (read ' +
      'the current one first to tweak one field); pass theme: null to clear back to the default look. A scheme ' +
      'or slot you omit falls back to the default tokens. Like set_timeline_view this is NOT part of the ' +
      'undo/redo Patch stack. Returns `warnings` for accents with poor contrast against the canvas background — ' +
      'fix them with a follow-up call.',
    inputSchema: {
      timelineId: z.string(),
      theme: timelineThemeSchema
        .nullable()
        .describe('The complete theme to store, or null to clear. Colors are hex ("#8a6d3b").'),
    },
    handler: async ({ timelineId, theme }, { ownerId, requireOwned }) => {
      requireOwned(timelineId)
      setTimelineTheme(timelineId, ownerId, theme ?? null)
      const warnings = themeContrastWarnings(theme ?? null)
      // Reuse kind 'view': live viewers refetch the graph (which carries theme).
      emitTimelineEvent({ timelineId, kind: 'view', seq: maxAppliedSeq(timelineId) })
      return { ok: true, theme: theme ?? null, warnings }
    },
  },

  {
    name: 'set_story_theme',
    title: 'Set story theme',
    description:
      'Give ONE story its OWN visual theme — independent of the timeline it lives on. Same shape and REPLACE ' +
      'semantics as set_timeline_theme (per-scheme hex accents + canvasBg, a display font, a texture, plus ' +
      'imageStyle / mood metadata; pass theme: null to clear it back to inheriting the timeline). The sharable ' +
      'reader (/s/$slug) renders the story\'s theme, falling back to the timeline\'s when this is null — so you can ' +
      'give a single story a distinct mood without re-theming the whole canvas. NOT part of the undo/redo Patch ' +
      'stack. Returns `warnings` for accents with poor contrast against the canvas background.',
    inputSchema: {
      storyId: z.string(),
      theme: timelineThemeSchema
        .nullable()
        .describe('The complete theme to store, or null to clear (inherit the timeline). Colors are hex.'),
    },
    handler: async ({ storyId, theme }, { ownerId, requireOwned }) => {
      // Resolve the story's timeline and run the SAME owner guard the timeline-scoped
      // tools use, then write through the owner-checked db helper (belt and braces).
      const timelineId = getStoryTimelineId(storyId)
      if (!timelineId) throw new Error(`story "${storyId}" not found`)
      requireOwned(timelineId)
      setStoryTheme(storyId, ownerId, theme ?? null)
      const warnings = themeContrastWarnings(theme ?? null)
      emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
      return { ok: true, theme: theme ?? null, warnings }
    },
  },

  {
    name: 'write_story',
    title: 'Write a story onto a moment',
    description:
      'Attach a narrative to a moment (a node) as an ordered list of beats (segments). Stories are SEPARATE from the graph — written directly, with their own provenance, and NOT part of the undo/redo Patch stack. A moment can hold SEVERAL stories: omit `storyId` to CREATE a new story; pass an existing `storyId` (one belonging to this moment) to UPDATE that story in place (replacing its meta + beats). Pass the node id as `momentId`. The canvas shows a badge on moments with a story and lists them beside the moment when the user opens the node, playing the beats back on demand. To turn a beat into a guided tour, set `focusNodeId` to another node id on the same timeline: as the reader reaches that beat the canvas pans + rings that entity and the detail panel beside the story switches to show it (omit it to stay on the moment). Give the story a CAST: materialize its key characters as entity nodes FIRST (apply_patch), then list them in `cast` — name-only cast entries come back as warnings so you can add their nodes. Give it ART: `coverImage` for the reader\'s cover, and an `image` on beats where a real artwork exists (sensory beats especially). Give beats LIVE WIDGETS: set a beat\'s `widget` to a mini `timeline` strip, an orthographic `globe`, or an `entity` card (referencing node ids) — rendered as the panel\'s hero visual in the sharable reader and kept live as the graph changes, so a shared story tracking a competitor updates the moment its nodes do. Ground each beat in real sources: pass `citations` (title + optional url + verbatim quote) on every beat that makes a factual claim — stories without sources are just plausible fiction. The result includes `warnings` (dangling node ids, node-less cast names, broken image URLs); the story is SAVED regardless — fix with a follow-up write_story carrying the same storyId.',
    inputSchema: {
      momentId: z.string(),
      // Omit to create a new story; pass an existing story id (on this moment) to
      // update it in place.
      storyId: z.string().optional(),
      title: z.string(),
      hook: z.string().optional(),
      povType: z.enum(POV_TYPES).optional(),
      depthTier: z.enum(DEPTH_TIERS).optional(),
      estimatedMinutes: z.number().int().positive().optional(),
      coverImage: storyImageInput
        .optional()
        .describe('Cover art shown on the reader\'s opening panel (layout ignored).'),
      cast: z
        .array(
          z.object({
            nodeId: z.string().optional().describe('The cast member\'s node on this timeline (preferred).'),
            name: z.string().optional().describe('Name only — flags a character who has no node yet.'),
            role: z.string().optional().describe('Their role in this story ("the prefect", "the witness").'),
          }),
        )
        .optional()
        .describe(
          'The story\'s characters. Node-backed members are clickable and tourable; name-only members produce a ' +
            'warning so you can materialize them with apply_patch and update the story.',
        ),
      theme: timelineThemeSchema
        .nullable()
        .optional()
        .describe(
          'Optional: the story\'s OWN visual theme (same shape as set_timeline_theme — per-scheme hex accents, ' +
            'canvasBg, font, texture, imageStyle, mood). Independent of the timeline\'s; the sharable reader renders ' +
            'it, falling back to the timeline\'s theme when omitted. Use it to give a story a distinct mood (a noir ' +
            'case, a golden-age epic). Omit/null to inherit the timeline.',
        ),
      // Make this story a CHAPTER of a series (ADR 0006): `appendToSeries` is the
      // shorthand — pass a series id and the chapter number is auto-assigned (next in
      // sequence). Or pass `seriesId` with an explicit `chapterNumber`. Omit all to
      // write a standalone story (today's default). On UPDATE, omitting them preserves
      // the chapter's existing series membership.
      seriesId: z.string().optional().describe('Attach this story to a series (explicit form — pair with chapterNumber).'),
      appendToSeries: z
        .string()
        .optional()
        .describe('Series id to append this story to as the NEXT chapter (auto-numbered). The usual way to write the next chapter.'),
      chapterNumber: z.number().int().positive().optional().describe('Explicit 1-based chapter position within the series.'),
      status: z
        .enum(['draft', 'published'])
        .optional()
        .describe(
          'Birth status for a NEW chapter (default `published`). Pass `draft` to write a chapter that stays owner-only until you publish it (via patch_story update_meta status). A series with reviewMode ON forces `draft` regardless of this — so an automated feed can append safely into a public series.',
        ),
      segments: z.array(storyBeatInput).min(1),
    },
    handler: async (
      { momentId, storyId, title, hook, povType, depthTier, estimatedMinutes, coverImage, cast, theme, seriesId, appendToSeries, chapterNumber, status, segments },
      { ownerId },
    ) => {
      // write_story keys off a node id; resolve its timeline and run the same
      // owner check the timeline-scoped tools use.
      const timelineId = getMomentTimelineId(momentId)
      const meta = timelineId ? getTimelineMeta(timelineId) : null
      if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`moment "${momentId}" not found`)

      // The story saves regardless; warnings tell the client what to fix next —
      // mirrors apply_patch's contract.
      const warnings: string[] = []
      const graph = loadGraph(timelineId)
      const nodeIds = new Set(graph.nodes.map((n) => n.id))
      segments.forEach((s: any, i: number) => {
        if (s.focusNodeId && !nodeIds.has(s.focusNodeId)) {
          warnings.push(
            `beat ${i + 1}: focusNodeId "${s.focusNodeId}" is not a node on this timeline — the tour will fall back to the moment`,
          )
        }
        for (const id of s.relatedNodeIds ?? []) {
          if (!nodeIds.has(id)) warnings.push(`beat ${i + 1}: relatedNodeId "${id}" is not a node on this timeline`)
        }
        if (s.widget) {
          const missing = [...(s.widget.nodeIds ?? []), ...(s.widget.focusNodeId ? [s.widget.focusNodeId] : [])].filter(
            (id: string) => !nodeIds.has(id),
          )
          if (missing.length) {
            warnings.push(
              `beat ${i + 1}: widget references node ids not on this timeline (${[...new Set(missing)].join(', ')}) — they won't render`,
            )
          }
        }
      })
      const nodeless: string[] = []
      for (const member of cast ?? []) {
        if (member.nodeId && !nodeIds.has(member.nodeId)) {
          warnings.push(`cast member "${member.name ?? member.nodeId}": nodeId is not a node on this timeline`)
        } else if (!member.nodeId && member.name) {
          nodeless.push(member.name)
        }
      }
      if (nodeless.length) {
        warnings.push(
          `cast members without nodes: ${nodeless.join(', ')} — add them as entity nodes via apply_patch so ` +
            'readers can click and tour them, then update this story (same storyId) with their nodeIds',
        )
      }
      const imageUrls = [
        ...(coverImage ? [coverImage.url] : []),
        ...segments.flatMap((s: any) => (s.image ? [s.image.url] : [])),
      ]
      if (imageUrls.length) warnings.push(...(await imageUrlWarnings(imageUrls, 'story image URL')))
      // A story theme is held to the same WCAG-contrast bar as a timeline theme.
      if (theme) warnings.push(...themeContrastWarnings(theme))

      // Split each beat's citations into inline one-offs vs artifact-backed refs
      // (single-home, ADR 0001 Dec. 8). Validate artifactIds up front so an unknown
      // one is dropped to a warning, not an FK error mid-write.
      const referenced = segments.flatMap((s: any) =>
        (s.citations ?? []).flatMap((c: any) => ('artifactId' in c ? [c.artifactId] : [])),
      )
      const known = existingArtifactIds(referenced, ownerId)
      const prepared = segments.map((s: any, i: number) => {
        const inline: { title: string; url?: string; quote?: string; sourceType?: (typeof CITATION_SOURCE_TYPES)[number] }[] = []
        const artifactCitations: { artifactId: string; excerptUsed?: string | null }[] = []
        for (const c of s.citations ?? []) {
          if ('artifactId' in c) {
            if (known.has(c.artifactId)) artifactCitations.push({ artifactId: c.artifactId, excerptUsed: c.excerptUsed ?? null })
            else
              warnings.push(
                `beat ${i + 1}: artifactId "${c.artifactId}" is not a registered artifact — citation dropped (register it first with register_artifact)`,
              )
          } else {
            inline.push(c)
          }
        }
        return { ...s, citations: inline, artifactCitations }
      })

      // Resolve series membership (ADR 0006). appendToSeries → auto next chapter;
      // seriesId → explicit (chapterNumber as given). Owner-check the series; it must
      // belong to the same owner (and, by construction, lives under one of their
      // projects). Left undefined → writeStory preserves an existing chapter's link.
      const seriesTarget = appendToSeries ?? seriesId
      let chapterNum: number | undefined = chapterNumber
      if (seriesTarget) {
        makeRequireOwnedSeries(ownerId)(seriesTarget)
        if (chapterNum == null && appendToSeries) chapterNum = nextChapterNumber(seriesTarget)
      }

      const result = writeStory(
        momentId,
        {
          title,
          hook,
          povType,
          depthTier,
          estimatedMinutes,
          coverImage,
          cast,
          theme,
          ...(status !== undefined ? { status } : {}),
          ...(seriesTarget !== undefined ? { seriesId: seriesTarget } : {}),
          ...(chapterNum !== undefined ? { chapterNumber: chapterNum } : {}),
        },
        prepared,
        { storyId },
      )
      // Nudge live viewers to refetch so the depth badge appears in near-real-time
      // (same SSE channel as patches; seq = current max so it never rewinds Last-Event-ID).
      emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
      // A NEW chapter born `published` in a series → email its followers (local-160).
      // Fire-and-forget: never blocks or fails the write; the helper re-checks the
      // season is public. A chapter born `draft` (reviewMode) notifies later, on publish.
      const { created, status: bornStatus, ...storyResult } = result
      if (created && bornStatus === 'published' && seriesTarget) void notifyNewChapter(storyResult.storyId)
      return {
        ...storyResult,
        ...(seriesTarget ? { seriesId: seriesTarget, chapterNumber: chapterNum ?? null } : {}),
        warnings,
      }
    },
  },

  {
    name: 'patch_story',
    title: 'Edit a story surgically',
    description:
      'Apply a BATCH of edits to ONE existing story (chapter) without rewriting it — the surgical companion to write_story (which REPLACES a whole story). One call = one atomic transaction of `ops`: `add_segment` (insert a beat, optionally `at` an index — default append), `update_segment` (patch named fields of a beat by `segmentId` — only the fields you pass change), `delete_segment` (remove a beat by `segmentId`), `reorder_segments` (set the full beat order by id), and `update_meta` (change title/hook/cast/coverImage/theme/status/isPublic). Beat ids come from get_timeline / the story DTO. Use this to fix a typo, add a beat, or reorder — instead of resending every beat. Returns `warnings` (dangling node ids, broken image URLs, bad theme contrast) + the new `segmentCount`; the edit is SAVED regardless. NOT on the undo/redo stack.',
    inputSchema: {
      storyId: z.string(),
      ops: z
        .array(
          z.union([
            z.object({
              op: z.literal('add_segment'),
              segment: storyBeatInput,
              at: z.number().int().nonnegative().optional().describe('Insert position (0-based); omit to append.'),
            }),
            z.object({
              op: z.literal('update_segment'),
              segmentId: z.string(),
              segment: storyBeatInput.partial().describe('Only the beat fields you pass are changed.'),
            }),
            z.object({ op: z.literal('delete_segment'), segmentId: z.string() }),
            z.object({
              op: z.literal('reorder_segments'),
              order: z.array(z.string()).describe('The full list of this story\'s beat ids in the desired order.'),
            }),
            z.object({
              op: z.literal('update_meta'),
              meta: z
                .object({
                  title: z.string().optional(),
                  hook: z.string().nullable().optional(),
                  coverImage: storyImageInput.nullable().optional(),
                  theme: timelineThemeSchema.nullable().optional(),
                  isPublic: z.boolean().optional(),
                  status: z
                    .enum(['draft', 'published', 'archived'])
                    .optional()
                    .describe(
                      'Publish state of this chapter. `published` puts it on the public season shelf (/sr/$slug); `draft` pulls it back to owner-only; `archived` withdraws it. This is how you APPROVE a chapter written under reviewMode.',
                    ),
                })
                .describe('Story-level fields to change (only the ones you pass).'),
            }),
          ]),
        )
        .min(1),
    },
    handler: async ({ storyId, ops }, { ownerId }) => {
      // Resolve the story's timeline + run the same owner check the story tools use.
      const timelineId = getStoryTimelineId(storyId)
      const meta = timelineId ? getTimelineMeta(timelineId) : null
      if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`story "${storyId}" not found`)

      const warnings: string[] = []
      const graph = loadGraph(timelineId)
      const nodeIds = new Set(graph.nodes.map((n) => n.id))
      // Collect the beats this batch adds/updates so we validate + citation-split them.
      const beatOps = ops.filter((o: any) => o.op === 'add_segment' || o.op === 'update_segment') as any[]
      const referenced = beatOps.flatMap((o) => (o.segment.citations ?? []).flatMap((c: any) => ('artifactId' in c ? [c.artifactId] : [])))
      const known = existingArtifactIds(referenced, ownerId)
      const imageUrls: string[] = []
      const prepared: StoryOp[] = ops.map((o: any, i: number) => {
        if (o.op === 'update_meta') {
          if (o.meta.coverImage?.url) imageUrls.push(o.meta.coverImage.url)
          if (o.meta.theme) warnings.push(...themeContrastWarnings(o.meta.theme))
          return { op: 'update_meta', meta: o.meta }
        }
        if (o.op === 'delete_segment') return { op: 'delete_segment', segmentId: o.segmentId }
        if (o.op === 'reorder_segments') return { op: 'reorder_segments', order: o.order }
        // add_segment / update_segment: validate node refs, split citations, collect images.
        const s = o.segment
        if (s.focusNodeId && !nodeIds.has(s.focusNodeId)) warnings.push(`op ${i + 1}: focusNodeId "${s.focusNodeId}" is not a node on this timeline`)
        for (const id of s.relatedNodeIds ?? []) if (!nodeIds.has(id)) warnings.push(`op ${i + 1}: relatedNodeId "${id}" is not a node on this timeline`)
        if (s.widget) {
          const missing = [...(s.widget.nodeIds ?? []), ...(s.widget.focusNodeId ? [s.widget.focusNodeId] : [])].filter((id: string) => !nodeIds.has(id))
          if (missing.length) warnings.push(`op ${i + 1}: widget references node ids not on this timeline (${[...new Set(missing)].join(', ')})`)
        }
        if (s.image?.url) imageUrls.push(s.image.url)
        const inline: any[] = []
        const artifactCitations: { artifactId: string; excerptUsed?: string | null }[] = []
        if (s.citations !== undefined) {
          for (const c of s.citations ?? []) {
            if ('artifactId' in c) {
              if (known.has(c.artifactId)) artifactCitations.push({ artifactId: c.artifactId, excerptUsed: c.excerptUsed ?? null })
              else warnings.push(`op ${i + 1}: artifactId "${c.artifactId}" is not a registered artifact — citation dropped`)
            } else inline.push(c)
          }
        }
        const segment = {
          ...s,
          ...(s.citations !== undefined ? { citations: inline, artifactCitations } : {}),
        }
        return o.op === 'add_segment' ? { op: 'add_segment', segment, at: o.at } : { op: 'update_segment', segmentId: o.segmentId, segment }
      })
      if (imageUrls.length) warnings.push(...(await imageUrlWarnings(imageUrls, 'story image URL')))

      const result = patchStory(storyId, prepared, ownerId)
      if (!result) throw new Error(`story "${storyId}" not found`)
      emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
      // A draft chapter approved to `published` this batch → email followers (local-160).
      const { publishedChapter, ...storyResult } = result
      if (publishedChapter) void notifyNewChapter(storyResult.storyId)
      return { ...storyResult, warnings }
    },
  },

  {
    name: 'create_series',
    title: 'Create a series',
    description:
      'Create a SERIES — an ordered sequence of chapters (each chapter is a story) inside a project (ADR 0006). A series is the narrative spine: write its chapters with write_story (`appendToSeries: <this id>`), read its order + coverage with get_series, and publish the whole season at /sr/$slug with set_series_public. Returns the new `seriesId`, `slug`, and public `url`.',
    inputSchema: {
      projectId: z.string(),
      title: z.string(),
      hook: z.string().optional().describe('One-line logline for the series.'),
      coverImage: storyImageInput.optional().describe('The season cover (layout ignored).'),
      theme: timelineThemeSchema.optional().describe('The series\' own visual theme (same shape as set_timeline_theme).'),
      brandId: z.string().optional().describe('A brand to dress the whole series in (list_brands). Sets the reference (drives chapter voice) and SEEDS the series theme from the kit unless an explicit `theme` is given.'),
      anchorMomentId: z.string().optional().describe('Optional "home" node for the series on the canvas.'),
      reviewMode: z
        .boolean()
        .optional()
        .describe(
          'Start the series in REVIEW MODE (default false): every chapter written into it is born a `draft` (owner-only) until you publish it, even in a PUBLIC season. Turn this ON for an AUTOMATED / scheduled writer so appended chapters never go live unreviewed. Toggle later with set_series_review_mode.',
        ),
    },
    handler: async ({ projectId, title, hook, coverImage, theme, brandId, anchorMomentId, reviewMode }, { ownerId, requireOwnedProject }) => {
      ;(requireOwnedProject ?? makeRequireOwnedProject(ownerId))(projectId)
      if (brandId) makeRequireOwnedBrand(ownerId)(brandId)
      const seedTheme = theme ?? (brandId ? deriveThemeFromBrand(getBrand(brandId, ownerId)?.kit ?? null) ?? undefined : undefined)
      const warnings: string[] = []
      if (coverImage?.url) warnings.push(...(await imageUrlWarnings([coverImage.url], 'series cover URL')))
      if (seedTheme) warnings.push(...themeContrastWarnings(seedTheme))
      const s = createSeries(projectId, ownerId, { title, hook, coverImage, theme: seedTheme, anchorMomentId, reviewMode })
      if (brandId) updateSeries(s.id, ownerId, { brandId })
      return { seriesId: s.id, slug: s.slug, title: s.title, url: seriesUrl(s), reviewMode: s.reviewMode, ...(warnings.length ? { warnings } : {}) }
    },
  },

  {
    name: 'list_brands',
    title: 'List brand kits',
    description:
      'List the owner\'s brand kits — reusable identity+voice+palette kits that dress stories and series. Returns each brand\'s id, slug, name, and whether it has a kit. Reference a returned id from set_story_brand / set_series_brand / create_series(brandId) to apply it. Brands are owner-scoped; this never leaks another user\'s.',
    inputSchema: {},
    handler: async (_args, { ownerId }) => {
      return {
        brands: listBrands(ownerId).map((b) => ({ id: b.id, slug: b.slug, name: b.name, hasKit: !!b.kit })),
      }
    },
  },

  {
    name: 'set_story_brand',
    title: 'Dress a story in a brand',
    description:
      'Reference a brand on ONE story (from list_brands). Sets the brand link (drives the AI voice) and SEEDS the story\'s visual theme from the kit\'s palette/fonts (one-shot — tweak with set_story_theme after). Pass brandId: null to clear the link (the theme is left as-is). Owner-scoped.',
    inputSchema: {
      storyId: z.string(),
      brandId: z.string().nullable().describe('A brand id from list_brands, or null to unlink.'),
    },
    handler: async ({ storyId, brandId }, { ownerId, requireOwned }) => {
      const timelineId = getStoryTimelineId(storyId)
      if (!timelineId) throw new Error(`story "${storyId}" not found`)
      requireOwned(timelineId)
      if (brandId !== null) makeRequireOwnedBrand(ownerId)(brandId)
      setStoryBrand(storyId, ownerId, brandId)
      const kit = brandId ? getBrand(brandId, ownerId)?.kit ?? null : null
      const derived = deriveThemeFromBrand(kit)
      if (derived) setStoryTheme(storyId, ownerId, derived)
      emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
      return { ok: true, brandId, theme: derived ?? null }
    },
  },

  {
    name: 'set_series_brand',
    title: 'Dress a series in a brand',
    description:
      'Reference a brand on a whole SERIES (from list_brands). Sets the brand link (drives every chapter\'s voice) and SEEDS the series theme from the kit. Pass brandId: null to clear. Owner-scoped.',
    inputSchema: {
      seriesId: z.string(),
      brandId: z.string().nullable().describe('A brand id from list_brands, or null to unlink.'),
    },
    handler: async ({ seriesId, brandId }, { ownerId }) => {
      makeRequireOwnedSeries(ownerId)(seriesId)
      if (brandId !== null) makeRequireOwnedBrand(ownerId)(brandId)
      const kit = brandId ? getBrand(brandId, ownerId)?.kit ?? null : null
      const derived = deriveThemeFromBrand(kit)
      updateSeries(seriesId, ownerId, { brandId, ...(derived ? { theme: derived } : {}) })
      return { ok: true, brandId, theme: derived ?? null }
    },
  },

  {
    name: 'get_series',
    title: 'Get a series + its coverage',
    description:
      'Read a series in order — the anti-duplication watermark for writing the next chapter (ADR 0006). Returns the series meta, its chapters ordered by chapterNumber (id, title, hook, status, isPublic, momentId, and the node ids each chapter already references), and a DERIVED `frontier` (the highest chapterNumber and the latest instant any covered node sits at). Read this BEFORE writing the next chapter so you enrich/advance instead of repeating. Pair it with get_layout_report (the graph-side watermark).',
    inputSchema: { seriesId: z.string() },
    handler: async ({ seriesId }, { ownerId }) => {
      makeRequireOwnedSeries(ownerId)(seriesId)
      const series = getSeries(seriesId)!
      const { chapters, frontier } = seriesWatermark(seriesId)
      return {
        series: {
          id: series.id,
          slug: series.slug,
          title: series.title,
          hook: series.hook,
          status: series.status,
          isPublic: series.isPublic,
          reviewMode: series.reviewMode,
          theme: series.theme ?? null,
          url: seriesUrl(series),
        },
        chapters: chapters.map((c) => ({
          storyId: c.storyId,
          chapterNumber: c.chapterNumber,
          title: c.title,
          hook: c.hook,
          status: c.status,
          isPublic: c.isPublic,
          momentId: c.momentId,
          coveredNodeIds: c.coveredNodeIds,
        })),
        frontier,
      }
    },
  },

  {
    name: 'set_series_public',
    title: 'Publish or unpublish a series',
    description:
      'Flip a series\' public visibility (ADR 0006 D10). When public, its season page is live at /sr/$slug and its chapters play in order — but ONLY chapters with status `published` show (a `draft`/`archived` chapter stays owner-only; local-175). Turning a season public never publishes a draft chapter. A chapter\'s own isPublic (the standalone /s/$slug page) is a separate axis. For an AUTOMATED writer, pair this with reviewMode (create_series / set_series_review_mode) so appended chapters land as drafts you approve. Returns the public `url` on success.',
    inputSchema: { seriesId: z.string(), isPublic: z.boolean() },
    handler: async ({ seriesId, isPublic }, { ownerId }) => {
      const res = setSeriesShared(seriesId, ownerId, isPublic)
      if (!res) throw new Error(`series "${seriesId}" not found`)
      return { ok: true, isPublic, url: `${BASE_URL}/sr/${res.slug}` }
    },
  },

  {
    name: 'set_series_review_mode',
    title: 'Turn series review mode on or off',
    description:
      'Toggle REVIEW MODE for a series (local-175). When ON, every chapter written into this series (write_story appendToSeries / seriesId) is born a `draft` — owner-only, hidden from the public /sr/$slug season — REGARDLESS of what the writer passes, until you publish it with patch_story (update_meta status: "published"). This makes a PUBLIC season safe for an AUTOMATED / scheduled writer: it can keep appending chapters and nothing goes live unreviewed. OFF (default) = chapters are born `published` (today\'s behavior). Existing chapters are unaffected — this only governs newly written ones.',
    inputSchema: { seriesId: z.string(), reviewMode: z.boolean() },
    handler: async ({ seriesId, reviewMode }, { ownerId }) => {
      const ok = setSeriesReviewMode(seriesId, ownerId, reviewMode)
      if (!ok) throw new Error(`series "${seriesId}" not found`)
      return { ok: true, reviewMode }
    },
  },

  {
    name: 'register_artifact',
    title: 'Register a reusable artifact',
    description:
      'Register a primary-source ARTIFACT (a letter, diary entry, photo, inscription, record, object, document) as REUSABLE reference data — cite it from many story beats and recall it in a later session with search_artifacts. Optionally attach the SOURCE it came from (a book/archive/collection) and link it to a moment (node) so it can sit on the canvas. Artifacts are NOT part of the graph or the undo/redo Patch stack. Returns the new `artifactId` — pass it as a beat citation `{ artifactId, excerptUsed }` in write_story. Set `reliability` (primary = contemporaneous/eyewitness, secondary, tertiary) and `date` (when the artifact was MADE) where known. Image/source URLs are sourced, never invented.',
    inputSchema: {
      title: z.string().describe('e.g. "Tablet 291: Claudia Severa\'s birthday invitation".'),
      artifactType: z.enum(ARTIFACT_TYPES),
      transcript: z.string().optional().describe('The actual text content (full-text searchable).'),
      translation: z.string().optional().describe('Translation, if from another language (searchable).'),
      date: z
        .string()
        .optional()
        .describe('When the artifact was MADE — "AD 100", "49 BCE", "Q3 2008" (parsed to an instant + precision).'),
      reliability: z.enum(RELIABILITY).optional().describe('Provenance distance: primary | secondary | tertiary.'),
      reliabilityNote: z.string().optional().describe('Free-text nuance ("eyewitness, written 3 days later").'),
      sourceType: z
        .enum(CITATION_SOURCE_TYPES)
        .optional()
        .describe('Genre: primary | scholarship | data | press (orthogonal to reliability).'),
      imageUrl: z.string().optional().describe('A real, web-accessible image of the artifact — never invented.'),
      momentId: z.string().optional().describe('Link the artifact to this moment (node) so it can sit on the canvas.'),
      momentNote: z.string().optional().describe('Why this artifact belongs at this moment.'),
      source: z
        .object({
          title: z.string(),
          author: z.string().optional(),
          year: z.number().int().optional(),
          url: z.string().optional(),
          sourceType: z.enum(SOURCE_TYPES).optional(),
          citation: z.string().optional().describe('A formatted bibliographic string.'),
        })
        .optional()
        .describe('The bibliographic source this artifact came from.'),
    },
    handler: async (
      { title, artifactType, transcript, translation, date, reliability, reliabilityNote, sourceType, imageUrl, momentId, momentNote, source },
      { ownerId },
    ) => {
      // If linking to a moment, resolve its timeline and run the owner check.
      if (momentId) {
        const timelineId = getMomentTimelineId(momentId)
        const meta = timelineId ? getTimelineMeta(timelineId) : null
        if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`moment "${momentId}" not found`)
      }
      const warnings: string[] = []
      if (imageUrl) warnings.push(...(await imageUrlWarnings([imageUrl], 'artifact image URL')))
      const parsed = date ? parseDate(date) : null
      const { artifactId, sourceId } = registerArtifact({
        ownerId,
        artifact: {
          title,
          artifactType,
          transcript,
          translation,
          dateInstant: parsed?.instant ?? null,
          datePrecision: parsed?.precision ?? 'year',
          reliability,
          reliabilityNote,
          sourceType,
          imageUrl,
        },
        source,
        momentId,
        momentNote,
      })
      return { artifactId, sourceId, warnings }
    },
  },

  {
    name: 'search_artifacts',
    title: 'Search the artifact corpus',
    description:
      'Recall registered artifacts by keyword — lexical full-text search over title + transcript + translation. Use it to pull a prior artifact back into a NEW build and re-ground new work, or to find an artifact to cite. Returns compact ranked rows (id, title, a highlighted `snippet`, type, reliability, source); pass a row\'s `id` as a write_story beat citation `{ artifactId }`. Optionally scope to a timeline (artifacts linked to its moments) and filter by type / reliability. `score` is opaque — higher is better; do not interpret it.',
    inputSchema: {
      query: z.string().describe('Free text — keywords or phrases. Punctuation/operators are ignored.'),
      timelineId: z.string().optional().describe('Scope to artifacts linked to this timeline\'s moments.'),
      types: z.array(z.enum(ARTIFACT_TYPES)).optional(),
      reliability: z.array(z.enum(RELIABILITY)).optional(),
      limit: z.number().int().positive().max(50).optional().describe('Max rows (default 10, max 50).'),
    },
    handler: async ({ query, timelineId, types, reliability, limit }, { ownerId, requireOwned }) => {
      if (timelineId) requireOwned(timelineId)
      return { results: searchArtifacts({ query, ownerId, timelineId, types, reliability, limit }) }
    },
  },

  {
    name: 'undo',
    title: 'Undo',
    description: 'Undo the most recent Patch on a timeline.',
    inputSchema: { timelineId: z.string() },
    handler: async ({ timelineId }, { requireOwned }) => {
      requireOwned(timelineId)
      return { undone: undo(timelineId), ...historyState(timelineId) }
    },
  },

  {
    name: 'redo',
    title: 'Redo',
    description: 'Redo the most recently undone Patch on a timeline.',
    inputSchema: { timelineId: z.string() },
    handler: async ({ timelineId }, { requireOwned }) => {
      requireOwned(timelineId)
      return { redone: redo(timelineId), ...historyState(timelineId) }
    },
  },

  {
    name: 'undo_story',
    title: 'Undo a story edit',
    description:
      'Undo the most recent patch_story edit to a story (ADR 0006). Stories have their OWN undo stack, SEPARATE from the timeline\'s graph ⌘Z (undo/redo) — a story edit never touches the graph history and vice-versa. Restores the story to its state before the last patch_story batch. No-op if the story has no edit history.',
    inputSchema: { storyId: z.string() },
    handler: async ({ storyId }, { ownerId }) => {
      const res = undoStory(storyId, ownerId)
      if (!res.timelineId) throw new Error(`story "${storyId}" not found`)
      if (res.ok) emitTimelineEvent({ timelineId: res.timelineId, kind: 'story', seq: maxAppliedSeq(res.timelineId) })
      return { undone: res.ok, ...storyHistoryState(storyId) }
    },
  },

  {
    name: 'redo_story',
    title: 'Redo a story edit',
    description: 'Redo the most recently undone patch_story edit (the story\'s own stack, separate from the graph). No-op if nothing was undone.',
    inputSchema: { storyId: z.string() },
    handler: async ({ storyId }, { ownerId }) => {
      const res = redoStory(storyId, ownerId)
      if (!res.timelineId) throw new Error(`story "${storyId}" not found`)
      if (res.ok) emitTimelineEvent({ timelineId: res.timelineId, kind: 'story', seq: maxAppliedSeq(res.timelineId) })
      return { redone: res.ok, ...storyHistoryState(storyId) }
    },
  },
]
