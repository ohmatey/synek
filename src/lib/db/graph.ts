import { eq } from 'drizzle-orm'
import { db } from './index'
import { timelines, nodes, edges, type NodeRow, type EdgeRow } from './schema'

export type Graph = { nodes: NodeRow[]; edges: EdgeRow[] }

// Create the timeline row if it doesn't exist yet (Phase 0 uses a single 'default').
export function ensureTimeline(id: string, title = 'Untitled timeline'): void {
  db.insert(timelines).values({ id, title }).onConflictDoNothing().run()
}

export function loadGraph(timelineId: string): Graph {
  return {
    nodes: db.select().from(nodes).where(eq(nodes.timelineId, timelineId)).all(),
    edges: db.select().from(edges).where(eq(edges.timelineId, timelineId)).all(),
  }
}
