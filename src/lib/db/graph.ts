import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { timelines, nodes, edges, type NodeRow, type EdgeRow, type TimelineRow } from './schema'
import type { TimelineTheme, TimelineViewSettings } from '~/lib/domain/types'

export type Graph = { nodes: NodeRow[]; edges: EdgeRow[] }

// Lightweight ownership/visibility view of a timeline (no graph payload).
export type TimelineMeta = {
  id: string
  title: string
  ownerId: string | null
  isPublic: boolean
  viewSettings: TimelineViewSettings | null
  theme: TimelineTheme | null
}

// Create the timeline row if it doesn't exist yet, owned by `ownerId`. Used by the
// MCP apply_patch path (build-as-you-go). Existing rows are left untouched.
export function ensureTimeline(id: string, ownerId: string, title = 'Untitled timeline'): void {
  db.insert(timelines).values({ id, title, ownerId }).onConflictDoNothing().run()
}

// --- timeline CRUD (multi-timeline, per-owner) ----------------------------

// A single owner's timelines, newest first.
export function listTimelines(ownerId: string): TimelineRow[] {
  return db
    .select()
    .from(timelines)
    .where(eq(timelines.ownerId, ownerId))
    .orderBy(desc(timelines.createdAt))
    .all()
}

export function createTimeline(title: string, ownerId: string): TimelineRow {
  return db.insert(timelines).values({ title, ownerId, isPublic: false }).returning().get()
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
      isPublic: timelines.isPublic,
      viewSettings: timelines.viewSettings,
      theme: timelines.theme,
    })
    .from(timelines)
    .where(eq(timelines.id, id))
    .get()
  return row ?? null
}

// True when `userId` may VIEW the timeline: it's public, or they own it.
export function canView(meta: TimelineMeta, userId: string | null): boolean {
  return meta.isPublic || (userId != null && meta.ownerId === userId)
}

export function getTimelineTitle(id: string): string {
  return db.select({ title: timelines.title }).from(timelines).where(eq(timelines.id, id)).get()?.title ?? 'Timeline'
}

export function loadGraph(timelineId: string): Graph {
  return {
    nodes: db.select().from(nodes).where(eq(nodes.timelineId, timelineId)).all(),
    edges: db.select().from(edges).where(eq(edges.timelineId, timelineId)).all(),
  }
}
