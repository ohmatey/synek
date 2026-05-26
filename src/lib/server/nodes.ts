import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { loadGraph } from '~/lib/db/graph'
import { PatchBuilder, commitPatch, type NodePatch } from '~/lib/db/patches'
import { illustrateOnBuilder } from '~/lib/db/illustrate'
import type { NodeMetadata } from '~/lib/db/schema'

// Manual node edits go through the SAME Patch path as the AI: build one
// update/delete op, commit it as a single atomic Patch. So a hand edit is
// undoable by the same ⌘Z stack — no separate history mechanism.

const citation = z.object({
  title: z.string(),
  url: z.string().optional(),
  quote: z.string().optional(),
})

const image = z.object({
  url: z.string(),
  alt: z.string().optional(),
  show: z.boolean().optional(),
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
  }),
})

export const editNode = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof editInput>) => editInput.parse(d))
  .handler(({ data }) => {
    const { timelineId, nodeId, patch } = data
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
      patch.subtype !== undefined
    ) {
      const metadata: NodeMetadata = { ...(cur.metadata ?? {}) }
      if (patch.citations !== undefined) metadata.citations = patch.citations
      if (patch.images !== undefined) metadata.images = patch.images
      if (patch.size !== undefined) metadata.size = patch.size
      if (patch.color !== undefined) metadata.color = patch.color ?? undefined
      if (patch.subtype !== undefined) metadata.subtype = patch.subtype ?? undefined
      np.metadata = metadata
    }
    // Empty patch → no-op (avoids an empty `SET` and a meaningless Patch row).
    if (Object.keys(np).length === 0) return { ok: true as const, patchId: null }

    const builder = new PatchBuilder(timelineId, graph)
    builder.updateNode(nodeId, np)
    const patchId = commitPatch(timelineId, builder, `Edit: ${patch.title ?? cur.title}`)
    return { ok: true as const, patchId }
  })

// Direct "Illustrate this" action from the detail panel — generates an image
// for the node and attaches it as one undoable Patch (same path as the chat
// tool). Auto-derives a brief from the node when none is given.
const illustrateInput = z.object({
  timelineId: z.string(),
  nodeId: z.string(),
  brief: z.string().optional(),
})

export const illustrateNode = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof illustrateInput>) => illustrateInput.parse(d))
  .handler(async ({ data }) => {
    const { timelineId, nodeId, brief } = data
    if (!process.env.OPENAI_API_KEY) {
      return { ok: false as const, error: 'Set OPENAI_API_KEY in .env to generate images.' }
    }
    const graph = loadGraph(timelineId)
    const cur = graph.nodes.find((n) => n.id === nodeId)
    if (!cur) return { ok: false as const, error: 'node not found' }

    const autoBrief = brief?.trim() || `${cur.title}${cur.summary ? ` — ${cur.summary}` : ''}`
    const builder = new PatchBuilder(timelineId, graph)
    const r = await illustrateOnBuilder(builder, nodeId, autoBrief)
    if (!r.ok) return { ok: false as const, error: r.error }
    const patchId = commitPatch(timelineId, builder, `Illustrate: ${cur.title}`)
    return { ok: true as const, patchId, cached: r.cached, image: r.image }
  })

const deleteInput = z.object({ timelineId: z.string(), nodeId: z.string() })

export const deleteNode = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof deleteInput>) => deleteInput.parse(d))
  .handler(({ data }) => {
    const { timelineId, nodeId } = data
    const graph = loadGraph(timelineId)
    const cur = graph.nodes.find((n) => n.id === nodeId)
    if (!cur) return { ok: false as const, error: 'node not found' }

    const builder = new PatchBuilder(timelineId, graph)
    builder.deleteNode(nodeId) // connected edges captured for the inverse op
    const patchId = commitPatch(timelineId, builder, `Delete: ${cur.title}`)
    return { ok: true as const, patchId }
  })
