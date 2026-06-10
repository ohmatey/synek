import { z } from 'zod'
import { parseDate } from '~/lib/domain/dates'
import type { PatchBuilder, NodePatch, EdgePatch } from '~/lib/db/patches'
import type { NodeMetadata } from '~/lib/db/schema'
import type { Precision } from '~/lib/domain/types'

// Transport-agnostic graph-edit logic. Lifted out of the old AI-SDK `tools.ts`
// so the SAME op semantics back the MCP server. A batch of ops runs through one
// PatchBuilder and commits as one atomic, undoable Patch upstream.

const citation = z.object({
  title: z.string(),
  url: z.string().optional(),
  quote: z.string().optional(),
})

const dateHint = 'A date, possibly fuzzy: "1995", "Q3 2008", "2014-03", or "49 BCE".'
const precisionEnum = z.enum(['year', 'quarter', 'month', 'day'])
const kindEnum = z.enum(['caused', 'succeeded', 'influenced', 'acquired', 'competed_with'])
const subtypeEnum = z.enum(['person', 'org', 'place', 'work'])
const subtypeHint =
  'For entity nodes, the kind: person, org (company/institution), place, or work (a creation/publication).'
const typeHint =
  'event = a point in time; entity = a person/org/place/work (set subtype); period = a span/era; ' +
  'concept = an idea/doctrine/principle (its start = when first articulated, end optional).'
const refHint =
  'Optional local alias for THIS node so a later add_edge in the same batch can reference it before it has a real id.'
const laneHint =
  'Swimlane this node belongs to (a short group name, e.g. a company/actor like "OpenAI"). ' +
  'Nodes sharing a lane render as one horizontal row, ordered left→right by date — ideal for comparing ' +
  'parallel tracks (rival companies, branches, factions). Omit for one-off nodes; reuse the EXACT same ' +
  'string for every node in a track.'

// One edit in a batch. `ref` (on add_node/add_edge) lets a single batch create a
// node and then connect an edge to it — the alias resolves to the new id.
export const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    ref: z.string().optional().describe(refHint),
    type: z.enum(['event', 'entity', 'period', 'concept']).describe(typeHint),
    title: z.string(),
    summary: z.string().optional(),
    start: z.string().describe(dateHint),
    end: z.string().optional().describe('End for entity/period spans. Omit for events.'),
    precision: precisionEnum.optional(),
    citations: z.array(citation).optional(),
    subtype: subtypeEnum.optional().describe(subtypeHint),
    lane: z.string().optional().describe(laneHint),
  }),
  z.object({
    op: z.literal('update_node'),
    id: z.string().describe('Target node id (or a ref from earlier in this batch).'),
    type: z
      .enum(['event', 'entity', 'period', 'concept'])
      .optional()
      .describe('Reclassify the node (e.g. event → concept). Edges, citations, and images are kept.'),
    title: z.string().optional(),
    summary: z.string().optional(),
    start: z.string().optional().describe(dateHint),
    end: z.string().optional(),
    precision: precisionEnum.optional(),
    citations: z.array(citation).optional(),
    subtype: subtypeEnum.optional().describe(subtypeHint),
    lane: z.string().optional().describe(laneHint + ' Pass "" to clear the lane.'),
  }),
  z.object({
    op: z.literal('delete_node'),
    id: z.string().describe('Node id to delete (connected edges are removed too).'),
  }),
  z.object({
    op: z.literal('add_edge'),
    ref: z.string().optional().describe(refHint),
    sourceId: z.string().describe('Source node id (or a ref from this batch).'),
    targetId: z.string().describe('Target node id (or a ref from this batch).'),
    kind: kindEnum,
    label: z.string().optional(),
  }),
  z.object({
    op: z.literal('update_edge'),
    id: z.string(),
    kind: kindEnum.optional(),
    label: z.string().optional(),
  }),
  z.object({
    op: z.literal('delete_edge'),
    id: z.string(),
  }),
])

export type Op = z.infer<typeof opSchema>
export type OpResult = { op: Op['op']; ref?: string } & ({ id: string } | { error: string })

// Apply a batch of ops to a PatchBuilder. Returns a per-op result list. Nothing
// touches the DB here — commitPatch (upstream) flushes the builder as one Patch.
export function applyOps(builder: PatchBuilder, ops: Op[]): { results: OpResult[] } {
  // ref alias -> real id, for nodes created earlier in this same batch.
  const refs = new Map<string, string>()
  const resolve = (id: string) => refs.get(id) ?? id
  const results: OpResult[] = []

  for (const op of ops) {
    switch (op.op) {
      case 'add_node': {
        const start = parseDate(op.start)
        const end = op.end ? parseDate(op.end) : null
        const metadata: NodeMetadata | null =
          op.citations?.length || op.subtype || op.lane
            ? {
                ...(op.citations?.length ? { citations: op.citations } : {}),
                ...(op.subtype ? { subtype: op.subtype } : {}),
                ...(op.lane ? { lane: op.lane } : {}),
              }
            : null
        const node = builder.addNode({
          type: op.type,
          title: op.title,
          summary: op.summary ?? null,
          startInstant: start.instant,
          endInstant: end?.instant ?? null,
          precision: (op.precision as Precision | undefined) ?? start.precision,
          metadata,
        })
        if (op.ref) refs.set(op.ref, node.id)
        results.push({ op: op.op, ref: op.ref, id: node.id })
        break
      }

      case 'update_node': {
        const id = resolve(op.id)
        const np: NodePatch = {}
        if (op.type) np.type = op.type
        if (op.title !== undefined) np.title = op.title
        if (op.summary !== undefined) np.summary = op.summary
        if (op.start) {
          const p = parseDate(op.start)
          np.startInstant = p.instant
          if (!op.precision) np.precision = p.precision
        }
        if (op.end) np.endInstant = parseDate(op.end).instant
        if (op.precision) np.precision = op.precision
        // Merge metadata so existing images/color/size aren't clobbered.
        if (op.citations || op.subtype || op.lane !== undefined) {
          const prior = (builder.getNode(id)?.metadata ?? {}) as NodeMetadata
          const merged: NodeMetadata = {
            ...prior,
            ...(op.citations ? { citations: op.citations } : {}),
            ...(op.subtype ? { subtype: op.subtype } : {}),
          }
          // lane === "" clears the swimlane; any other string sets it.
          if (op.lane !== undefined) {
            if (op.lane === '') delete merged.lane
            else merged.lane = op.lane
          }
          np.metadata = merged
        }
        results.push(builder.updateNode(id, np) ? { op: op.op, id } : { op: op.op, error: `node ${id} not found` })
        break
      }

      case 'delete_node': {
        const id = resolve(op.id)
        results.push(builder.deleteNode(id) ? { op: op.op, id } : { op: op.op, error: `node ${id} not found` })
        break
      }

      case 'add_edge': {
        const r = builder.addEdge({
          sourceId: resolve(op.sourceId),
          targetId: resolve(op.targetId),
          kind: op.kind,
          label: op.label,
        })
        if ('error' in r) {
          results.push({ op: op.op, ref: op.ref, error: r.error })
        } else {
          if (op.ref) refs.set(op.ref, r.id)
          results.push({ op: op.op, ref: op.ref, id: r.id })
        }
        break
      }

      case 'update_edge': {
        const ep: EdgePatch = {}
        if (op.kind) ep.kind = op.kind
        if (op.label !== undefined) ep.label = op.label
        results.push(
          builder.updateEdge(op.id, ep) ? { op: op.op, id: op.id } : { op: op.op, error: `edge ${op.id} not found` },
        )
        break
      }

      case 'delete_edge': {
        results.push(
          builder.deleteEdge(op.id) ? { op: op.op, id: op.id } : { op: op.op, error: `edge ${op.id} not found` },
        )
        break
      }
    }
  }

  return { results }
}
