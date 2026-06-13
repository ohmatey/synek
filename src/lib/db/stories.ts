import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './index'
import { stories, storySegments, storyArtifacts, segmentCitations, artifacts, nodes } from './schema'
import type { Citation } from './schema'
import type {
  DepthTier,
  PovType,
  SegmentKind,
  StoryBeatCitation,
  StoryCastMember,
  StoryDTO,
  StoryImage,
  StoryListItem,
} from '~/lib/domain/types'

// The story layer hangs off `nodes.id` (a "moment"). Stories are deliberately NOT
// graph Patches — they have their own provenance and are NOT on the undo/redo
// stack — so everything here uses its own transaction and never touches `patches`
// (see the story-layer note in schema.ts).

// A beat as accepted from the MCP write_story tool (already validated upstream).
// Citations are single-home (ADR 0001, Decision 8): `citations` holds unregistered
// one-off mentions (→ inline JSON); `artifactCitations` references registered
// artifacts by id (→ segment_citations join). The server pre-validates artifactIds
// (unknown ones are dropped to warnings), so what arrives here is safe to write.
export type NewStorySegment = {
  bodyText: string
  kind?: SegmentKind
  settingNote?: string | null
  relatedNodeIds?: string[]
  focusNodeId?: string | null
  citations?: Citation[]
  artifactCitations?: { artifactId: string; excerptUsed?: string | null }[]
  image?: StoryImage | null
}

export type NewStory = {
  title: string
  hook?: string | null
  povType?: PovType
  depthTier?: DepthTier
  estimatedMinutes?: number | null
  coverImage?: StoryImage | null
  cast?: StoryCastMember[]
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

// Write a story onto a moment. A moment can hold SEVERAL stories. Without
// `opts.storyId` this CREATES a new story; with one (that belongs to the moment)
// it UPDATES that story in place — replacing its meta + segments — so a re-run is
// idempotent against a known id. One transaction writes the `stories` row + N
// ordered `story_segments` rows; no `patches` row, no undo entry. The slug is
// globally unique (schema constraint), so a new story carries a random suffix.
export function writeStory(
  momentId: string,
  meta: NewStory,
  segments: NewStorySegment[],
  opts?: { storyId?: string },
): { storyId: string; segmentCount: number } {
  let storyId = ''
  db.transaction((tx) => {
    const existing = opts?.storyId
      ? tx.select({ id: stories.id }).from(stories).where(and(eq(stories.id, opts.storyId), eq(stories.momentId, momentId))).get()
      : undefined
    if (existing) {
      // Update in place: refresh meta, then swap the segment set.
      storyId = existing.id
      tx.update(stories)
        .set({
          title: meta.title,
          hook: meta.hook ?? null,
          povType: meta.povType ?? 'omniscient',
          depthTier: meta.depthTier ?? 'light',
          estimatedMinutes: meta.estimatedMinutes ?? null,
          coverImage: meta.coverImage ?? null,
          cast: meta.cast ?? null,
          updatedAt: new Date(),
        })
        .where(eq(stories.id, storyId))
        .run()
      tx.delete(storySegments).where(eq(storySegments.storyId, storyId)).run()
    } else {
      // Create a new story on the moment (leaves any existing stories untouched).
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
          coverImage: meta.coverImage ?? null,
          cast: meta.cast ?? null,
          status: 'published',
        })
        .returning({ id: stories.id })
        .get()
      storyId = inserted!.id
    }
    // Replace-in-place deletes the old segments above (cascading their
    // segment_citations via FK); story_artifacts is story-level, so clear it here.
    tx.delete(storyArtifacts).where(eq(storyArtifacts.storyId, storyId)).run()
    const referencedArtifacts = new Set<string>()
    segments.forEach((s, i) => {
      const seg = tx
        .insert(storySegments)
        .values({
          storyId,
          sequence: i,
          kind: s.kind ?? 'narration',
          bodyText: s.bodyText,
          settingNote: s.settingNote ?? null,
          relatedNodeIds: s.relatedNodeIds ?? null,
          focusNodeId: s.focusNodeId ?? null,
          citations: s.citations ?? null,
          image: s.image ?? null,
        })
        .returning({ id: storySegments.id })
        .get()!
      // Artifact-backed citations → segment_citations (the single home for them).
      for (const ac of s.artifactCitations ?? []) {
        tx.insert(segmentCitations)
          .values({ segmentId: seg.id, artifactId: ac.artifactId, excerptUsed: ac.excerptUsed ?? null })
          .onConflictDoNothing()
          .run()
        referencedArtifacts.add(ac.artifactId)
      }
    })
    // The story references every artifact any of its beats cite (deduped).
    for (const artifactId of referencedArtifacts) {
      tx.insert(storyArtifacts)
        .values({ storyId, artifactId, relationship: 'referenced' })
        .onConflictDoNothing()
        .run()
    }
  })
  return { storyId, segmentCount: segments.length }
}

// Hydrate a `stories` row + its ordered segments into a client DTO. Shared by the
// by-moment (latest) and by-id readers.
function hydrateStory(story: typeof stories.$inferSelect): StoryDTO {
  const segs = db
    .select()
    .from(storySegments)
    .where(eq(storySegments.storyId, story.id))
    .orderBy(asc(storySegments.sequence))
    .all()
  // Artifact-backed citations (segment_citations ⨝ artifacts), grouped by segment,
  // projected into the beat-citation shape so the reader renders them identically
  // (title from the artifact) and the S2.4 card has the artifact fields it needs.
  const artifactCitesBySeg = new Map<string, StoryBeatCitation[]>()
  if (segs.length) {
    const rows = db
      .select({
        segmentId: segmentCitations.segmentId,
        excerptUsed: segmentCitations.excerptUsed,
        artifactId: artifacts.id,
        title: artifacts.title,
        sourceType: artifacts.sourceType,
        reliability: artifacts.reliability,
        transcript: artifacts.transcript,
        translation: artifacts.translation,
        imageUrl: artifacts.imageUrl,
      })
      .from(segmentCitations)
      .innerJoin(artifacts, eq(segmentCitations.artifactId, artifacts.id))
      .where(
        inArray(
          segmentCitations.segmentId,
          segs.map((s) => s.id),
        ),
      )
      .all()
    for (const r of rows) {
      const list = artifactCitesBySeg.get(r.segmentId) ?? []
      list.push({
        title: r.title,
        quote: r.excerptUsed ?? undefined,
        sourceType: r.sourceType ?? undefined,
        artifactId: r.artifactId,
        reliability: r.reliability ?? undefined,
        transcript: r.transcript,
        translation: r.translation,
        imageUrl: r.imageUrl,
      })
      artifactCitesBySeg.set(r.segmentId, list)
    }
  }
  return {
    id: story.id,
    momentId: story.momentId,
    title: story.title,
    hook: story.hook,
    povType: story.povType,
    depthTier: story.depthTier,
    estimatedMinutes: story.estimatedMinutes,
    coverImage: story.coverImage ?? null,
    cast: story.cast ?? [],
    beats: segs.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      kind: s.kind,
      bodyText: s.bodyText,
      settingNote: s.settingNote,
      relatedNodeIds: s.relatedNodeIds ?? [],
      focusNodeId: s.focusNodeId ?? null,
      // Single-home merge: inline one-offs + artifact-backed citations (Decision 8).
      citations: [...(s.citations ?? []), ...(artifactCitesBySeg.get(s.id) ?? [])],
      image: s.image ?? null,
    })),
  }
}

// The latest story attached to a moment as a client-serializable DTO, or null if
// it has none. A moment may hold several; this returns the most recent (used by
// the legacy single-story getStory RPC).
export function getStoryForMoment(momentId: string): StoryDTO | null {
  const story = db
    .select()
    .from(stories)
    .where(eq(stories.momentId, momentId))
    .orderBy(desc(stories.createdAt))
    .limit(1)
    .get()
  return story ? hydrateStory(story) : null
}

// A specific story by id as a client DTO (beats ordered by sequence), or null.
// Backs the docked reader, which opens an exact story chosen from the panel list.
export function getStoryById(storyId: string): StoryDTO | null {
  const story = db.select().from(stories).where(eq(stories.id, storyId)).get()
  return story ? hydrateStory(story) : null
}

// Attach per-story beat counts to a set of story rows in one grouped query.
function withBeatCounts<T extends { storyId: string }>(rows: T[]): (T & { beatCount: number })[] {
  if (rows.length === 0) return []
  const counts = new Map<string, number>()
  for (const r of db
    .select({ storyId: storySegments.storyId, n: sql<number>`count(*)` })
    .from(storySegments)
    .where(inArray(storySegments.storyId, rows.map((r) => r.storyId)))
    .groupBy(storySegments.storyId)
    .all())
    counts.set(r.storyId, Number(r.n))
  return rows.map((r) => ({ ...r, beatCount: counts.get(r.storyId) ?? 0 }))
}

const STORY_LIST_COLUMNS = {
  momentId: stories.momentId,
  momentTitle: nodes.title,
  storyId: stories.id,
  title: stories.title,
  hook: stories.hook,
  depthTier: stories.depthTier,
  povType: stories.povType,
  estimatedMinutes: stories.estimatedMinutes,
  // Cover art for the Stories-view card (the only list consumer that renders it;
  // the AppBar dropdown ignores it). JSON column → StoryImage | null.
  coverImage: stories.coverImage,
} as const

// All stories on a timeline, in chronological moment order — backs the AppBar's
// "Stories" dropdown. One row per story (a moment may have several) with its moment
// title + meta + a beat count, so the menu reads without N+1 round-trips.
export function listStoriesForTimeline(timelineId: string): StoryListItem[] {
  const rows = db
    .select(STORY_LIST_COLUMNS)
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(eq(nodes.timelineId, timelineId))
    .orderBy(asc(nodes.startInstant), asc(stories.createdAt))
    .all()
  return withBeatCounts(rows)
}

// Every story attached to a single moment (newest first) — backs the entity
// panel's per-moment story list. Same shape as the timeline-wide dropdown rows.
export function getStoriesForMoment(momentId: string): StoryListItem[] {
  const rows = db
    .select(STORY_LIST_COLUMNS)
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(eq(stories.momentId, momentId))
    .orderBy(desc(stories.createdAt))
    .all()
  return withBeatCounts(rows)
}

// Every beat citation across a timeline's stories — feeds the layout report's
// source registry so story sourcing counts alongside node citations.
export function listSegmentCitationsForTimeline(timelineId: string): Citation[] {
  const rows = db
    .select({ citations: storySegments.citations })
    .from(storySegments)
    .innerJoin(stories, eq(storySegments.storyId, stories.id))
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(eq(nodes.timelineId, timelineId))
    .all()
  const inline = rows.flatMap((r) => r.citations ?? [])
  // Artifact-backed citations count too (single-home: they live only in the join).
  const fromArtifacts = db
    .select({ title: artifacts.title, sourceType: artifacts.sourceType })
    .from(segmentCitations)
    .innerJoin(artifacts, eq(segmentCitations.artifactId, artifacts.id))
    .innerJoin(storySegments, eq(segmentCitations.segmentId, storySegments.id))
    .innerJoin(stories, eq(storySegments.storyId, stories.id))
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(eq(nodes.timelineId, timelineId))
    .all()
  return [...inline, ...fromArtifacts.map((a) => ({ title: a.title, sourceType: a.sourceType ?? undefined }))]
}

// A cheap content signature over the stories attached to these moments. Each story
// row's id + updatedAt folds in, so the signature shifts on any create/update/delete
// — even a same-depth rewrite the depth badge can't see. The canvas threads this
// through the graph poll so a separate-process (stdio) story write refreshes an
// already-open reader within the polling interval.
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
// canvas depth badge. Map presence = "has a story"; when a moment holds several
// stories, the DEEPEST wins so the badge reflects its richest story.
export function storyDepthByMoment(momentIds: string[]): Map<string, DepthTier> {
  const out = new Map<string, DepthTier>()
  if (momentIds.length === 0) return out
  const rows = db
    .select({ momentId: stories.momentId, depthTier: stories.depthTier })
    .from(stories)
    .where(inArray(stories.momentId, momentIds))
    .all()
  for (const r of rows) {
    if (r.depthTier === 'deep' || !out.has(r.momentId)) out.set(r.momentId, r.depthTier)
  }
  return out
}
