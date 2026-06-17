import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './index'
import { stories, storySegments, storyArtifacts, segmentCitations, artifacts, nodes, entities, timelines } from './schema'
import type { Citation } from './schema'
import type {
  DepthTier,
  HomeStoryCard,
  PovType,
  SegmentKind,
  StoryBeatCitation,
  StoryBeatWidget,
  StoryCastMember,
  StoryDTO,
  StoryImage,
  StoryLens,
  StoryListItem,
  StoryStatus,
  TimelineTheme,
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
  lens?: StoryLens | null
  citations?: Citation[]
  artifactCitations?: { artifactId: string; excerptUsed?: string | null }[]
  image?: StoryImage | null
  widget?: StoryBeatWidget | null
}

export type NewStory = {
  title: string
  hook?: string | null
  povType?: PovType
  depthTier?: DepthTier
  estimatedMinutes?: number | null
  coverImage?: StoryImage | null
  cast?: StoryCastMember[]
  // The story's own visual theme (replace-on-write; null/absent clears it so the
  // story inherits the timeline's theme at read time).
  theme?: TimelineTheme | null
  // Optional explicit public slug (seeds/tests pin a deterministic share URL).
  // Applied only on CREATE; an update never rewrites an existing story's slug so
  // a shared /s/$slug link stays stable. Must be globally unique.
  slug?: string
}

// The timeline a moment (node) belongs to, or null if the node doesn't exist.
// write_story takes a momentId, so it needs this to run the same owner check the
// other MCP tools key off a timelineId.
export function getMomentTimelineId(momentId: string): string | null {
  return db.select({ t: nodes.timelineId }).from(nodes).where(eq(nodes.id, momentId)).get()?.t ?? null
}

// The timeline a story belongs to (via its moment), or null. Used to run the same
// owner check + live-event channel the timeline-scoped tools use.
export function getStoryTimelineId(storyId: string): string | null {
  return (
    db
      .select({ t: nodes.timelineId })
      .from(stories)
      .innerJoin(nodes, eq(stories.momentId, nodes.id))
      .where(eq(stories.id, storyId))
      .get()?.t ?? null
  )
}

// Owner-scoped: replace a story's OWN theme (null clears it → inherits the
// timeline's). Ownership is resolved through the story's moment → timeline.ownerId,
// mirroring setTimelineTheme. Returns false (a no-op) when the story isn't the
// caller's, so callers can surface a clean forbidden instead of leaking a write.
export function setStoryTheme(storyId: string, ownerId: string, theme: TimelineTheme | null): boolean {
  const owner = db
    .select({ ownerId: timelines.ownerId })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(eq(stories.id, storyId))
    .get()
  if (!owner || owner.ownerId !== ownerId) return false
  db.update(stories).set({ theme, updatedAt: new Date() }).where(eq(stories.id, storyId)).run()
  return true
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
          theme: meta.theme ?? null,
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
          slug: meta.slug ?? `${slugify(meta.title)}-${crypto.randomUUID().slice(0, 8)}`,
          title: meta.title,
          hook: meta.hook ?? null,
          povType: meta.povType ?? 'omniscient',
          depthTier: meta.depthTier ?? 'light',
          estimatedMinutes: meta.estimatedMinutes ?? null,
          coverImage: meta.coverImage ?? null,
          cast: meta.cast ?? null,
          theme: meta.theme ?? null,
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
          lens: s.lens ?? null,
          citations: s.citations ?? null,
          image: s.image ?? null,
          widget: s.widget ?? null,
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
    slug: story.slug,
    momentId: story.momentId,
    title: story.title,
    hook: story.hook,
    povType: story.povType,
    depthTier: story.depthTier,
    estimatedMinutes: story.estimatedMinutes,
    coverImage: story.coverImage ?? null,
    cast: story.cast ?? [],
    theme: story.theme ?? null,
    isPublic: story.isPublic,
    beats: segs.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      kind: s.kind,
      bodyText: s.bodyText,
      settingNote: s.settingNote,
      relatedNodeIds: s.relatedNodeIds ?? [],
      focusNodeId: s.focusNodeId ?? null,
      lens: s.lens ?? null,
      // Single-home merge: inline one-offs + artifact-backed citations (Decision 8).
      citations: [...(s.citations ?? []), ...(artifactCitesBySeg.get(s.id) ?? [])],
      image: s.image ?? null,
      widget: s.widget ?? null,
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

// Resolve a story by its public slug → the DTO (which carries the story's own
// isPublic) plus the moment + status + updatedAt the share loader needs to gate and
// timestamp the page. The server fn applies the visibility gate (the STORY must be
// public — per-story, independent of its timeline); this is pure data access.
export function getStoryBySlug(
  slug: string,
): { story: StoryDTO; momentId: string; status: StoryStatus; updatedAt: number } | null {
  const row = db.select().from(stories).where(eq(stories.slug, slug)).get()
  if (!row) return null
  return { story: hydrateStory(row), momentId: row.momentId, status: row.status, updatedAt: row.updatedAt?.getTime() ?? 0 }
}

// Owner-scoped per-story share toggle. Resolves the owner through the story's
// moment → timeline, then flips stories.isPublic. Returns the slug (for building
// the /s/$slug link) on success, or null when the story is missing or isn't the
// caller's. INDEPENDENT of timelines.isPublic — sharing a story never touches the
// timeline, and making a timeline private never hides an already-shared story.
export function setStoryShared(
  storyId: string,
  ownerId: string,
  isPublic: boolean,
): { slug: string } | null {
  const row = db
    .select({ slug: stories.slug, ownerId: timelines.ownerId })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(eq(stories.id, storyId))
    .get()
  if (!row || row.ownerId !== ownerId) return null
  db.update(stories).set({ isPublic, updatedAt: new Date() }).where(eq(stories.id, storyId)).run()
  return { slug: row.slug }
}

// Every node id a story references through its cast, per-beat focus/related links,
// and widgets — so the public loader ships exactly the nodes the page will render.
export function referencedNodeIds(story: StoryDTO): string[] {
  const ids = new Set<string>()
  for (const m of story.cast) if (m.nodeId) ids.add(m.nodeId)
  for (const b of story.beats) {
    if (b.focusNodeId) ids.add(b.focusNodeId)
    for (const id of b.relatedNodeIds) ids.add(id)
    if (b.widget) {
      for (const id of b.widget.nodeIds) ids.add(id)
      if (b.widget.focusNodeId) ids.add(b.widget.focusNodeId)
    }
  }
  return [...ids]
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
  // ADR 0004 R8: the moment's title is canonical on its entity — resolve through it
  // (fall back to the node cache for bare/legacy nodes). Every query using these
  // columns LEFT JOINs `entities` on nodes.entityId.
  momentTitle: sql<string>`coalesce(${entities.title}, ${nodes.title})`.as('momentTitle'),
  storyId: stories.id,
  slug: stories.slug,
  title: stories.title,
  hook: stories.hook,
  depthTier: stories.depthTier,
  povType: stories.povType,
  estimatedMinutes: stories.estimatedMinutes,
  // Cover art for the Stories-view card (the only list consumer that renders it;
  // the AppBar dropdown ignores it). JSON column → StoryImage | null.
  coverImage: stories.coverImage,
  // Per-story public state, so the Share dialog can show + toggle each story.
  isPublic: stories.isPublic,
} as const

// All stories on a timeline, in chronological moment order — backs the AppBar's
// "Stories" dropdown. One row per story (a moment may have several) with its moment
// title + meta + a beat count, so the menu reads without N+1 round-trips.
export function listStoriesForTimeline(timelineId: string): StoryListItem[] {
  const rows = db
    .select(STORY_LIST_COLUMNS)
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .leftJoin(entities, eq(nodes.entityId, entities.id))
    .where(eq(nodes.timelineId, timelineId))
    .orderBy(asc(nodes.startInstant), asc(stories.createdAt))
    .all()
  return withBeatCounts(rows)
}

// Every story the OWNER has across ALL their timelines (optionally narrowed to one
// project), newest-`updatedAt`-first — backs the cinematic home's hero + "Your
// stories" row. Owner-scope is the security boundary (joined through the timeline's
// ownerId); `projectId` is an organizational filter WITHIN the owner (D10), so a
// foreign/unowned project simply matches nothing. One grouped beat-count follow-up
// query keeps it free of N+1s. Returns [] when the owner has no stories in scope.
export function listStoriesForHome(ownerId: string, projectId?: string): HomeStoryCard[] {
  const rows = db
    .select({
      ...STORY_LIST_COLUMNS,
      cast: stories.cast,
      timelineId: timelines.id,
      timelineTitle: timelines.title,
      updatedAt: stories.updatedAt,
    })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .leftJoin(entities, eq(nodes.entityId, entities.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(
      projectId
        ? and(eq(timelines.ownerId, ownerId), eq(timelines.projectId, projectId))
        : eq(timelines.ownerId, ownerId),
    )
    .orderBy(desc(stories.updatedAt))
    .all()
  // Resolve every node-backed cast member's display name in one batched node-title
  // lookup (the home ships no cast nodes, so the hero chips need pre-resolved names).
  const castNodeIds = new Set<string>()
  for (const r of rows) for (const m of r.cast ?? []) if (m.nodeId) castNodeIds.add(m.nodeId)
  const titleById = new Map<string, string>()
  if (castNodeIds.size > 0)
    // R8: resolve cast names through the entity (fall back to the node cache).
    for (const n of db
      .select({ id: nodes.id, title: sql<string>`coalesce(${entities.title}, ${nodes.title})` })
      .from(nodes)
      .leftJoin(entities, eq(nodes.entityId, entities.id))
      .where(inArray(nodes.id, [...castNodeIds]))
      .all())
      titleById.set(n.id, n.title)
  return withBeatCounts(rows).map(({ cast, updatedAt, ...rest }) => ({
    ...rest,
    updatedAt: updatedAt?.getTime() ?? 0,
    castNames: (cast ?? [])
      .map((m) => (m.nodeId ? titleById.get(m.nodeId) : m.name) ?? m.name ?? '')
      .filter((s): s is string => Boolean(s)),
  }))
}

// Every story attached to a single moment (newest first) — backs the entity
// panel's per-moment story list. Same shape as the timeline-wide dropdown rows.
export function getStoriesForMoment(momentId: string): StoryListItem[] {
  const rows = db
    .select(STORY_LIST_COLUMNS)
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .leftJoin(entities, eq(nodes.entityId, entities.id))
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
