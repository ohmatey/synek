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
import { writeStory, getMomentTimelineId } from '~/lib/db/stories'
import { emitTimelineEvent } from '~/lib/server/bus'
import { POV_TYPES, DEPTH_TIERS, SEGMENT_KINDS } from '~/lib/domain/types'
import { BASE_URL } from '~/lib/auth'
import { opSchema, applyOps } from './ops'
import { collectPatchWarnings } from './warnings'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

// The viewer URL a client hands back to the user so they can watch the canvas
// build live. BASE_URL is the same origin the app + auth run on.
const viewerUrl = (id: string) => `${BASE_URL}/timelines/${id}`

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
        'Read with list_timelines / get_timeline. ' +
        'MUTATE the graph ONLY via apply_patch — one call = one undoable Patch holding a batch of ops. ' +
        'Within a batch, set `ref` on an add_node and reuse that alias as an edge endpoint to wire edges to nodes created in the same call. ' +
        'Give nodes a FACE, not a bare box: when you know a real, web-accessible image for a node (a Wikimedia portrait for a person, an official logo for an org, public-domain art for an era/event), pass it in the add_node/update_node `images` field as a URL. Set each image\'s `aspect` to "portrait" for tall subjects (a standing person, a headshot) or "landscape" for wide ones (scenes, logos) so it is framed correctly. Synek stores and renders it; it does not generate images. ' +
        'undo / redo step the per-timeline history. ' +
        'After building (or reshaping) a timeline, call set_timeline_view to pick the default zoom (pxPerDay) and gap collapsing so the canvas opens readable — heed the density warnings apply_patch returns. ' +
        'To attach a NARRATIVE to a moment (node), call write_story with that node\'s id (momentId) and an ordered list of beats — stories are separate from the graph, written directly, and are NOT part of the undo/redo Patch stack. A moment can hold SEVERAL stories: omit `storyId` to create a new one, or pass an existing story\'s id to update it in place. Set a beat\'s `focusNodeId` to another node id to make the canvas pan to that entity and the panel beside the story switch to it as the reader reaches that beat (a guided tour); omit it to stay on the moment. ' +
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

  server.registerTool(
    'list_timelines',
    { title: 'List timelines', description: 'List your timelines (id + title), newest first.', inputSchema: {} },
    async () => json(listTimelines(ownerId).map((t) => ({ id: t.id, title: t.title }))),
  )

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
      const warnings = await collectPatchWarnings(
        loadGraph(timelineId),
        ops,
        getTimelineMeta(timelineId)?.viewSettings ?? null,
      )
      return json({ patchId, results, warnings, ...historyState(timelineId) })
    },
  )

  server.registerTool(
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

  server.registerTool(
    'write_story',
    {
      title: 'Write a story onto a moment',
      description:
        'Attach a narrative to a moment (a node) as an ordered list of beats (segments). Stories are SEPARATE from the graph — written directly, with their own provenance, and NOT part of the undo/redo Patch stack. A moment can hold SEVERAL stories: omit `storyId` to CREATE a new story; pass an existing `storyId` (one belonging to this moment) to UPDATE that story in place (replacing its meta + beats). Pass the node id as `momentId`. The canvas shows a badge on moments with a story and lists them beside the moment when the user opens the node, playing the beats back on demand. To turn a beat into a guided tour, set `focusNodeId` to another node id on the same timeline: as the reader reaches that beat the canvas pans + rings that entity and the detail panel beside the story switches to show it (omit it to stay on the moment). Ground each beat in real sources: pass `citations` (title + optional url + verbatim quote) on every beat that makes a factual claim — stories without sources are just plausible fiction.',
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
                .array(z.object({ title: z.string(), url: z.string().optional(), quote: z.string().optional() }))
                .optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ momentId, storyId, title, hook, povType, depthTier, estimatedMinutes, segments }) => {
      // write_story keys off a node id; resolve its timeline and run the same
      // owner check the timeline-scoped tools use.
      const timelineId = getMomentTimelineId(momentId)
      const meta = timelineId ? getTimelineMeta(timelineId) : null
      if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`moment "${momentId}" not found`)
      const result = writeStory(momentId, { title, hook, povType, depthTier, estimatedMinutes }, segments, { storyId })
      // Nudge live viewers to refetch so the depth badge appears in near-real-time
      // (same SSE channel as patches; seq = current max so it never rewinds Last-Event-ID).
      emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
      return json(result)
    },
  )

  server.registerTool(
    'undo',
    { title: 'Undo', description: 'Undo the most recent Patch on a timeline.', inputSchema: { timelineId: z.string() } },
    async ({ timelineId }) => {
      requireOwned(timelineId)
      return json({ undone: undo(timelineId), ...historyState(timelineId) })
    },
  )

  server.registerTool(
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
