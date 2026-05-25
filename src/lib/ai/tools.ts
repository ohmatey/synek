import { tool } from 'ai'
import { z } from 'zod'
import { parseDate } from '~/lib/domain/dates'
import type { PatchBuilder, NodePatch, EdgePatch } from '~/lib/db/patches'
import type { NodeMetadata } from '~/lib/db/schema'
import type { Precision } from '~/lib/domain/types'

const citation = z.object({
  title: z.string(),
  url: z.string().optional(),
  quote: z.string().optional(),
})

const dateHint = 'A date, possibly fuzzy: "1995", "Q3 2008", "2014-03", or "49 BCE".'
const precisionEnum = z.enum(['year', 'quarter', 'month', 'day'])
const kindEnum = z.enum(['caused', 'succeeded', 'influenced', 'acquired', 'competed_with'])

// The six graph tools. Each records an op on the PatchBuilder — nothing hits the
// DB until the turn commits as one atomic Patch. add_node returns the new id so
// the model can connect edges within the same turn.
export function makeTools(builder: PatchBuilder) {
  return {
    add_node: tool({
      description:
        'Add a node. type=event (a point in time), entity (a span like a company lifespan), period (a wide background era).',
      inputSchema: z.object({
        type: z.enum(['event', 'entity', 'period']),
        title: z.string(),
        summary: z.string().optional(),
        start: z.string().describe(dateHint),
        end: z.string().optional().describe('End for entity/period spans. Omit for events.'),
        precision: precisionEnum.optional(),
        citations: z.array(citation).optional(),
      }),
      execute: async (input) => {
        const start = parseDate(input.start)
        const end = input.end ? parseDate(input.end) : null
        const metadata: NodeMetadata | null = input.citations?.length ? { citations: input.citations } : null
        const node = builder.addNode({
          type: input.type,
          title: input.title,
          summary: input.summary ?? null,
          startInstant: start.instant,
          endInstant: end?.instant ?? null,
          precision: (input.precision as Precision | undefined) ?? start.precision,
          metadata,
        })
        return { id: node.id, title: node.title }
      },
    }),

    update_node: tool({
      description: 'Update fields of an existing node by id.',
      inputSchema: z.object({
        id: z.string(),
        patch: z.object({
          title: z.string().optional(),
          summary: z.string().optional(),
          start: z.string().optional().describe(dateHint),
          end: z.string().optional(),
          precision: precisionEnum.optional(),
          citations: z.array(citation).optional(),
        }),
      }),
      execute: async ({ id, patch }) => {
        const np: NodePatch = {}
        if (patch.title !== undefined) np.title = patch.title
        if (patch.summary !== undefined) np.summary = patch.summary
        if (patch.start) {
          const p = parseDate(patch.start)
          np.startInstant = p.instant
          if (!patch.precision) np.precision = p.precision
        }
        if (patch.end) np.endInstant = parseDate(patch.end).instant
        if (patch.precision) np.precision = patch.precision
        if (patch.citations) np.metadata = { citations: patch.citations }
        return builder.updateNode(id, np) ? { id } : { error: `node ${id} not found` }
      },
    }),

    delete_node: tool({
      description: 'Delete a node (its connected edges are removed too) by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => (builder.deleteNode(id) ? { id } : { error: `node ${id} not found` }),
    }),

    add_edge: tool({
      description: 'Add a typed directional relationship, using ids returned by add_node (or existing node ids).',
      inputSchema: z.object({
        sourceId: z.string(),
        targetId: z.string(),
        kind: kindEnum,
        label: z.string().optional(),
      }),
      execute: async (input) => {
        const r = builder.addEdge(input)
        return 'error' in r ? r : { id: r.id }
      },
    }),

    update_edge: tool({
      description: 'Update an edge by id.',
      inputSchema: z.object({
        id: z.string(),
        patch: z.object({ kind: kindEnum.optional(), label: z.string().optional() }),
      }),
      execute: async ({ id, patch }) => {
        const ep: EdgePatch = {}
        if (patch.kind) ep.kind = patch.kind
        if (patch.label !== undefined) ep.label = patch.label
        return builder.updateEdge(id, ep) ? { id } : { error: `edge ${id} not found` }
      },
    }),

    delete_edge: tool({
      description: 'Delete an edge by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => (builder.deleteEdge(id) ? { id } : { error: `edge ${id} not found` }),
    }),
  }
}
