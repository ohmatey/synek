import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, desc, eq, like } from 'drizzle-orm'
import { db } from '~/lib/db'
import { entities, nodes, timelines, type EntityRow } from '~/lib/db/schema'
import { getTimelineMeta, loadGraph } from '~/lib/db/graph'
import { PatchBuilder, commitPatch } from '~/lib/db/patches'
import { undoEntity, redoEntity, entityHistoryState } from '~/lib/db/entity-patches'
import { getCurrentUser, requireUser } from '~/lib/auth/session'
import type { EntityContextResult, EntitySearchHit } from '~/lib/domain/types'

// ADR 0004 — the cross-timeline pieces of the shared-entity model. Content EDITS
// still flow through `editNode` (which routes content→entity); these add the
// aggregation ("appears on"), the per-entity undo controls, and placing an
// existing entity onto another timeline. All owner-scoped.

// Every timeline a given entity is placed on, for the entity page's "appears on".
function placementsOf(entityId: string): { timelineId: string; timelineTitle: string; nodeId: string }[] {
  return db
    .select({ timelineId: nodes.timelineId, timelineTitle: timelines.title, nodeId: nodes.id })
    .from(nodes)
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(eq(nodes.entityId, entityId))
    .all()
}

// The cross-timeline context for ONE placement (node) on the full-screen entity
// page: the entity it renders, every timeline it appears on, and the entity's own
// undo/redo state. Owner-scoped — only the entity's owner sees the aggregation +
// the controls. A non-owner / signed-out viewer gets `forbidden` (the read-only
// per-timeline view is the public node page itself).
const ctxInput = z.object({ timelineId: z.string(), nodeId: z.string() })

export const getEntityContext = createServerFn({ method: 'GET' })
  .inputValidator((d: z.infer<typeof ctxInput>) => ctxInput.parse(d))
  .handler(async ({ data }): Promise<EntityContextResult> => {
    const user = await getCurrentUser()
    const node = db
      .select({ entityId: nodes.entityId, timelineId: nodes.timelineId })
      .from(nodes)
      .where(and(eq(nodes.id, data.nodeId), eq(nodes.timelineId, data.timelineId)))
      .get()
    if (!node?.entityId) return { status: 'none' }
    const entity = db.select({ ownerId: entities.ownerId }).from(entities).where(eq(entities.id, node.entityId)).get()
    if (!entity) return { status: 'none' }
    // Aggregation + controls are owner-only.
    if (!user || entity.ownerId !== user.id) return { status: 'forbidden' }
    const hist = entityHistoryState(node.entityId)
    return {
      status: 'ok',
      entityId: node.entityId,
      placements: placementsOf(node.entityId),
      canUndo: hist.canUndo,
      canRedo: hist.canRedo,
    }
  })

// Search the owner's entities to place an existing one on a timeline (the canvas
// "add existing entity" picker). Excludes entities already placed on
// `excludeTimelineId` so the picker only offers genuinely new placements.
const searchInput = z.object({ q: z.string(), excludeTimelineId: z.string().optional() })

export const searchEntities = createServerFn({ method: 'GET' })
  .inputValidator((d: z.infer<typeof searchInput>) => searchInput.parse(d))
  .handler(async ({ data }): Promise<EntitySearchHit[]> => {
    const user = await requireUser()
    const q = data.q.trim()
    const rows = db
      .select({ id: entities.id, type: entities.type, title: entities.title, summary: entities.summary })
      .from(entities)
      .where(
        q
          ? and(eq(entities.ownerId, user.id), like(entities.title, `%${q}%`))
          : eq(entities.ownerId, user.id),
      )
      .orderBy(desc(entities.updatedAt))
      .limit(20)
      .all()
    if (rows.length === 0) return []
    // Which of these are already on the target timeline → so the picker can skip them.
    const exclude = new Set<string>()
    if (data.excludeTimelineId) {
      for (const r of db
        .select({ e: nodes.entityId })
        .from(nodes)
        .where(eq(nodes.timelineId, data.excludeTimelineId))
        .all())
        if (r.e) exclude.add(r.e)
    }
    return rows
      .filter((r) => !exclude.has(r.id))
      .map((r) => ({ entityId: r.id, type: r.type, title: r.title, summary: r.summary }))
  })

// Place an existing entity on a timeline (owner-scoped on BOTH the timeline and the
// entity — fail-closed). A graph Patch (undoable via the canvas ⌘Z), like add_node.
// No-ops to the existing placement if the entity is already on this timeline.
const placeInput = z.object({ timelineId: z.string(), entityId: z.string(), lane: z.string().optional() })

export const placeEntityOnTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof placeInput>) => placeInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const meta = getTimelineMeta(data.timelineId)
    if (!meta || meta.ownerId !== user.id) return { ok: false as const, error: 'forbidden: not your timeline' }
    const entity: EntityRow | undefined = db.select().from(entities).where(eq(entities.id, data.entityId)).get()
    if (!entity || entity.ownerId !== user.id) return { ok: false as const, error: 'forbidden: not your entity' }
    // Already placed here? Return the existing placement (idempotent).
    const existing = db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.timelineId, data.timelineId), eq(nodes.entityId, data.entityId)))
      .get()
    if (existing) return { ok: true as const, nodeId: existing.id, patchId: null }

    const builder = new PatchBuilder(data.timelineId, loadGraph(data.timelineId), user.id)
    const node = builder.placeEntity(entity, { lane: data.lane ?? null })
    const patchId = commitPatch(data.timelineId, builder, `Place: ${entity.title}`)
    return { ok: true as const, nodeId: node.id, patchId }
  })

// Per-entity content undo/redo (the separate stack). Owner-scoped.
const entityIdInput = z.object({ entityId: z.string() })

async function assertOwnsEntity(entityId: string): Promise<void> {
  const user = await requireUser()
  const e = db.select({ ownerId: entities.ownerId }).from(entities).where(eq(entities.id, entityId)).get()
  if (!e || e.ownerId !== user.id) throw new Error('forbidden: not your entity')
}

export const undoEntityFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof entityIdInput>) => entityIdInput.parse(d))
  .handler(async ({ data }) => {
    await assertOwnsEntity(data.entityId)
    undoEntity(data.entityId)
    return entityHistoryState(data.entityId)
  })

export const redoEntityFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof entityIdInput>) => entityIdInput.parse(d))
  .handler(async ({ data }) => {
    await assertOwnsEntity(data.entityId)
    redoEntity(data.entityId)
    return entityHistoryState(data.entityId)
  })
