import { tool } from 'ai'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db'
import { nodes, edges, type NodeMetadata } from '~/lib/db/schema'
import { parseDate } from '~/lib/domain/dates'
import type { Precision } from '~/lib/domain/types'

const citation = z.object({
  title: z.string(),
  url: z.string().optional(),
  quote: z.string().optional(),
})

const dateHint = 'A date, possibly fuzzy: "1995", "Q3 2008", "2014-03", or "49 BCE".'
const precisionEnum = z.enum(['year', 'quarter', 'month', 'day'])

// The six graph tools. In Phase 0 they write directly to SQLite (no undo yet —
// the PatchBuilder/undo system lands in Phase 1). add_node returns the new id so
// the model can connect edges within the same turn.
export function makeTools(ctx: { timelineId: string }) {
  const { timelineId } = ctx

  return {
    add_node: tool({
      description:
        'Add a node to the timeline. type=event (a point in time), entity (a span like a company lifespan), period (a wide background era).',
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
        const id = crypto.randomUUID()
        const start = parseDate(input.start)
        const end = input.end ? parseDate(input.end) : null
        const metadata: NodeMetadata | null = input.citations?.length ? { citations: input.citations } : null
        db.insert(nodes)
          .values({
            id,
            timelineId,
            type: input.type,
            title: input.title,
            summary: input.summary ?? null,
            startInstant: start.instant,
            endInstant: end?.instant ?? null,
            precision: (input.precision as Precision | undefined) ?? start.precision,
            metadata,
          })
          .run()
        return { id, title: input.title }
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
        const set: Partial<typeof nodes.$inferInsert> = {}
        if (patch.title !== undefined) set.title = patch.title
        if (patch.summary !== undefined) set.summary = patch.summary
        if (patch.start) {
          const p = parseDate(patch.start)
          set.startInstant = p.instant
          if (!patch.precision) set.precision = p.precision
        }
        if (patch.end) set.endInstant = parseDate(patch.end).instant
        if (patch.precision) set.precision = patch.precision
        if (patch.citations) set.metadata = { citations: patch.citations }
        db.update(nodes).set(set).where(eq(nodes.id, id)).run()
        return { id }
      },
    }),

    delete_node: tool({
      description: 'Delete a node (its connected edges are removed too) by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        db.delete(nodes).where(eq(nodes.id, id)).run()
        return { id }
      },
    }),

    add_edge: tool({
      description: 'Add a typed directional relationship from one node to another, using ids returned by add_node.',
      inputSchema: z.object({
        sourceId: z.string(),
        targetId: z.string(),
        kind: z.enum(['caused', 'succeeded', 'influenced', 'acquired', 'competed_with']),
        label: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const id = crypto.randomUUID()
          db.insert(edges)
            .values({ id, timelineId, sourceId: input.sourceId, targetId: input.targetId, kind: input.kind, label: input.label ?? null })
            .run()
          return { id }
        } catch (e) {
          return {
            error: `Could not add edge: ${e instanceof Error ? e.message : 'unknown'}. sourceId and targetId must be ids returned by add_node.`,
          }
        }
      },
    }),

    update_edge: tool({
      description: 'Update an edge by id.',
      inputSchema: z.object({
        id: z.string(),
        patch: z.object({
          kind: z.enum(['caused', 'succeeded', 'influenced', 'acquired', 'competed_with']).optional(),
          label: z.string().optional(),
        }),
      }),
      execute: async ({ id, patch }) => {
        const set: Partial<typeof edges.$inferInsert> = {}
        if (patch.kind) set.kind = patch.kind
        if (patch.label !== undefined) set.label = patch.label
        db.update(edges).set(set).where(eq(edges.id, id)).run()
        return { id }
      },
    }),

    delete_edge: tool({
      description: 'Delete an edge by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        db.delete(edges).where(eq(edges.id, id)).run()
        return { id }
      },
    }),
  }
}
