import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './index'
import { stories, storySegments, nodes } from './schema'
import type { Citation } from './schema'
import type { DepthTier, PovType, SegmentKind, StoryDTO, StoryListItem } from '~/lib/domain/types'

// The story layer hangs off `nodes.id` (a "moment"). Stories are deliberately NOT
// graph Patches — they have their own provenance and are NOT on the undo/redo
// stack — so everything here uses its own transaction and never touches `patches`
// (see the story-layer note in schema.ts).

// A beat as accepted from the MCP write_story tool (already validated upstream).
export type NewStorySegment = {
  bodyText: string
  kind?: SegmentKind
  settingNote?: string | null
  relatedNodeIds?: string[]
  focusNodeId?: string | null
  citations?: Citation[]
}

export type NewStory = {
  title: string
  hook?: string | null
  povType?: PovType
  depthTier?: DepthTier
  estimatedMinutes?: number | null
}

// The timeline a moment (node) belongs to, or null if the node doesn't exist.
// write_story takes a momentId, so it needs this to run the same owner check the
// other MCP tools key off a timelineId.
export function getMomentTimelineId(momentId: string): string | null {
  return db.select({ t: nodes.timelineId }).from(nodes).where(eq(nodes.id, momentId)).get()?.t ?? null
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'story'

// Write one story onto a moment, REPLACING any existing story on it (S1 = one
// story per moment, so re-calling is idempotent). One transaction inserting a
// `stories` row + N ordered `story_segments` rows; no `patches` row, no undo
// entry. The slug is globally unique (schema constraint), so it carries a random
// suffix.
export function writeStory(
  momentId: string,
  meta: NewStory,
  segments: NewStorySegment[],
): { storyId: string; segmentCount: number } {
  let storyId = ''
  db.transaction((tx) => {
    // Replace: cascade drops the previous story's segments.
    tx.delete(stories).where(eq(stories.momentId, momentId)).run()
    const inserted = tx
      .insert(stories)
      .values({
        momentId,
        slug: `${slugify(meta.title)}-${crypto.randomUUID().slice(0, 8)}`,
        title: meta.title,
        hook: meta.hook ?? null,
        povType: meta.povType ?? 'omniscient',
        depthTier: meta.depthTier ?? 'light',
        estimatedMinutes: meta.estimatedMinutes ?? null,
        status: 'published',
      })
      .returning({ id: stories.id })
      .get()
    storyId = inserted!.id
    segments.forEach((s, i) => {
      tx.insert(storySegments)
        .values({
          storyId,
          sequence: i,
          kind: s.kind ?? 'narration',
          bodyText: s.bodyText,
          settingNote: s.settingNote ?? null,
          relatedNodeIds: s.relatedNodeIds ?? null,
          focusNodeId: s.focusNodeId ?? null,
          citations: s.citations ?? null,
        })
        .run()
    })
  })
  return { storyId, segmentCount: segments.length }
}

// The story attached to a moment as a client-serializable DTO (beats ordered by
// sequence), or null if it has none. Backs the node-detail playback reader.
export function getStoryForMoment(momentId: string): StoryDTO | null {
  const story = db
    .select()
    .from(stories)
    .where(eq(stories.momentId, momentId))
    .orderBy(desc(stories.createdAt))
    .limit(1)
    .get()
  if (!story) return null
  const segs = db
    .select()
    .from(storySegments)
    .where(eq(storySegments.storyId, story.id))
    .orderBy(asc(storySegments.sequence))
    .all()
  return {
    id: story.id,
    title: story.title,
    hook: story.hook,
    povType: story.povType,
    depthTier: story.depthTier,
    estimatedMinutes: story.estimatedMinutes,
    beats: segs.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      kind: s.kind,
      bodyText: s.bodyText,
      settingNote: s.settingNote,
      relatedNodeIds: s.relatedNodeIds ?? [],
      focusNodeId: s.focusNodeId ?? null,
      citations: s.citations ?? [],
    })),
  }
}

// All stories on a timeline, in chronological moment order — backs the AppBar's
// "Stories" dropdown. One row per story (S1 = one story per moment) with its moment
// title + a beat count, so the menu reads without N+1 round-trips.
export function listStoriesForTimeline(timelineId: string): StoryListItem[] {
  const rows = db
    .select({
      momentId: stories.momentId,
      momentTitle: nodes.title,
      storyId: stories.id,
      title: stories.title,
      hook: stories.hook,
      depthTier: stories.depthTier,
    })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(eq(nodes.timelineId, timelineId))
    .orderBy(asc(nodes.startInstant))
    .all()
  if (rows.length === 0) return []
  const counts = new Map<string, number>()
  for (const r of db
    .select({ storyId: storySegments.storyId, n: sql<number>`count(*)` })
    .from(storySegments)
    .where(inArray(storySegments.storyId, rows.map((r) => r.storyId)))
    .groupBy(storySegments.storyId)
    .all())
    counts.set(r.storyId, Number(r.n))
  return rows.map((r) => ({
    momentId: r.momentId,
    momentTitle: r.momentTitle,
    storyId: r.storyId,
    title: r.title,
    hook: r.hook,
    depthTier: r.depthTier,
    beatCount: counts.get(r.storyId) ?? 0,
  }))
}

// A cheap content signature over the stories attached to these moments. Because
// writeStory REPLACES the row (minting a new story id) on every call, the signature
// changes on any write/rewrite — even a same-depth one the depth badge can't see.
// The canvas threads this through the graph poll so a separate-process (stdio)
// story write refreshes an already-open reader within the polling interval.
export function storyVersionForMoments(momentIds: string[]): string {
  if (momentIds.length === 0) return ''
  const rows = db
    .select({ id: stories.id, momentId: stories.momentId, updatedAt: stories.updatedAt })
    .from(stories)
    .where(inArray(stories.momentId, momentIds))
    .all()
  return rows
    .map((r) => `${r.momentId}:${r.id}:${r.updatedAt?.getTime() ?? 0}`)
    .sort()
    .join('|')
}

// Which of the given moments have a story, and at what depth — one query, for the
// canvas depth badge. Map presence = "has a story".
export function storyDepthByMoment(momentIds: string[]): Map<string, DepthTier> {
  const out = new Map<string, DepthTier>()
  if (momentIds.length === 0) return out
  const rows = db
    .select({ momentId: stories.momentId, depthTier: stories.depthTier })
    .from(stories)
    .where(inArray(stories.momentId, momentIds))
    .all()
  for (const r of rows) out.set(r.momentId, r.depthTier)
  return out
}
