import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from './index'
import { stories, storySegments, nodes } from './schema'
import type { DepthTier, PovType, SegmentKind, StoryDTO } from '~/lib/domain/types'

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
    })),
  }
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
