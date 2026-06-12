import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ensureTimeline,
  createTimeline,
  listTimelines,
  loadGraph,
  getTimelineTitle,
  getTimelineMeta,
  setTimelineView,
} from '~/lib/db/graph'
import { BASE_PX_PER_DAY, MIN_PX_PER_DAY, MAX_PX_PER_DAY, clampPxPerDay } from '~/lib/domain/types'
import { PatchBuilder, commitPatch, undo, redo, historyState, maxAppliedSeq } from '~/lib/db/patches'
import { writeStory, getMomentTimelineId, getStoriesForMoment, storyDepthByMoment } from '~/lib/db/stories'
import { emitTimelineEvent } from '~/lib/server/bus'
import { POV_TYPES, DEPTH_TIERS, SEGMENT_KINDS, IMAGE_ASPECTS, STORY_IMAGE_LAYOUTS, NODE_TYPES } from '~/lib/domain/types'
import { parseDate, formatInstant } from '~/lib/domain/dates'
import { BASE_URL } from '~/lib/auth'
import { opSchema, applyOps } from './ops'
import { collectPatchWarnings, imageUrlWarnings } from './warnings'
import { buildLayoutReport } from './layout-report'
import { captureServer } from '~/lib/posthog/server'
import type { Graph } from '~/lib/db/graph'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

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

// Per-tool analytics enrichment — cheap props derived mostly from the input args
// (parse-free). For apply_patch we also read the already-computed graphSummary +
// warnings out of the result text once, inside a try/catch so an analytics parse
// error can never fail the tool call.
function enrich(name: string, args: any, result: any): Record<string, unknown> {
  if (name === 'apply_patch') {
    const ops: any[] = Array.isArray(args?.ops) ? args.ops : []
    const counts: Record<string, number> = {}
    for (const op of ops) {
      if (typeof op?.op === 'string') counts[`ops_${op.op}`] = (counts[`ops_${op.op}`] ?? 0) + 1
    }
    const extra: Record<string, unknown> = { ops_total: ops.length, ...counts }
    try {
      const payload = JSON.parse(result?.content?.[0]?.text ?? '{}')
      if (payload.graphSummary) {
        extra.nodes_total = payload.graphSummary.nodes
        extra.edges_total = payload.graphSummary.edges
      }
      if (Array.isArray(payload.warnings)) extra.warnings = payload.warnings.length
    } catch {
      /* result shape changed — skip enrichment, never fail the tool */
    }
    return extra
  }
  if (name === 'write_story') {
    return {
      segments: Array.isArray(args?.segments) ? args.segments.length : 0,
      cast: Array.isArray(args?.cast) ? args.cast.length : 0,
    }
  }
  return {}
}

// One MCP server per request/connection, scoped to the OWNER behind the API key:
// every tool only sees and mutates that user's timelines. Reads are exposed as
// tools (so agentic clients can fetch mid-loop) AND mirrored as a read-only
// resource. ALL writes go through apply_patch.
export function buildMcpServer(ownerId: string): McpServer {
  const server = new McpServer(
    { name: 'synek', version: '0.1.0' },
    {
      instructions:
        'Synek is the user\'s spatial memory — where their research lives, visually, on a timeline. ' +
        'After create_timeline, SHARE the returned `url` with the user so they can open the canvas and watch it build. ' +
        'The canvas updates LIVE as you apply patches — never tell the user to refresh. ' +
        'READ cheaply: get_timeline returns the FULL graph (every summary + citation) and gets very large — for mid-build reads prefer query_timeline (filtered, compact rows), get_node (one node + its edges + stories), and get_layout_report (a whole-graph shape review). ' +
        'MUTATE the graph ONLY via apply_patch — one call = one undoable Patch holding a batch of ops. ' +
        'Within a batch, set `ref` on an add_node and reuse that alias as an edge endpoint to wire edges to nodes created in the same call. ' +
        'Give nodes a FACE, not a bare box: when you know a real, web-accessible image for a node (a Wikimedia portrait for a person, an official logo for an org, public-domain art for an era/event), pass it in the add_node/update_node `images` field as a URL. Set each image\'s `aspect` to "portrait" for tall subjects (a standing person, a headshot) or "landscape" for wide ones (scenes, logos) so it is framed correctly. Synek stores and renders it; it does not generate images. ' +
        'Give nodes a PLACE too: set `location` ("Golgotha, Jerusalem") where it adds texture. ' +
        'CITE with links: every citation takes a `url` — add a stable public link wherever one exists (and never invent one); title-only is fine for print sources. apply_patch verifies the links you pass and warns on dead ones. ' +
        'undo / redo step the per-timeline history. ' +
        'After building (or reshaping) a timeline, call set_timeline_view to pick the default zoom (pxPerDay) and gap collapsing so the canvas opens readable — heed the density warnings apply_patch returns. ' +
        'After a multi-patch build, call get_layout_report and ACT on it — merge near-duplicate lanes, re-lane drifted nodes, fill story-poor eras, fix dead axis zones — before declaring the timeline done. ' +
        'To attach a NARRATIVE to a moment (node), call write_story with that node\'s id (momentId) and an ordered list of beats — stories are separate from the graph, written directly, and are NOT part of the undo/redo Patch stack. A moment can hold SEVERAL stories: omit `storyId` to create a new one, or pass an existing story\'s id to update it in place. Set a beat\'s `focusNodeId` to another node id to make the canvas pan to that entity and the panel beside the story switch to it as the reader reaches that beat (a guided tour); omit it to stay on the moment. ' +
        'Give stories a CAST: make sure the story\'s key characters exist as entity nodes FIRST (apply_patch), then pass them in `cast` and tour them with focusNodeId — write_story warns about cast names that have no node yet. ' +
        'Give stories ART: a story takes a `coverImage` and each beat an `image` ({url, aspect, layout: full | inset-left | inset-right | bleed}) — a sensory beat with a period artwork reads like a scene. Same sourcing rules as node images: real URLs only. ' +
        'You only see and edit your own timelines.',
    },
  )

  // Guard a timeline id: it must exist and belong to this owner, else a tool error.
  const requireOwned = (timelineId: string) => {
    const meta = getTimelineMeta(timelineId)
    if (!meta || meta.ownerId !== ownerId) {
      throw new Error(`timeline "${timelineId}" not found`)
    }
  }

  // One analytics event per tool call, threaded through a single wrapper so it
  // covers ALL tools across BOTH transports (HTTP + stdio both build via this
  // factory). distinct_id = ownerId, the same Better Auth id the browser client
  // uses, so client + server events land on one PostHog person. No-ops without a
  // server key. `cb` is `any` to sidestep the SDK's generic ToolCallback overloads
  // — the config/handler still type-check at each call site.
  const register: typeof server.registerTool = (name, config, cb: any) =>
    server.registerTool(name, config, (async (args: any, extra: any) => {
      const t0 = performance.now()
      try {
        const result = await cb(args, extra)
        captureServer(ownerId, 'mcp_tool_called', {
          tool: name,
          ok: true,
          duration_ms: Math.round(performance.now() - t0),
          ...(args?.timelineId ? { timeline_id: args.timelineId } : {}),
          ...enrich(name, args, result),
        })
        return result
      } catch (err) {
        captureServer(ownerId, 'mcp_tool_called', {
          tool: name,
          ok: false,
          duration_ms: Math.round(performance.now() - t0),
          ...(args?.timelineId ? { timeline_id: args.timelineId } : {}),
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }) as any)

  register(
    'list_timelines',
    { title: 'List timelines', description: 'List your timelines (id + title), newest first.', inputSchema: {} },
    async () => json(listTimelines(ownerId).map((t) => ({ id: t.id, title: t.title }))),
  )

  register(
    'create_timeline',
    {
      title: 'Create timeline',
      description: 'Create a new empty timeline. Returns its id, title, and viewer url — share the url with the user.',
      inputSchema: { title: z.string() },
    },
    async ({ title }) => {
      const t = createTimeline(title, ownerId)
      return json({ id: t.id, title: t.title, url: viewerUrl(t.id) })
    },
  )

  register(
    'get_timeline',
    {
      title: 'Get timeline graph',
      description:
        'Return a timeline\'s full graph: { title, viewSettings, nodes, edges }. Use node ids for update/delete/edge ops. ' +
        '`viewSettings` is the saved default time-axis scale ({ pxPerDay, collapseGaps }, null if never set) — change it with set_timeline_view.',
      inputSchema: { timelineId: z.string() },
    },
    async ({ timelineId }) => {
      requireOwned(timelineId)
      return json({
        title: getTimelineTitle(timelineId),
        viewSettings: getTimelineMeta(timelineId)?.viewSettings ?? null,
        ...loadGraph(timelineId),
      })
    },
  )

  register(
    'query_timeline',
    {
      title: 'Query timeline nodes',
      description:
        'Context-cheap read: filter a timeline\'s nodes and get COMPACT rows ({ id, title, type, start, end?, lane?, ' +
        'location?, hasStory? }) instead of the full graph. Use this (not get_timeline) for mid-build lookups — ' +
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
    },
    async ({ timelineId, q, type, lane, from, to, hasStory, full, limit, offset }) => {
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
      return json({
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
      })
    },
  )

  register(
    'get_node',
    {
      title: 'Get one node in full',
      description:
        'Everything about ONE node: all fields (summary, citations, images, lane, location), its edges with the ' +
        'other endpoint\'s title, and the stories attached to it. The context-cheap companion to query_timeline — ' +
        'query for ids, then drill in here.',
      inputSchema: { nodeId: z.string() },
    },
    async ({ nodeId }) => {
      const timelineId = getMomentTimelineId(nodeId)
      const meta = timelineId ? getTimelineMeta(timelineId) : null
      if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`node "${nodeId}" not found`)
      const graph = loadGraph(timelineId)
      const node = graph.nodes.find((n) => n.id === nodeId)!
      const titles = new Map(graph.nodes.map((n) => [n.id, n.title]))
      return json({
        id: node.id,
        timelineId,
        type: node.type,
        subtype: node.metadata?.subtype ?? null,
        title: node.title,
        summary: node.summary,
        start: formatInstant(node.startInstant, node.precision),
        end: node.endInstant != null ? formatInstant(node.endInstant, node.precision) : null,
        precision: node.precision,
        lane: node.metadata?.lane ?? null,
        location: node.metadata?.location ?? null,
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
      })
    },
  )

  register(
    'get_layout_report',
    {
      title: 'Review the timeline\'s layout',
      description:
        'A compact whole-graph shape review — the canvas\'s view of the build, sized for an agent to reason over ' +
        '(get_timeline is the full data dump; this is the X-ray). Returns lane health (counts, density, ' +
        'near-duplicate lane names, fragments), axis span + dead zones, era coverage (nodes + stories per period), ' +
        'story coverage, the deduplicated source registry, the same advisories apply_patch computes, and a ' +
        'one-line-per-node index. Call it after a multi-patch build or reshape, then ACT on what it shows: merge ' +
        'drifted lanes, re-anchor outliers, fill story-poor eras, balance thin sourcing.',
      inputSchema: { timelineId: z.string() },
    },
    async ({ timelineId }) => {
      requireOwned(timelineId)
      return json(
        await buildLayoutReport(timelineId, loadGraph(timelineId), getTimelineMeta(timelineId)?.viewSettings ?? null),
      )
    },
  )

  register(
    'apply_patch',
    {
      title: 'Apply a batch of edits',
      description:
        'Apply a batch of graph edits as ONE atomic, undoable Patch. ops is an ordered list of add_node/update_node/delete_node/add_edge/update_edge/delete_edge. Use `ref` on add_node to reference the new node from a later add_edge in the same batch. ' +
        'The result includes `warnings` — broken image URLs, lanes too dense for the current scale, dates that stretch the axis. The patch is COMMITTED regardless; act on warnings with a follow-up apply_patch or set_timeline_view.',
      inputSchema: { timelineId: z.string(), summary: z.string(), ops: z.array(opSchema) },
    },
    async ({ timelineId, summary, ops }) => {
      // Create-if-missing owned by this user; if it exists, it must be theirs.
      const meta = getTimelineMeta(timelineId)
      if (meta && meta.ownerId !== ownerId) throw new Error(`timeline "${timelineId}" not found`)
      ensureTimeline(timelineId, ownerId)
      const builder = new PatchBuilder(timelineId, loadGraph(timelineId))
      const { results } = applyOps(builder, ops)
      const patchId = commitPatch(timelineId, builder, (summary || 'MCP edit').slice(0, 200))
      // Advisory only, computed after the commit (image checks hit the network);
      // live viewers already got the SSE nudge from commitPatch.
      const graph = loadGraph(timelineId)
      const warnings = await collectPatchWarnings(graph, ops, getTimelineMeta(timelineId)?.viewSettings ?? null)
      return json({ patchId, results, warnings, graphSummary: graphSummary(graph), ...historyState(timelineId) })
    },
  )

  register(
    'set_timeline_view',
    {
      title: 'Set timeline view defaults',
      description:
        'Save the timeline\'s default time-axis view, applied when a viewer opens it (a device where the user ' +
        'already adjusted the scale keeps its own). Call this once AFTER building so the first open isn\'t the ' +
        'wrong zoom. `pxPerDay` is horizontal pixels per day of the base layout, clamped to ' +
        `[${MIN_PX_PER_DAY}, ${MAX_PX_PER_DAY}] (default ${BASE_PX_PER_DAY}) — pick it so the dense era fills a few screens: ` +
        'pxPerDay ≈ 3000 / (days spanned by the bulk of the nodes). `collapseGaps` squeezes long empty spans into a ' +
        'compact axis break — enable it when outlier dates (an org founded decades before the events, an ancient ' +
        'precursor) would otherwise stretch the axis into dead space. Omitted fields keep their current value. ' +
        'Read the current settings via get_timeline\'s `viewSettings`.',
      inputSchema: {
        timelineId: z.string(),
        pxPerDay: z.number().positive().optional().describe('Pixels per day, clamped to the allowed range.'),
        collapseGaps: z.boolean().optional().describe('Collapse long empty spans into a fixed-width axis break.'),
      },
    },
    async ({ timelineId, pxPerDay, collapseGaps }) => {
      requireOwned(timelineId)
      const current = getTimelineMeta(timelineId)?.viewSettings ?? null
      const next = {
        pxPerDay: clampPxPerDay(pxPerDay ?? current?.pxPerDay ?? BASE_PX_PER_DAY),
        collapseGaps: collapseGaps ?? current?.collapseGaps ?? false,
      }
      setTimelineView(timelineId, ownerId, next)
      // Live viewers re-pull the graph (which carries viewSettings) on any event.
      emitTimelineEvent({ timelineId, kind: 'view', seq: maxAppliedSeq(timelineId) })
      return json({ ok: true, viewSettings: next })
    },
  )

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

  register(
    'write_story',
    {
      title: 'Write a story onto a moment',
      description:
        'Attach a narrative to a moment (a node) as an ordered list of beats (segments). Stories are SEPARATE from the graph — written directly, with their own provenance, and NOT part of the undo/redo Patch stack. A moment can hold SEVERAL stories: omit `storyId` to CREATE a new story; pass an existing `storyId` (one belonging to this moment) to UPDATE that story in place (replacing its meta + beats). Pass the node id as `momentId`. The canvas shows a badge on moments with a story and lists them beside the moment when the user opens the node, playing the beats back on demand. To turn a beat into a guided tour, set `focusNodeId` to another node id on the same timeline: as the reader reaches that beat the canvas pans + rings that entity and the detail panel beside the story switches to show it (omit it to stay on the moment). Give the story a CAST: materialize its key characters as entity nodes FIRST (apply_patch), then list them in `cast` — name-only cast entries come back as warnings so you can add their nodes. Give it ART: `coverImage` for the reader\'s cover, and an `image` on beats where a real artwork exists (sensory beats especially). Ground each beat in real sources: pass `citations` (title + optional url + verbatim quote) on every beat that makes a factual claim — stories without sources are just plausible fiction. The result includes `warnings` (dangling node ids, node-less cast names, broken image URLs); the story is SAVED regardless — fix with a follow-up write_story carrying the same storyId.',
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
        segments: z
          .array(
            z.object({
              bodyText: z.string(),
              kind: z.enum(SEGMENT_KINDS).optional(),
              settingNote: z.string().optional(),
              relatedNodeIds: z.array(z.string()).optional(),
              // Spotlight one entity for this beat: the canvas pans + rings it and the
              // entity panel beside the story switches to show it. A node id on the
              // same timeline; omit to stay on the moment.
              focusNodeId: z.string().optional(),
              // Real sources grounding this beat (cite freely). Same shape as a
              // node's citations: a title plus an optional url and a verbatim quote.
              citations: z
                .array(
                  z.object({
                    title: z.string(),
                    url: z.string().optional(),
                    quote: z.string().optional(),
                    sourceType: z.enum(['primary', 'scholarship', 'data', 'press']).optional(),
                  }),
                )
                .optional(),
              image: storyImageInput.optional().describe('Optional art for this beat; `layout` picks its treatment.'),
            }),
          )
          .min(1),
      },
    },
    async ({ momentId, storyId, title, hook, povType, depthTier, estimatedMinutes, coverImage, cast, segments }) => {
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
      segments.forEach((s, i) => {
        if (s.focusNodeId && !nodeIds.has(s.focusNodeId)) {
          warnings.push(
            `beat ${i + 1}: focusNodeId "${s.focusNodeId}" is not a node on this timeline — the tour will fall back to the moment`,
          )
        }
        for (const id of s.relatedNodeIds ?? []) {
          if (!nodeIds.has(id)) warnings.push(`beat ${i + 1}: relatedNodeId "${id}" is not a node on this timeline`)
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
      const imageUrls = [...(coverImage ? [coverImage.url] : []), ...segments.flatMap((s) => (s.image ? [s.image.url] : []))]
      if (imageUrls.length) warnings.push(...(await imageUrlWarnings(imageUrls, 'story image URL')))

      const result = writeStory(
        momentId,
        { title, hook, povType, depthTier, estimatedMinutes, coverImage, cast },
        segments,
        { storyId },
      )
      // Nudge live viewers to refetch so the depth badge appears in near-real-time
      // (same SSE channel as patches; seq = current max so it never rewinds Last-Event-ID).
      emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
      return json({ ...result, warnings })
    },
  )

  register(
    'undo',
    { title: 'Undo', description: 'Undo the most recent Patch on a timeline.', inputSchema: { timelineId: z.string() } },
    async ({ timelineId }) => {
      requireOwned(timelineId)
      return json({ undone: undo(timelineId), ...historyState(timelineId) })
    },
  )

  register(
    'redo',
    { title: 'Redo', description: 'Redo the most recently undone Patch on a timeline.', inputSchema: { timelineId: z.string() } },
    async ({ timelineId }) => {
      requireOwned(timelineId)
      return json({ redone: redo(timelineId), ...historyState(timelineId) })
    },
  )

  // Read-only resource mirror — this owner's timelines only, never writes.
  server.registerResource(
    'timeline',
    new ResourceTemplate('synek://timeline/{timelineId}', {
      list: async () => ({
        resources: listTimelines(ownerId).map((t) => ({
          uri: `synek://timeline/${t.id}`,
          name: t.title,
          mimeType: 'application/json',
        })),
      }),
    }),
    { title: 'Timeline graph', description: 'A timeline\'s nodes and edges as JSON.', mimeType: 'application/json' },
    async (uri, { timelineId }) => {
      const id = String(timelineId)
      requireOwned(id)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ title: getTimelineTitle(id), ...loadGraph(id) }),
          },
        ],
      }
    },
  )

  return server
}
