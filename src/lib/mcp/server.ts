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
import { PatchBuilder, commitPatch, undo, redo, historyState } from '~/lib/db/patches'
import { opSchema, applyOps } from './ops'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

// One MCP server per request/connection, scoped to the OWNER behind the API key:
// every tool only sees and mutates that user's timelines. Reads are exposed as
// tools (so agentic clients can fetch mid-loop) AND mirrored as a read-only
// resource. ALL writes go through apply_patch.
export function buildMcpServer(ownerId: string): McpServer {
  const server = new McpServer(
    { name: 'synek', version: '0.1.0' },
    {
      instructions:
        'Synek is a timeline knowledge canvas. Read with list_timelines / get_timeline. ' +
        'MUTATE ONLY via apply_patch — one call = one undoable Patch holding a batch of ops. ' +
        'Within a batch, set `ref` on an add_node and reuse that alias as an edge endpoint to wire edges to nodes created in the same call. ' +
        'undo / redo step the per-timeline history. You only see and edit your own timelines.',
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
      description: 'Create a new empty timeline. Returns its id.',
      inputSchema: { title: z.string() },
    },
    async ({ title }) => {
      const t = createTimeline(title, ownerId)
      return json({ id: t.id, title: t.title })
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
