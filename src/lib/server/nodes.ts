import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { loadGraph, getTimelineMeta } from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'
import { PatchBuilder, commitPatch, type NodePatch } from '~/lib/db/patches'
import type { NodeMetadata } from '~/lib/db/schema'

// Manual node edits go through the SAME Patch path as the AI: build one
// update/delete op, commit it as a single atomic Patch. So a hand edit is
// undoable by the same ⌘Z stack — no separate history mechanism.

// Manual edits are owner-only: require a session and assert the timeline belongs
// to the caller before any mutation.
async function assertOwnsTimeline(timelineId: string): Promise<void> {
  const user = await requireUser()
  const meta = getTimelineMeta(timelineId)
  if (!meta || meta.ownerId !== user.id) throw new Error('forbidden: not your timeline')
}

const citation = z.object({
  title: z.string(),
  url: z.string().optional(),
  quote: z.string().optional(),
})

const image = z.object({
  url: z.string(),
  alt: z.string().optional(),
  show: z.boolean().optional(),
  aspect: z.enum(['landscape', 'portrait']).optional(),
})

const editInput = z.object({
  timelineId: z.string(),
  nodeId: z.string(),
  patch: z.object({
    title: z.string().optional(),
    summary: z.string().nullable().optional(),
    startInstant: z.number().optional(),
    endInstant: z.number().nullable().optional(),
    precision: z.enum(['year', 'quarter', 'month', 'day']).optional(),
    citations: z.array(citation).optional(),
    images: z.array(image).optional(),
    size: z.enum(['small', 'medium', 'large']).optional(),
    color: z.string().nullable().optional(),
    subtype: z.enum(['person', 'org', 'place', 'work']).nullable().optional(),
    // Swimlane key. "" / null clears it (back to type-lane layout).
    lane: z.string().nullable().optional(),
  }),
})

export const editNode = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof editInput>) => editInput.parse(d))
  .handler(async ({ data }) => {
    const { timelineId, nodeId, patch } = data
    await assertOwnsTimeline(timelineId)
    const graph = loadGraph(timelineId)
    const cur = graph.nodes.find((n) => n.id === nodeId)
    if (!cur) return { ok: false as const, error: 'node not found' }

    const np: NodePatch = {}
    if (patch.title !== undefined) np.title = patch.title
    if (patch.summary !== undefined) np.summary = patch.summary
    if (patch.startInstant !== undefined) np.startInstant = patch.startInstant
    if (patch.endInstant !== undefined) np.endInstant = patch.endInstant
    if (patch.precision !== undefined) np.precision = patch.precision
    // citations / images / size all live in metadata — merge each independently.
    if (
      patch.citations !== undefined ||
      patch.images !== undefined ||
      patch.size !== undefined ||
      patch.color !== undefined ||
      patch.subtype !== undefined ||
      patch.lane !== undefined
    ) {
      const metadata: NodeMetadata = { ...(cur.metadata ?? {}) }
      if (patch.citations !== undefined) metadata.citations = patch.citations
      if (patch.images !== undefined) metadata.images = patch.images
      if (patch.size !== undefined) metadata.size = patch.size
      if (patch.color !== undefined) metadata.color = patch.color ?? undefined
      if (patch.subtype !== undefined) metadata.subtype = patch.subtype ?? undefined
      // Empty string or null clears the swimlane.
      if (patch.lane !== undefined) {
        if (patch.lane) metadata.lane = patch.lane
        else delete metadata.lane
      }
      np.metadata = metadata
    }
    // Empty patch → no-op (avoids an empty `SET` and a meaningless Patch row).
    if (Object.keys(np).length === 0) return { ok: true as const, patchId: null }

    const builder = new PatchBuilder(timelineId, graph)
    builder.updateNode(nodeId, np)
    const patchId = commitPatch(timelineId, builder, `Edit: ${patch.title ?? cur.title}`)
    return { ok: true as const, patchId }
  })

const deleteInput = z.object({ timelineId: z.string(), nodeId: z.string() })

export const deleteNode = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof deleteInput>) => deleteInput.parse(d))
  .handler(async ({ data }) => {
    const { timelineId, nodeId } = data
    await assertOwnsTimeline(timelineId)
    const graph = loadGraph(timelineId)
    const cur = graph.nodes.find((n) => n.id === nodeId)
    if (!cur) return { ok: false as const, error: 'node not found' }

    const builder = new PatchBuilder(timelineId, graph)
    builder.deleteNode(nodeId) // connected edges captured for the inverse op
    const patchId = commitPatch(timelineId, builder, `Delete: ${cur.title}`)
    return { ok: true as const, patchId }
  })
