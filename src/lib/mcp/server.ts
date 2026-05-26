import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ensureTimeline,
  createTimeline,
  listTimelines,
  loadGraph,
  getTimelineTitle,
} from '~/lib/db/graph'
import { PatchBuilder, commitPatch, undo, redo, historyState } from '~/lib/db/patches'
import { opSchema, applyOps } from './ops'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

// One MCP server, two transports (HTTP + stdio). Reads are exposed as tools (so
// agentic clients can fetch mid-loop) AND mirrored as a read-only resource (so a
// human can @-attach a timeline as context). ALL writes go through apply_patch.
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'strata', version: '0.1.0' },
    {
      instructions:
        'Strata is a timeline knowledge canvas. Read with list_timelines / get_timeline. ' +
        'MUTATE ONLY via apply_patch — one call = one undoable Patch holding a batch of ops. ' +
        'Within a batch, set `ref` on an add_node and reuse that alias as an edge endpoint to wire edges to nodes created in the same call. ' +
        'undo / redo step the per-timeline history.',
    },
  )

  server.registerTool(
    'list_timelines',
    { title: 'List timelines', description: 'List all timelines (id + title), newest first.', inputSchema: {} },
    async () => json(listTimelines().map((t) => ({ id: t.id, title: t.title }))),
  )

  server.registerTool(
    'create_timeline',
    {
      title: 'Create timeline',
      description: 'Create a new empty timeline. Returns its id.',
      inputSchema: { title: z.string() },
    },
    async ({ title }) => {
      const t = createTimeline(title)
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
    async ({ timelineId }) => json({ title: getTimelineTitle(timelineId), ...loadGraph(timelineId) }),
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
      ensureTimeline(timelineId)
      const builder = new PatchBuilder(timelineId, loadGraph(timelineId))
      const { results } = applyOps(builder, ops)
      const patchId = commitPatch(timelineId, builder, (summary || 'MCP edit').slice(0, 200))
      return json({ patchId, results, ...historyState(timelineId) })
    },
  )

  server.registerTool(
    'undo',
    { title: 'Undo', description: 'Undo the most recent Patch on a timeline.', inputSchema: { timelineId: z.string() } },
    async ({ timelineId }) => json({ undone: undo(timelineId), ...historyState(timelineId) }),
  )

  server.registerTool(
    'redo',
    { title: 'Redo', description: 'Redo the most recently undone Patch on a timeline.', inputSchema: { timelineId: z.string() } },
    async ({ timelineId }) => json({ redone: redo(timelineId), ...historyState(timelineId) }),
  )

  // Read-only resource mirror — same data as the read tools, never writes.
  server.registerResource(
    'timeline',
    new ResourceTemplate('strata://timeline/{timelineId}', {
      list: async () => ({
        resources: listTimelines().map((t) => ({
          uri: `strata://timeline/${t.id}`,
          name: t.title,
          mimeType: 'application/json',
        })),
      }),
    }),
    { title: 'Timeline graph', description: 'A timeline\'s nodes and edges as JSON.', mimeType: 'application/json' },
    async (uri, { timelineId }) => {
      const id = String(timelineId)
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
