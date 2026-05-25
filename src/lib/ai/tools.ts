import { tool } from 'ai'
import { z } from 'zod'

const citation = z.object({
  title: z.string(),
  url: z.string().optional(),
  quote: z.string().optional(),
})

const dateHint = 'A date, possibly fuzzy: "1995", "Q3 2008", "2014-03", or "49 BCE".'

// The six graph tools the model calls to build/edit a timeline.
//
// NOTE: `execute` is a Phase 0 stub. In Phase 0 these will append ops to a
// PatchBuilder (passed in here) so a whole AI turn commits as ONE atomic,
// undoable Patch — never touching the DB mid-stream. See CLAUDE.md → AI loop.
export function makeTools(/* builder: PatchBuilder */) {
  return {
    add_node: tool({
      description:
        'Add a node to the timeline. type=event (point in time), entity (a span like a company lifespan), period (a wide background era).',
      inputSchema: z.object({
        type: z.enum(['event', 'entity', 'period']),
        title: z.string(),
        summary: z.string().optional(),
        start: z.string().describe(dateHint),
        end: z.string().optional().describe('End for entity/period spans. Omit for events.'),
        precision: z.enum(['year', 'quarter', 'month', 'day']).optional(),
        citations: z.array(citation).optional(),
      }),
      execute: async (input) => ({ ok: true as const, pending: input.title }),
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
          precision: z.enum(['year', 'quarter', 'month', 'day']).optional(),
          citations: z.array(citation).optional(),
        }),
      }),
      execute: async (input) => ({ ok: true as const, id: input.id }),
    }),

    delete_node: tool({
      description: 'Delete a node (and its connected edges) by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async (input) => ({ ok: true as const, id: input.id }),
    }),

    add_edge: tool({
      description: 'Add a typed directional relationship from one node to another.',
      inputSchema: z.object({
        sourceId: z.string(),
        targetId: z.string(),
        kind: z.enum(['caused', 'succeeded', 'influenced', 'acquired', 'competed_with']),
        label: z.string().optional(),
      }),
      execute: async () => ({ ok: true as const }),
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
      execute: async (input) => ({ ok: true as const, id: input.id }),
    }),

    delete_edge: tool({
      description: 'Delete an edge by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async (input) => ({ ok: true as const, id: input.id }),
    }),
  }
}
