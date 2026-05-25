import { eq, desc } from 'drizzle-orm'
import { db } from './index'
import { timelines, nodes, edges, messages, type NodeRow, type EdgeRow, type TimelineRow } from './schema'

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

// Cascades to the timeline's nodes/edges/patches/sessions (FK onDelete: 'cascade').
// Messages go first: their session_id FK was added via ALTER (no ON DELETE
// cascade), so deleting sessions while messages still reference them can fail.
export function deleteTimeline(id: string): void {
  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.timelineId, id)).run()
    tx.delete(timelines).where(eq(timelines.id, id)).run()
  })
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
