import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, nodes, entities } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch, undo } from '../src/lib/db/patches'
import { commitEntityPatch, undoEntity, redoEntity } from '../src/lib/db/entity-patches'

// Proves ADR 0004 end-to-end at the data layer: one canonical entity placed on TWO
// timelines, a content edit that PROPAGATES to both, the per-entity undo stack, and
// delete-keeps-the-shared-entity. Run under Node: `bun run verify:entities`.

const A = 'verify-ent-a'
const B = 'verify-ent-b'
const EMAIL = 'verify-ent@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: 'verify-password-123', name: 'VerifyEnt' } })
  } catch {
    /* exists */
  }
  return db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL)).get()!.id
}

function titleOnTimeline(tl: string, entityId: string): string | undefined {
  return loadGraph(tl).nodes.find((n) => n.entityId === entityId)?.title
}

async function main() {
  const ownerId = await ensureUser()
  ensureTimeline(A, ownerId, 'Entity verify A')
  ensureTimeline(B, ownerId, 'Entity verify B')
  // Clean slate.
  db.delete(nodes).where(eq(nodes.timelineId, A)).run()
  db.delete(nodes).where(eq(nodes.timelineId, B)).run()

  // 1) Create a node on A — add_node co-creates the canonical entity.
  const builder = new PatchBuilder(A, loadGraph(A), ownerId)
  const node = builder.addNode({ type: 'entity', title: 'Ada Lovelace', startInstant: 0, precision: 'year' })
  commitPatch(A, builder, 'add Ada')
  const entityId = node.entityId!
  assert(!!entityId, 'add_node co-created an entity (node.entityId set)')
  assert(!!db.select().from(entities).where(eq(entities.id, entityId)).get(), 'entity row exists')

  // 2) Place the SAME entity on B (Slice-3 place_entity is simulated here by a raw
  // placement insert referencing the shared entity).
  db.insert(nodes)
    .values({ id: randomUUID(), timelineId: B, entityId, type: 'entity', title: 'Ada Lovelace', startInstant: 0, precision: 'year' })
    .run()
  assert(titleOnTimeline(A, entityId) === 'Ada Lovelace' && titleOnTimeline(B, entityId) === 'Ada Lovelace', 'entity appears on BOTH timelines')

  // 3) Edit the shared content → it PROPAGATES to every placement via the overlay.
  const { patchId } = commitEntityPatch(entityId, { title: 'Augusta Ada King' }, 'rename')
  assert(!!patchId, 'entity content edit committed to the per-entity stack')
  assert(titleOnTimeline(A, entityId) === 'Augusta Ada King', 'edit propagated to timeline A')
  assert(titleOnTimeline(B, entityId) === 'Augusta Ada King', 'edit propagated to timeline B')

  // 4) Undo on the entity stack reverts BOTH; redo re-applies.
  undoEntity(entityId)
  assert(titleOnTimeline(A, entityId) === 'Ada Lovelace' && titleOnTimeline(B, entityId) === 'Ada Lovelace', 'entity undo reverts every placement')
  redoEntity(entityId)
  assert(titleOnTimeline(A, entityId) === 'Augusta Ada King' && titleOnTimeline(B, entityId) === 'Augusta Ada King', 'entity redo re-applies to every placement')

  // 5) Delete the A placement → the entity SURVIVES (still on B). D9 / delete=placement-only.
  const del = new PatchBuilder(A, loadGraph(A), ownerId)
  del.deleteNode(node.id)
  commitPatch(A, del, 'remove A placement')
  assert(titleOnTimeline(A, entityId) === undefined, 'placement removed from A')
  assert(!!db.select().from(entities).where(eq(entities.id, entityId)).get(), 'shared entity survives the placement delete')
  assert(titleOnTimeline(B, entityId) === 'Augusta Ada King', 'entity still renders on B')

  // 6) place_entity op: place the shared entity on a THIRD timeline via the graph
  // patch path, then undo — the inverse must remove ONLY the placement (the entity
  // is shared with B, must survive). R3/R4/R5.
  const C = 'verify-ent-c'
  ensureTimeline(C, ownerId, 'Entity verify C')
  db.delete(nodes).where(eq(nodes.timelineId, C)).run()
  const placeB = new PatchBuilder(C, loadGraph(C), ownerId)
  const entityRow = db.select().from(entities).where(eq(entities.id, entityId)).get()!
  placeB.placeEntity(entityRow)
  commitPatch(C, placeB, 'place on C')
  assert(titleOnTimeline(C, entityId) === 'Augusta Ada King', 'place_entity put the shared entity on C')
  undo(C)
  assert(titleOnTimeline(C, entityId) === undefined, 'undo removed the C placement')
  assert(!!db.select().from(entities).where(eq(entities.id, entityId)).get(), 'place_entity undo did NOT delete the shared entity (still on B)')

  console.log('\nShared-entity (ADR 0004) data path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
