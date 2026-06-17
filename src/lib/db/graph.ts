import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './index'
import {
  timelines,
  nodes,
  edges,
  entities,
  type NodeRow,
  type EdgeRow,
  type EntityRow,
  type NodeMetadata,
  type TimelineRow,
} from './schema'
import { ensureDefaultProject, getProjectMeta } from './projects'
import type {
  GraphNode,
  TimelineTheme,
  TimelineViewSettings,
} from '~/lib/domain/types'

export type Graph = { nodes: NodeRow[]; edges: EdgeRow[] }

// Lightweight ownership/visibility view of a timeline (no graph payload).
// `projectId` carries the container so theme inheritance (D5) can resolve the
// project's theme at read time when the timeline has none of its own.
export type TimelineMeta = {
  id: string
  title: string
  ownerId: string | null
  projectId: string | null
  isPublic: boolean
  viewSettings: TimelineViewSettings | null
  theme: TimelineTheme | null
}

// Create the timeline row if it doesn't exist yet, owned by `ownerId`. Used by the
// MCP apply_patch path (build-as-you-go). Existing rows are left untouched.
// Always sets projectId so the "every timeline has a project" invariant holds at
// the write path (D7) — resolve the owner's default project when none is given.
export function ensureTimeline(id: string, ownerId: string, title = 'Untitled timeline', projectId?: string): void {
  db.insert(timelines)
    .values({ id, title, ownerId, projectId: projectId ?? ensureDefaultProject(ownerId) })
    .onConflictDoNothing()
    .run()
}

// --- timeline CRUD (multi-timeline, per-owner) ----------------------------

// A single owner's timelines, newest first. Pass `projectId` to narrow to one
// project (organizational filter WITHIN the owner — owner-scope is still the
// security boundary); omit it to return all the owner's timelines (D10).
export function listTimelines(ownerId: string, projectId?: string): TimelineRow[] {
  return db
    .select()
    .from(timelines)
    .where(
      projectId ? and(eq(timelines.ownerId, ownerId), eq(timelines.projectId, projectId)) : eq(timelines.ownerId, ownerId),
    )
    .orderBy(desc(timelines.createdAt))
    .all()
}

// Always sets projectId (D7 write-path invariant): resolve the owner's default
// project when none is supplied. The caller is trusted to have own-checked the
// project (server fn / MCP ctx) — this layer takes ids.
export function createTimeline(title: string, ownerId: string, projectId?: string): TimelineRow {
  return db
    .insert(timelines)
    .values({ title, ownerId, projectId: projectId ?? ensureDefaultProject(ownerId), isPublic: false })
    .returning()
    .get()
}

// Owner-scoped: a non-owner's call no-ops (0 rows matched).
export function renameTimeline(id: string, title: string, ownerId: string): void {
  db.update(timelines)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(timelines.id, id), eq(timelines.ownerId, ownerId)))
    .run()
}

// Cascades to the timeline's nodes/edges/patches (FK onDelete: 'cascade').
// Owner-scoped: a non-owner's call no-ops.
export function deleteTimeline(id: string, ownerId: string): void {
  db.delete(timelines).where(and(eq(timelines.id, id), eq(timelines.ownerId, ownerId))).run()
}

// Owner-scoped reassignment of a timeline to a different project (the move-to-
// project affordance, local-126). Sets timelines.project_id; a non-owner's call
// no-ops (0 rows matched — the `ownerId` predicate). NOT a Patch (ADR 0002 D9 —
// project membership is metadata, never on the undo stack). The caller MUST have
// own-checked BOTH the timeline (this predicate) and the target project
// (requireOwnedProject in the server fn) — this layer takes ids and trusts its
// guarded caller, so it does NOT verify the target project's owner here.
export function moveTimelineToProject(id: string, ownerId: string, projectId: string): void {
  db.update(timelines)
    .set({ projectId, updatedAt: new Date() })
    .where(and(eq(timelines.id, id), eq(timelines.ownerId, ownerId)))
    .run()
}

// Owner-scoped public toggle.
export function setTimelinePublic(id: string, ownerId: string, isPublic: boolean): void {
  db.update(timelines)
    .set({ isPublic, updatedAt: new Date() })
    .where(and(eq(timelines.id, id), eq(timelines.ownerId, ownerId)))
    .run()
}

// Owner-scoped: persist the timeline's default time-axis scale.
export function setTimelineView(id: string, ownerId: string, view: TimelineViewSettings): void {
  db.update(timelines)
    .set({ viewSettings: view, updatedAt: new Date() })
    .where(and(eq(timelines.id, id), eq(timelines.ownerId, ownerId)))
    .run()
}

// Owner-scoped: replace the timeline's theme wholesale; null clears it back to
// the brand-default look. A non-owner's call no-ops (0 rows matched).
export function setTimelineTheme(id: string, ownerId: string, theme: TimelineTheme | null): void {
  db.update(timelines)
    .set({ theme, updatedAt: new Date() })
    .where(and(eq(timelines.id, id), eq(timelines.ownerId, ownerId)))
    .run()
}

// Ownership/visibility metadata for one timeline, or null if it doesn't exist.
export function getTimelineMeta(id: string): TimelineMeta | null {
  const row = db
    .select({
      id: timelines.id,
      title: timelines.title,
      ownerId: timelines.ownerId,
      projectId: timelines.projectId,
      isPublic: timelines.isPublic,
      viewSettings: timelines.viewSettings,
      theme: timelines.theme,
    })
    .from(timelines)
    .where(eq(timelines.id, id))
    .get()
  return row ?? null
}

// Theme inheritance (ADR 0002 D5), resolved at READ time, drift-free: a timeline's
// own theme wins; absent it, the project's theme; absent both, null (the canvas
// applies the brand-default tokens). Inheritance is a fallback, NOT a write-time
// copy — re-theming a project re-themes its non-overriding timelines automatically.
// Fed to the renderer (getGraph + the MCP read tools); the raw timeline.theme stays
// available on TimelineMeta for editing ("read the current theme to tweak it").
export function resolveTimelineTheme(meta: TimelineMeta): TimelineTheme | null {
  if (meta.theme) return meta.theme
  if (meta.projectId) return getProjectMeta(meta.projectId)?.theme ?? null
  return null
}

// True when `userId` may VIEW the timeline: it's public, or they own it.
export function canView(meta: TimelineMeta, userId: string | null): boolean {
  return meta.isPublic || (userId != null && meta.ownerId === userId)
}

export function getTimelineTitle(id: string): string {
  return db.select({ title: timelines.title }).from(timelines).where(eq(timelines.id, id)).get()?.title ?? 'Timeline'
}

// ADR 0004 R8/R9 — resolve a placement's CONTENT from its canonical entity (when
// linked), falling back to the node's own cached columns when `entityId` is null
// (legacy/test bare nodes). `lane`/`laneHint` are per-placement and ALWAYS stay
// from the node; only content fields (title/summary/dates/precision/type +
// content metadata) come from the entity. This is the single overlay every read
// path uses so the canvas, the MCP tools, and the public story page never serve
// stale cache after an entity edit propagates.
function resolveContent(node: NodeRow, entity: EntityRow | undefined): NodeRow {
  if (!entity) return node
  let metadata: NodeMetadata | null = entity.metadata ? { ...entity.metadata } : null
  const lane = node.metadata?.lane
  if (lane != null) metadata = { ...(metadata ?? {}), lane }
  else if (metadata) delete metadata.lane
  return {
    ...node, // id, timelineId, entityId, laneHint, createdAt
    type: entity.type,
    title: entity.title,
    summary: entity.summary,
    startInstant: entity.startInstant,
    endInstant: entity.endInstant,
    precision: entity.precision,
    metadata,
  }
}

// Batch the entity overlay for a set of placement rows (one query for all linked
// entities). Bare nodes (null entityId) pass through unchanged.
export function overlayEntities(rows: NodeRow[]): NodeRow[] {
  const ids = Array.from(new Set(rows.map((r) => r.entityId).filter((x): x is string => !!x)))
  if (ids.length === 0) return rows
  const byId = new Map<string, EntityRow>()
  for (const e of db.select().from(entities).where(inArray(entities.id, ids)).all()) byId.set(e.id, e)
  return rows.map((r) => resolveContent(r, r.entityId ? byId.get(r.entityId) : undefined))
}

export function loadGraph(timelineId: string): Graph {
  return {
    nodes: overlayEntities(db.select().from(nodes).where(eq(nodes.timelineId, timelineId)).all()),
    edges: db.select().from(edges).where(eq(edges.timelineId, timelineId)).all(),
  }
}

// A stored node row → the serializable client GraphNode DTO. The single mapper
// for the canvas RPC (getGraph) and the public story loader, so they never drift.
// `hasStory`/`storyDepth` default off — callers that drive the depth badge override
// them from a stories query.
export function nodeRowToGraphNode(n: NodeRow): GraphNode {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    summary: n.summary,
    startInstant: n.startInstant,
    endInstant: n.endInstant,
    precision: n.precision,
    citations: n.metadata?.citations ?? [],
    images: n.metadata?.images ?? [],
    size: n.metadata?.size ?? 'medium',
    color: n.metadata?.color ?? null,
    subtype: n.metadata?.subtype ?? null,
    lane: n.metadata?.lane ?? null,
    location: n.metadata?.location ?? null,
    lat: n.metadata?.lat ?? null,
    lng: n.metadata?.lng ?? null,
    geoScope: n.metadata?.geoScope ?? null,
    hasStory: false,
    storyDepth: null,
  }
}

// The subset of a timeline's nodes named by `ids` (the nodes a public story's
// cast / focus / widgets reference) — so the share page ships only what it renders.
export function nodesByIds(timelineId: string, ids: string[]): NodeRow[] {
  if (ids.length === 0) return []
  // R12: this bypasses loadGraph, so apply the same entity overlay.
  return overlayEntities(
    db
      .select()
      .from(nodes)
      .where(and(eq(nodes.timelineId, timelineId), inArray(nodes.id, ids)))
      .all(),
  )
}
