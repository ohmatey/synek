import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { loadGraph, getTimelineMeta } from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'
import { PatchBuilder, commitPatch, type NodePatch } from '~/lib/db/patches'
import { commitEntityPatch, type EntityContentPatch } from '~/lib/db/entity-patches'
import { parseDate } from '~/lib/domain/dates'
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
    // Where this happened, as a display string. "" / null clears it.
    location: z.string().nullable().optional(),
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
      patch.lane !== undefined ||
      patch.location !== undefined
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
      // Empty string or null clears the location.
      if (patch.location !== undefined) {
        if (patch.location) metadata.location = patch.location
        else delete metadata.location
      }
      np.metadata = metadata
    }
    // Empty patch → no-op (avoids an empty `SET` and a meaningless Patch row).
    if (Object.keys(np).length === 0) return { ok: true as const, patchId: null }

    // ADR 0004 R13: CONTENT edits go to the shared entity (its own undo stack;
    // propagates to every placement). Only `lane` (per-placement) stays a graph
    // patch. A bare legacy node (no entityId) keeps the all-in-one-patch behavior.
    if (cur.entityId) {
      const entityPatch: EntityContentPatch = {}
      if (np.title !== undefined) entityPatch.title = np.title
      if (np.summary !== undefined) entityPatch.summary = np.summary
      if (np.startInstant !== undefined) entityPatch.startInstant = np.startInstant
      if (np.endInstant !== undefined) entityPatch.endInstant = np.endInstant
      if (np.precision !== undefined) entityPatch.precision = np.precision
      if (np.metadata !== undefined) {
        const contentMeta: NodeMetadata = { ...np.metadata }
        delete contentMeta.lane
        entityPatch.metadata = contentMeta
      }
      let patchId: string | null = null
      if (Object.keys(entityPatch).length > 0) {
        patchId = commitEntityPatch(cur.entityId, entityPatch, `Edit: ${patch.title ?? cur.title}`).patchId
      }
      // lane → the placement (graph patch).
      if (patch.lane !== undefined) {
        const laneMeta: NodeMetadata = {}
        if (patch.lane) laneMeta.lane = patch.lane
        const builder = new PatchBuilder(timelineId, graph)
        builder.updateNode(nodeId, { metadata: laneMeta })
        const lanePatch = commitPatch(timelineId, builder, `Lane: ${patch.title ?? cur.title}`)
        patchId = patchId ?? lanePatch
      }
      return { ok: true as const, patchId }
    }

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

// Manual node CREATE (the in-app "Add → Create new" form). Same atomic-Patch path
// as the AI's apply_patch add_node and as placeEntityOnTimeline: co-creates a
// canonical entity + its placement in one undoable Patch (⌘Z removes both). Human
// date strings ("1969-07-20", "Q3 2008", "49 BCE") are parsed to instant+precision.
// Owner-only; `lane`/`subtype` ride the node metadata (per-placement + entity kind).
const createInput = z.object({
  timelineId: z.string(),
  type: z.enum(['event', 'entity', 'period', 'concept']),
  title: z.string().min(1),
  date: z.string().min(1),
  endDate: z.string().optional(),
  summary: z.string().optional(),
  lane: z.string().optional(),
  subtype: z.enum(['person', 'org', 'place', 'work']).optional(),
})

export const createNode = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof createInput>) => createInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const meta = getTimelineMeta(data.timelineId)
    if (!meta || meta.ownerId !== user.id) return { ok: false as const, error: 'forbidden: not your timeline' }

    const { instant, precision } = parseDate(data.date)
    const endInstant = data.endDate?.trim() ? parseDate(data.endDate).instant : null
    const metadata: NodeMetadata = {}
    if (data.lane?.trim()) metadata.lane = data.lane.trim()
    if (data.subtype) metadata.subtype = data.subtype

    const builder = new PatchBuilder(data.timelineId, loadGraph(data.timelineId), user.id)
    const node = builder.addNode({
      type: data.type,
      title: data.title.trim(),
      summary: data.summary?.trim() || null,
      startInstant: instant,
      endInstant,
      precision,
      metadata: Object.keys(metadata).length ? metadata : null,
    })
    const patchId = commitPatch(data.timelineId, builder, `Add: ${node.title}`)
    return { ok: true as const, nodeId: node.id, patchId }
  })
