import { and, asc, count, desc, eq, max } from 'drizzle-orm'
import { db } from './index'
import { entities, entityPatches, nodes, type EntityOp, type EntityRow } from './schema'
import { emitTimelineEvent } from '~/lib/server/bus'
import { maxAppliedSeq } from './patches'

// The SEPARATE, per-entity undo stack for shared-entity CONTENT edits (ADR 0004).
// Independent of the per-timeline graph `patches`/⌘Z stack: an entity edit
// propagates to every placement (the loadGraph overlay), so its history can't
// live on any one timeline. Mirrors db/patches.ts machinery, keyed by entityId+seq.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The content fields an entity edit may touch — never placement/lane.
export type EntityContentPatch = Partial<
  Pick<EntityRow, 'type' | 'title' | 'summary' | 'startInstant' | 'endInstant' | 'precision' | 'metadata'>
>

function applyEntityOp(tx: Tx, entityId: string, op: EntityOp): void {
  // Bump updatedAt on every content write so "last edited" is honest.
  tx.update(entities)
    .set({ ...op.after, updatedAt: new Date() })
    .where(eq(entities.id, entityId))
    .run()
}

function invertEntityOp(op: EntityOp): EntityOp {
  return { kind: 'update_entity', before: op.after, after: op.before }
}

// Every timeline that currently shows this entity (R10/R11) — the set to
// invalidate + emit to after a content edit propagates.
function affectedTimelines(entityId: string): string[] {
  return Array.from(
    new Set(
      db
        .select({ t: nodes.timelineId })
        .from(nodes)
        .where(eq(nodes.entityId, entityId))
        .all()
        .map((r) => r.t),
    ),
  )
}

// R10/R11: tell every timeline holding a placement to refetch, stamping the event
// with that timeline's own maxAppliedSeq (NOT the entity seq — different keyspace)
// so an SSE client's Last-Event-ID never rewinds below a real patch.
function notifyAffected(entityId: string): void {
  for (const timelineId of affectedTimelines(entityId)) {
    emitTimelineEvent({ timelineId, kind: 'patch', seq: maxAppliedSeq(timelineId) })
  }
}

// Commit one entity content edit as a Patch on the entity's own stack. Returns the
// patch id (or null for a no-op), plus the affected timeline ids for cache
// invalidation by the caller.
export function commitEntityPatch(
  entityId: string,
  patch: EntityContentPatch,
  summary: string,
): { patchId: string | null; timelineIds: string[] } {
  const cur = db.select().from(entities).where(eq(entities.id, entityId)).get()
  if (!cur) return { patchId: null, timelineIds: [] }
  const ownerId = cur.ownerId
  const before: EntityContentPatch = {}
  const after: EntityContentPatch = {}
  let changed = false
  for (const key of Object.keys(patch) as (keyof EntityContentPatch)[]) {
    const next = patch[key]
    if (JSON.stringify(next) === JSON.stringify(cur[key])) continue
    ;(before as Record<string, unknown>)[key] = cur[key]
    ;(after as Record<string, unknown>)[key] = next
    changed = true
  }
  if (!changed) return { patchId: null, timelineIds: affectedTimelines(entityId) }

  const op: EntityOp = { kind: 'update_entity', before, after }
  let patchId: string | null = null
  db.transaction((tx) => {
    applyEntityOp(tx, entityId, op)
    tx.delete(entityPatches)
      .where(and(eq(entityPatches.entityId, entityId), eq(entityPatches.status, 'undone')))
      .run()
    const top = tx
      .select({ m: max(entityPatches.seq) })
      .from(entityPatches)
      .where(eq(entityPatches.entityId, entityId))
      .get()
    const seq = (top?.m ?? 0) + 1
    const inserted = tx
      .insert(entityPatches)
      .values({ entityId, ownerId, seq, summary, ops: [op], inverseOps: [invertEntityOp(op)], status: 'applied' })
      .returning({ id: entityPatches.id })
      .get()
    patchId = inserted?.id ?? null
  })
  notifyAffected(entityId)
  return { patchId, timelineIds: affectedTimelines(entityId) }
}

export function undoEntity(entityId: string): { ok: boolean; timelineIds: string[] } {
  const p = db
    .select()
    .from(entityPatches)
    .where(and(eq(entityPatches.entityId, entityId), eq(entityPatches.status, 'applied')))
    .orderBy(desc(entityPatches.seq))
    .limit(1)
    .get()
  if (!p) return { ok: false, timelineIds: affectedTimelines(entityId) }
  db.transaction((tx) => {
    for (const op of p.inverseOps) applyEntityOp(tx, entityId, op)
    tx.update(entityPatches).set({ status: 'undone' }).where(eq(entityPatches.id, p.id)).run()
  })
  notifyAffected(entityId)
  return { ok: true, timelineIds: affectedTimelines(entityId) }
}

export function redoEntity(entityId: string): { ok: boolean; timelineIds: string[] } {
  const p = db
    .select()
    .from(entityPatches)
    .where(and(eq(entityPatches.entityId, entityId), eq(entityPatches.status, 'undone')))
    .orderBy(asc(entityPatches.seq))
    .limit(1)
    .get()
  if (!p) return { ok: false, timelineIds: affectedTimelines(entityId) }
  db.transaction((tx) => {
    for (const op of p.ops) applyEntityOp(tx, entityId, op)
    tx.update(entityPatches).set({ status: 'applied' }).where(eq(entityPatches.id, p.id)).run()
  })
  notifyAffected(entityId)
  return { ok: true, timelineIds: affectedTimelines(entityId) }
}

export function entityHistoryState(entityId: string): { canUndo: boolean; canRedo: boolean } {
  const applied =
    db
      .select({ c: count() })
      .from(entityPatches)
      .where(and(eq(entityPatches.entityId, entityId), eq(entityPatches.status, 'applied')))
      .get()?.c ?? 0
  const undone = db
    .select({ id: entityPatches.id })
    .from(entityPatches)
    .where(and(eq(entityPatches.entityId, entityId), eq(entityPatches.status, 'undone')))
    .limit(1)
    .get()
  return { canUndo: applied > 0, canRedo: !!undone }
}
