import { and, asc, count, desc, eq, inArray, max } from 'drizzle-orm'
import { db } from './index'
import {
  nodes,
  edges,
  patches,
  stories,
  storySegments,
  storyArtifacts,
  momentArtifacts,
  segmentCitations,
  type NodeRow,
  type EdgeRow,
  type NodeMetadata,
  type GraphOp,
  type StorySnapshot,
  type MomentArtifactRow,
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

// --- story snapshots (undo across the FK cascade) -------------------------

// Stories live outside the Patch engine and cascade on node delete (see schema.ts).
// So a delete_node would drop the moment's stories irreversibly. We snapshot them
// just BEFORE the delete and bake them into the matching restore (add_node) op, so
// undo re-inserts them. A moment can hold SEVERAL stories — capture them all.
function readStorySnapshots(tx: Tx, momentId: string): StorySnapshot[] {
  const rows = tx
    .select()
    .from(stories)
    .where(eq(stories.momentId, momentId))
    .orderBy(asc(stories.createdAt))
    .all()
  return rows.map((story) => {
    const segments = tx
      .select()
      .from(storySegments)
      .where(eq(storySegments.storyId, story.id))
      .orderBy(asc(storySegments.sequence))
      .all()
    // Capture the join rows that cascade with the story (ADR 0001 two-site undo):
    // story_artifacts off the story, segment_citations off each segment (grouped
    // by segmentId so restore can pair them to the beat it re-inserts).
    const artifactsForStory = tx.select().from(storyArtifacts).where(eq(storyArtifacts.storyId, story.id)).all()
    const citationsBySegment: Record<string, (typeof segmentCitations.$inferSelect)[]> = {}
    if (segments.length) {
      const segIds = segments.map((s) => s.id)
      for (const c of tx.select().from(segmentCitations).where(inArray(segmentCitations.segmentId, segIds)).all()) {
        ;(citationsBySegment[c.segmentId] ??= []).push(c)
      }
    }
    return { story, segments, storyArtifacts: artifactsForStory, segmentCitations: citationsBySegment }
  })
}

// Snapshot the stories of every moment a delete_node op will remove, keyed by node
// id (only moments that actually have stories land in the map). MUST run before the
// ops are applied — once a delete commits, the cascade has already dropped the rows.
function captureStories(tx: Tx, ops: GraphOp[]): Map<string, StorySnapshot[]> {
  const out = new Map<string, StorySnapshot[]>()
  for (const op of ops) {
    if (op.kind === 'delete_node') {
      const snaps = readStorySnapshots(tx, op.node.id)
      if (snaps.length) out.set(op.node.id, snaps)
    }
  }
  return out
}

// Bake captured snapshots onto the add_node ops that restore those moments, matched
// by node id. Returns a new op list (originals untouched).
function attachStories(ops: GraphOp[], snapshots: Map<string, StorySnapshot[]>): GraphOp[] {
  if (snapshots.size === 0) return ops
  return ops.map((op) =>
    op.kind === 'add_node' && snapshots.has(op.node.id)
      ? { ...op, stories: snapshots.get(op.node.id)! }
      : op,
  )
}

// Re-insert a captured story + segments alongside a restored node. createdAt/updatedAt
// survive the patches JSON round-trip as numbers, so coerce back to Date (timestamp_ms).
// FK order: story → segments (+ each segment's citations) → story_artifacts. The
// referenced artifacts always survive a node delete (only the join rows cascade),
// so the artifactId FKs resolve on restore. Joins have no timestamps to coerce.
// `?? []`/`?? {}` guards legacy patch rows captured before the join fields existed.
function restoreStory(tx: Tx, snap: StorySnapshot): void {
  tx.insert(stories)
    .values({
      ...snap.story,
      createdAt: new Date(snap.story.createdAt),
      updatedAt: new Date(snap.story.updatedAt),
    })
    .run()
  const citationsBySegment = snap.segmentCitations ?? {}
  for (const seg of snap.segments) {
    tx.insert(storySegments).values({ ...seg, createdAt: new Date(seg.createdAt) }).run()
    const cites = citationsBySegment[seg.id]
    if (cites?.length) tx.insert(segmentCitations).values(cites).run()
  }
  if (snap.storyArtifacts?.length) tx.insert(storyArtifacts).values(snap.storyArtifacts).run()
}

// Restore every story baked onto a restore (add_node) op. Accepts both the current
// `stories` array and the legacy single `story` on older patch rows.
function restoreStories(tx: Tx, op: Extract<GraphOp, { kind: 'add_node' }>): void {
  const snaps = op.stories ?? (op.story ? [op.story] : [])
  for (const snap of snaps) restoreStory(tx, snap)
}

// --- moment_artifacts (node-side undo capture) ----------------------------
// moment_artifacts hangs off the NODE, not a story, and cascades on delete_node
// even when the moment has no story. So it's captured separately from stories and
// baked onto the same restore (add_node) op (ADR 0001 two-site undo capture).
function captureMomentArtifacts(tx: Tx, ops: GraphOp[]): Map<string, MomentArtifactRow[]> {
  const out = new Map<string, MomentArtifactRow[]>()
  for (const op of ops) {
    if (op.kind === 'delete_node') {
      const links = tx.select().from(momentArtifacts).where(eq(momentArtifacts.momentId, op.node.id)).all()
      if (links.length) out.set(op.node.id, links)
    }
  }
  return out
}

function attachMomentArtifacts(ops: GraphOp[], map: Map<string, MomentArtifactRow[]>): GraphOp[] {
  if (map.size === 0) return ops
  return ops.map((op) =>
    op.kind === 'add_node' && map.has(op.node.id) ? { ...op, momentArtifacts: map.get(op.node.id)! } : op,
  )
}

// Re-insert the moment's artifact links alongside a restored node (the artifacts
// themselves always survive — only the join cascaded — so the FKs resolve).
function restoreMomentArtifacts(tx: Tx, op: Extract<GraphOp, { kind: 'add_node' }>): void {
  const links = op.momentArtifacts ?? []
  if (links.length) tx.insert(momentArtifacts).values(links).run()
}

// --- apply / invert -------------------------------------------------------

// createdAt survives a JSON round-trip in patches.ops as a string, so coerce
// back to a Date before re-inserting (timestamp_ms mode expects a Date).
function applyOp(tx: Tx, op: GraphOp): void {
  switch (op.kind) {
    case 'add_node':
      tx.insert(nodes).values({ ...op.node, createdAt: new Date(op.node.createdAt) }).run()
      // Restore the moment's stories + artifact links too, if this add_node is the
      // inverse of a delete (both ride along on the op; no-ops otherwise).
      restoreStories(tx, op)
      restoreMomentArtifacts(tx, op)
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
  let patchId: string | null = null
  let committedSeq = 0
  db.transaction((tx) => {
    // Snapshot the story + artifact links of any moment this patch deletes BEFORE
    // the cascade drops them, and bake them onto the delete's inverse (an add_node)
    // so undo restores them. Both captures MUST precede the apply loop.
    let inverseOps = attachStories(invertOps(ops), captureStories(tx, ops))
    inverseOps = attachMomentArtifacts(inverseOps, captureMomentArtifacts(tx, ops))
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
    // Undoing the patch that CREATED a moment deletes it (inverse of add_node is a
    // delete_node), cascading any story written *after* the patch committed. Snapshot
    // it first and persist it onto the forward add_node, so a later redo restores it.
    const captured = captureStories(tx, p.inverseOps)
    const capturedMA = captureMomentArtifacts(tx, p.inverseOps)
    for (const op of p.inverseOps) applyOp(tx, op)
    const next =
      captured.size > 0 || capturedMA.size > 0
        ? { status: 'undone' as const, ops: attachMomentArtifacts(attachStories(p.ops, captured), capturedMA) }
        : { status: 'undone' as const }
    tx.update(patches).set(next).where(eq(patches.id, p.id)).run()
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
