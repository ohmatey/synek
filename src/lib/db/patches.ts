import { and, asc, count, desc, eq, max } from 'drizzle-orm'
import { db } from './index'
import {
  nodes,
  edges,
  patches,
  type NodeRow,
  type EdgeRow,
  type NodeMetadata,
  type GraphOp,
} from './schema'
import type { NodeType, EdgeKind, Precision } from '~/lib/domain/types'
import { emitTimelineEvent } from '~/lib/server/bus'

// Tool-facing inputs (already normalized: dates parsed to instants upstream).
export type NewNode = {
  type: NodeType
  title: string
  summary?: string | null
  startInstant: number
  endInstant?: number | null
  precision: Precision
  metadata?: NodeMetadata | null
}
export type NodePatch = Partial<
  Pick<NodeRow, 'type' | 'title' | 'summary' | 'startInstant' | 'endInstant' | 'precision' | 'metadata'>
>
export type NewEdge = { sourceId: string; targetId: string; kind: EdgeKind; label?: string | null }
export type EdgePatch = Partial<Pick<EdgeRow, 'kind' | 'label'>>

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// --- apply / invert -------------------------------------------------------

// createdAt survives a JSON round-trip in patches.ops as a string, so coerce
// back to a Date before re-inserting (timestamp_ms mode expects a Date).
function applyOp(tx: Tx, op: GraphOp): void {
  switch (op.kind) {
    case 'add_node':
      tx.insert(nodes).values({ ...op.node, createdAt: new Date(op.node.createdAt) }).run()
      break
    case 'update_node':
      tx.update(nodes).set(op.after).where(eq(nodes.id, op.id)).run()
      break
    case 'delete_node':
      tx.delete(nodes).where(eq(nodes.id, op.node.id)).run() // edges cascade
      break
    case 'add_edge':
      tx.insert(edges).values({ ...op.edge, createdAt: new Date(op.edge.createdAt) }).run()
      break
    case 'update_edge':
      tx.update(edges).set(op.after).where(eq(edges.id, op.id)).run()
      break
    case 'delete_edge':
      tx.delete(edges).where(eq(edges.id, op.edge.id)).run()
      break
  }
}

function invertOp(op: GraphOp): GraphOp[] {
  switch (op.kind) {
    case 'add_node':
      return [{ kind: 'delete_node', node: op.node, edges: [] }]
    case 'update_node':
      return [{ kind: 'update_node', id: op.id, before: op.after, after: op.before }]
    case 'delete_node':
      return [
        { kind: 'add_node', node: op.node },
        ...op.edges.map((edge): GraphOp => ({ kind: 'add_edge', edge })),
      ]
    case 'add_edge':
      return [{ kind: 'delete_edge', edge: op.edge }]
    case 'update_edge':
      return [{ kind: 'update_edge', id: op.id, before: op.after, after: op.before }]
    case 'delete_edge':
      return [{ kind: 'add_edge', edge: op.edge }]
  }
}

// Undo = apply inverses in reverse order.
export function invertOps(ops: GraphOp[]): GraphOp[] {
  return ops.slice().reverse().flatMap(invertOp)
}

// --- PatchBuilder ---------------------------------------------------------

// Accumulates a turn's mutations over an in-memory view of the graph — nothing
// touches the DB until commitPatch(). Lets the AI add a node then reference it.
export class PatchBuilder {
  readonly ops: GraphOp[] = []
  private nodeView = new Map<string, NodeRow>()
  private edgeView = new Map<string, EdgeRow>()

  constructor(
    private readonly timelineId: string,
    graph: { nodes: NodeRow[]; edges: EdgeRow[] },
  ) {
    for (const n of graph.nodes) this.nodeView.set(n.id, n)
    for (const e of graph.edges) this.edgeView.set(e.id, e)
  }

  // Current view of a node (includes ops applied earlier this turn) — lets a
  // tool merge into existing metadata rather than clobbering it.
  getNode(id: string): NodeRow | undefined {
    return this.nodeView.get(id)
  }

  addNode(input: NewNode): NodeRow {
    const node: NodeRow = {
      id: crypto.randomUUID(),
      timelineId: this.timelineId,
      type: input.type,
      title: input.title,
      summary: input.summary ?? null,
      startInstant: input.startInstant,
      endInstant: input.endInstant ?? null,
      precision: input.precision,
      laneHint: null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    }
    this.ops.push({ kind: 'add_node', node })
    this.nodeView.set(node.id, node)
    return node
  }

  updateNode(id: string, patch: NodePatch): boolean {
    const cur = this.nodeView.get(id)
    if (!cur) return false
    const before: NodePatch = {}
    for (const key of Object.keys(patch) as (keyof NodePatch)[]) {
      ;(before as Record<string, unknown>)[key] = cur[key]
    }
    this.ops.push({ kind: 'update_node', id, before, after: { ...patch } })
    this.nodeView.set(id, { ...cur, ...patch })
    return true
  }

  deleteNode(id: string): boolean {
    const node = this.nodeView.get(id)
    if (!node) return false
    const connected = [...this.edgeView.values()].filter((e) => e.sourceId === id || e.targetId === id)
    this.ops.push({ kind: 'delete_node', node, edges: connected })
    this.nodeView.delete(id)
    for (const e of connected) this.edgeView.delete(e.id)
    return true
  }

  addEdge(input: NewEdge): EdgeRow | { error: string } {
    if (!this.nodeView.has(input.sourceId)) return { error: `sourceId ${input.sourceId} not found` }
    if (!this.nodeView.has(input.targetId)) return { error: `targetId ${input.targetId} not found` }
    const edge: EdgeRow = {
      id: crypto.randomUUID(),
      timelineId: this.timelineId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      kind: input.kind,
      label: input.label ?? null,
      metadata: null,
      createdAt: new Date(),
    }
    this.ops.push({ kind: 'add_edge', edge })
    this.edgeView.set(edge.id, edge)
    return edge
  }

  updateEdge(id: string, patch: EdgePatch): boolean {
    const cur = this.edgeView.get(id)
    if (!cur) return false
    const before: EdgePatch = {}
    for (const key of Object.keys(patch) as (keyof EdgePatch)[]) {
      ;(before as Record<string, unknown>)[key] = cur[key]
    }
    this.ops.push({ kind: 'update_edge', id, before, after: { ...patch } })
    this.edgeView.set(id, { ...cur, ...patch })
    return true
  }

  deleteEdge(id: string): boolean {
    const edge = this.edgeView.get(id)
    if (!edge) return false
    this.ops.push({ kind: 'delete_edge', edge })
    this.edgeView.delete(id)
    return true
  }
}

// --- commit / undo / redo -------------------------------------------------

// One user turn = one atomic Patch. Applies the ops, truncates the redo branch,
// and records forward + inverse ops. Returns the patch id (or null if empty).
export function commitPatch(timelineId: string, builder: PatchBuilder, summary: string): string | null {
  if (builder.ops.length === 0) return null
  const ops = builder.ops
  const inverseOps = invertOps(ops)
  let patchId: string | null = null
  let committedSeq = 0
  db.transaction((tx) => {
    for (const op of ops) applyOp(tx, op)
    // A new action truncates any redo branch.
    tx.delete(patches).where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'undone'))).run()
    const top = tx
      .select({ m: max(patches.seq) })
      .from(patches)
      .where(eq(patches.timelineId, timelineId))
      .get()
    const seq = (top?.m ?? 0) + 1
    const inserted = tx
      .insert(patches)
      .values({ timelineId, seq, summary, ops, inverseOps, status: 'applied' })
      .returning({ id: patches.id })
      .get()
    patchId = inserted?.id ?? null
    committedSeq = seq
  })
  // Notify live viewers AFTER the txn commits, so we never push on a rollback.
  if (patchId) emitTimelineEvent({ timelineId, kind: 'patch', seq: committedSeq })
  return patchId
}

export function undo(timelineId: string): boolean {
  const p = db
    .select()
    .from(patches)
    .where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'applied')))
    .orderBy(desc(patches.seq))
    .limit(1)
    .get()
  if (!p) return false
  db.transaction((tx) => {
    for (const op of p.inverseOps) applyOp(tx, op)
    tx.update(patches).set({ status: 'undone' }).where(eq(patches.id, p.id)).run()
  })
  emitTimelineEvent({ timelineId, kind: 'undo', seq: p.seq })
  return true
}

export function redo(timelineId: string): boolean {
  const p = db
    .select()
    .from(patches)
    .where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'undone')))
    .orderBy(asc(patches.seq))
    .limit(1)
    .get()
  if (!p) return false
  db.transaction((tx) => {
    for (const op of p.ops) applyOp(tx, op)
    tx.update(patches).set({ status: 'applied' }).where(eq(patches.id, p.id)).run()
  })
  emitTimelineEvent({ timelineId, kind: 'redo', seq: p.seq })
  return true
}

// Highest applied patch seq on a timeline (0 if none). Used by the SSE route's
// catch-up replay and to stamp non-patch live events (e.g. stories) with a seq
// that never rewinds a client's Last-Event-ID below a real patch.
export function maxAppliedSeq(timelineId: string): number {
  return (
    db
      .select({ m: max(patches.seq) })
      .from(patches)
      .where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'applied')))
      .get()?.m ?? 0
  )
}

export function historyState(timelineId: string): {
  canUndo: boolean
  canRedo: boolean
  appliedCount: number
} {
  const appliedCount =
    db
      .select({ c: count() })
      .from(patches)
      .where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'applied')))
      .get()?.c ?? 0
  const undone = db
    .select({ id: patches.id })
    .from(patches)
    .where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'undone')))
    .limit(1)
    .get()
  return { canUndo: appliedCount > 0, canRedo: !!undone, appliedCount }
}
