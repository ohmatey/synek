import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ensureTimeline,
  createTimeline,
  listTimelines,
  loadGraph,
  getTimelineTitle,
  getTimelineMeta,
} from '~/lib/db/graph'
import { PatchBuilder, commitPatch, undo, redo, historyState, maxAppliedSeq } from '~/lib/db/patches'
import { writeStory, getMomentTimelineId } from '~/lib/db/stories'
import { emitTimelineEvent } from '~/lib/server/bus'
import { POV_TYPES, DEPTH_TIERS, SEGMENT_KINDS } from '~/lib/domain/types'
import { BASE_URL } from '~/lib/auth'
import { opSchema, applyOps } from './ops'

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
        'undo / redo step the per-timeline history. ' +
        'To attach a NARRATIVE to a moment (node), call write_story with that node\'s id (momentId) and an ordered list of beats — stories are separate from the graph, written directly, and are NOT part of the undo/redo Patch stack. ' +
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
      description: 'Return a timeline\'s full graph: { title, nodes, edges }. Use node ids for update/delete/edge ops.',
      inputSchema: { timelineId: z.string() },
    },
    async ({ timelineId }) => {
      requireOwned(timelineId)
      return json({ title: getTimelineTitle(timelineId), ...loadGraph(timelineId) })
    },
  )

  server.registerTool(
    'apply_patch',
    {
      title: 'Apply a batch of edits',
      description:
        'Apply a batch of graph edits as ONE atomic, undoable Patch. ops is an ordered list of add_node/update_node/delete_node/add_edge/update_edge/delete_edge. Use `ref` on add_node to reference the new node from a later add_edge in the same batch.',
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
      return json({ patchId, results, ...historyState(timelineId) })
    },
  )

  server.registerTool(
    'write_story',
    {
      title: 'Write a story onto a moment',
      description:
        'Attach a narrative to a moment (a node) as an ordered list of beats (segments). Stories are SEPARATE from the graph — written directly, with their own provenance, and NOT part of the undo/redo Patch stack. Re-calling REPLACES the moment\'s existing story. Pass the node id as `momentId`. The canvas shows a badge on moments with a story and plays the beats back when the user opens the node.',
      inputSchema: {
        momentId: z.string(),
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
            }),
          )
          .min(1),
      },
    },
    async ({ momentId, title, hook, povType, depthTier, estimatedMinutes, segments }) => {
      // write_story keys off a node id; resolve its timeline and run the same
      // owner check the timeline-scoped tools use.
      const timelineId = getMomentTimelineId(momentId)
      const meta = timelineId ? getTimelineMeta(timelineId) : null
      if (!timelineId || !meta || meta.ownerId !== ownerId) throw new Error(`moment "${momentId}" not found`)
      const result = writeStory(momentId, { title, hook, povType, depthTier, estimatedMinutes }, segments)
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
