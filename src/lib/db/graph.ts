import { desc, eq } from 'drizzle-orm'
import { db } from './index'
import { timelines, nodes, edges, type NodeRow, type EdgeRow, type TimelineRow } from './schema'

export type Graph = { nodes: NodeRow[]; edges: EdgeRow[] }

// Create the timeline row if it doesn't exist yet (Phase 0 uses a single 'default').
export function ensureTimeline(id: string, title = 'Untitled timeline'): void {
  db.insert(timelines).values({ id, title }).onConflictDoNothing().run()
}

// --- timeline CRUD (multi-timeline) ---------------------------------------

export function listTimelines(): TimelineRow[] {
  return db.select().from(timelines).orderBy(desc(timelines.createdAt)).all()
}

export function createTimeline(title: string): TimelineRow {
  return db.insert(timelines).values({ title }).returning().get()
}

export function renameTimeline(id: string, title: string): void {
  db.update(timelines).set({ title, updatedAt: new Date() }).where(eq(timelines.id, id)).run()
}

// Cascades to the timeline's nodes/edges/patches (FK onDelete: 'cascade').
export function deleteTimeline(id: string): void {
  db.delete(timelines).where(eq(timelines.id, id)).run()
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
