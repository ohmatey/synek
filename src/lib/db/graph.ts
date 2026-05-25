import { and, desc, eq, ne } from 'drizzle-orm'
import { db } from './index'
import { timelines, nodes, edges, stories, type NodeRow, type EdgeRow, type TimelineRow } from './schema'

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

// Per-moment story affordance for the canvas: count of live (non-archived)
// stories + the most-recent hook. Scoped to the timeline by joining moment→node.
export function momentStoryInfo(
  timelineId: string,
): Map<string, { storyCount: number; topHook: string | null }> {
  const rows = db
    .select({ momentId: stories.momentId, hook: stories.hook })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(and(eq(nodes.timelineId, timelineId), ne(stories.status, 'archived')))
    .orderBy(desc(stories.createdAt)) // newest first → first row per moment is the live hook
    .all()
  const map = new Map<string, { storyCount: number; topHook: string | null }>()
  for (const r of rows) {
    const cur = map.get(r.momentId)
    if (cur) {
      cur.storyCount += 1
      if (!cur.topHook && r.hook) cur.topHook = r.hook
    } else {
      map.set(r.momentId, { storyCount: 1, topHook: r.hook ?? null })
    }
  }
  return map
}
