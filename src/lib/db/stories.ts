import { and, asc, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import { db } from './index'
import { stories, storySegments, storyArtifacts, storyPatches, segmentCitations, artifacts, nodes, entities, timelines, storySeries } from './schema'
import type { Citation, ChapterEditSnapshot } from './schema'
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
  // Create-time status override (default 'published' — today's behavior). A series
  // with `reviewMode` ON forces new chapters to 'draft' server-side, REGARDLESS of
  // this value (safety beats the caller, local-175). On UPDATE, status is left
  // untouched unless explicitly set here (a plain re-write never demotes a chapter).
  status?: StoryStatus
  // Serialized stories (ADR 0006): make this story a CHAPTER of a series. The
  // registry resolves the final chapterNumber (appendToSeries → next number) and
  // passes both here; writeStory just persists them. On UPDATE they're applied only
  // when provided, so a plain re-write of a chapter never drops its series membership.
  seriesId?: string | null
  chapterNumber?: number | null
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

// Owner-scoped: set (or clear, null) the brand a story references. Ownership resolved
// through moment → timeline.ownerId, like setStoryTheme. Returns false (no-op) when
// the story isn't the caller's. The brand's own-check is the caller's responsibility
// (the server applyBrandToStory own-checks the brand before calling this).
export function setStoryBrand(storyId: string, ownerId: string, brandId: string | null): boolean {
  const owner = db
    .select({ ownerId: timelines.ownerId })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(eq(stories.id, storyId))
    .get()
  if (!owner || owner.ownerId !== ownerId) return false
  db.update(stories).set({ brandId, updatedAt: new Date() }).where(eq(stories.id, storyId)).run()
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
): { storyId: string; segmentCount: number; created: boolean; status: StoryStatus } {
  let storyId = ''
  // Whether this call CREATED a new chapter (vs updated one in place) and its final
  // status — the on-publish notification (local-160) fires only for a NEW chapter
  // born `published`; a re-write of an existing chapter is handled by patch_story.
  let created = false
  let status: StoryStatus = 'published'
  db.transaction((tx) => {
    const existing = opts?.storyId
      ? tx.select({ id: stories.id }).from(stories).where(and(eq(stories.id, opts.storyId), eq(stories.momentId, momentId))).get()
      : undefined
    if (existing) {
      // Update in place: refresh meta, then swap the segment set.
      storyId = existing.id
      const set: Record<string, unknown> = {
        title: meta.title,
        hook: meta.hook ?? null,
        povType: meta.povType ?? 'omniscient',
        depthTier: meta.depthTier ?? 'light',
        estimatedMinutes: meta.estimatedMinutes ?? null,
        coverImage: meta.coverImage ?? null,
        cast: meta.cast ?? null,
        theme: meta.theme ?? null,
        updatedAt: new Date(),
      }
      // Series membership is applied only when provided — a plain chapter re-write
      // (no series fields) preserves the existing seriesId/chapterNumber.
      if (meta.seriesId !== undefined) set.seriesId = meta.seriesId
      if (meta.chapterNumber !== undefined) set.chapterNumber = meta.chapterNumber
      // Status is left untouched on a plain re-write; only an explicit status changes
      // it (so a chapter edit never silently un-publishes or re-publishes it).
      if (meta.status !== undefined) set.status = meta.status
      tx.update(stories).set(set).where(eq(stories.id, storyId)).run()
      tx.delete(storySegments).where(eq(storySegments.storyId, storyId)).run()
      created = false
    } else {
      // Resolve the new chapter's birth status: a series with reviewMode ON forces
      // 'draft' server-side (local-175) so an automated append into a PUBLIC series
      // never goes live unreviewed — this beats an explicit meta.status. Otherwise
      // honor meta.status, defaulting to 'published' (today's behavior for standalone
      // stories and non-review series).
      const reviewMode = meta.seriesId
        ? (tx.select({ r: storySeries.reviewMode }).from(storySeries).where(eq(storySeries.id, meta.seriesId)).get()?.r ?? false)
        : false
      const createStatus: StoryStatus = reviewMode ? 'draft' : (meta.status ?? 'published')
      created = true
      status = createStatus
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
          seriesId: meta.seriesId ?? null,
          chapterNumber: meta.chapterNumber ?? null,
          status: createStatus,
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
  return { storyId, segmentCount: segments.length, created, status }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// --- story snapshots (ADR 0006 D7) — for the patch_story undo stack --------
// A full before/after capture of a story (mutable meta + ordered segments + their
// citations). Cheaper + more faithful than per-op inversion of the rich story ops.

export function captureStorySnapshot(storyId: string): ChapterEditSnapshot | null {
  const row = db.select().from(stories).where(eq(stories.id, storyId)).get()
  if (!row) return null
  const segs = db.select().from(storySegments).where(eq(storySegments.storyId, storyId)).orderBy(asc(storySegments.sequence)).all()
  const acBySeg = new Map<string, { artifactId: string; excerptUsed: string | null }[]>()
  if (segs.length) {
    for (const r of db
      .select({ segmentId: segmentCitations.segmentId, artifactId: segmentCitations.artifactId, excerptUsed: segmentCitations.excerptUsed })
      .from(segmentCitations)
      .where(inArray(segmentCitations.segmentId, segs.map((s) => s.id)))
      .all()) {
      const l = acBySeg.get(r.segmentId) ?? []
      l.push({ artifactId: r.artifactId, excerptUsed: r.excerptUsed ?? null })
      acBySeg.set(r.segmentId, l)
    }
  }
  return {
    meta: {
      title: row.title,
      hook: row.hook,
      povType: row.povType,
      depthTier: row.depthTier,
      estimatedMinutes: row.estimatedMinutes,
      coverImage: row.coverImage ?? null,
      cast: row.cast ?? null,
      theme: row.theme ?? null,
      status: row.status,
      isPublic: row.isPublic,
    },
    segments: segs.map((s) => ({
      sequence: s.sequence,
      kind: s.kind,
      bodyText: s.bodyText,
      settingNote: s.settingNote,
      relatedNodeIds: s.relatedNodeIds ?? null,
      focusNodeId: s.focusNodeId ?? null,
      lens: s.lens ?? null,
      citations: s.citations ?? null,
      image: s.image ?? null,
      widget: s.widget ?? null,
      artifactCitations: acBySeg.get(s.id) ?? [],
    })),
  }
}

// Restore a story to a snapshot: rewrite meta, swap the whole segment set (cascading
// segment_citations away), re-insert segments + their citations, rebuild story_artifacts.
function restoreStorySnapshot(tx: Tx, storyId: string, snap: ChapterEditSnapshot): void {
  tx.update(stories).set({ ...snap.meta, updatedAt: new Date() }).where(eq(stories.id, storyId)).run()
  tx.delete(storySegments).where(eq(storySegments.storyId, storyId)).run()
  tx.delete(storyArtifacts).where(eq(storyArtifacts.storyId, storyId)).run()
  const refArtifacts = new Set<string>()
  for (const s of snap.segments) {
    const seg = tx
      .insert(storySegments)
      .values({
        storyId,
        sequence: s.sequence,
        kind: s.kind,
        bodyText: s.bodyText,
        settingNote: s.settingNote,
        relatedNodeIds: s.relatedNodeIds,
        focusNodeId: s.focusNodeId,
        lens: s.lens,
        citations: s.citations,
        image: s.image,
        widget: s.widget,
      })
      .returning({ id: storySegments.id })
      .get()!
    for (const ac of s.artifactCitations) {
      tx.insert(segmentCitations).values({ segmentId: seg.id, artifactId: ac.artifactId, excerptUsed: ac.excerptUsed }).onConflictDoNothing().run()
      refArtifacts.add(ac.artifactId)
    }
  }
  for (const aid of refArtifacts) tx.insert(storyArtifacts).values({ storyId, artifactId: aid, relationship: 'referenced' }).onConflictDoNothing().run()
}

// --- patch_story: surgical, atomic chapter edits (ADR 0006 D6) -------------
// Where writeStory REPLACES a story's whole beat set, patchStory applies a BATCH of
// ops to one story in a single transaction WITHOUT nuking untouched beats. Models
// the apply_patch op-batch shape. Citations arrive already split (inline vs
// artifact-backed) like writeStory's `prepared`, so this never hits an FK error.
// NOT undoable this pass (the story_patches stack is the deferred fast-follow,
// ADR D7) — chapter-level revert is delete-the-story.

export type StoryMetaPatch = {
  title?: string
  hook?: string | null
  cast?: StoryCastMember[] | null
  coverImage?: StoryImage | null
  theme?: TimelineTheme | null
  status?: StoryStatus
  isPublic?: boolean
}

export type StoryOp =
  | { op: 'add_segment'; segment: NewStorySegment; at?: number }
  | { op: 'update_segment'; segmentId: string; segment: Partial<NewStorySegment> }
  | { op: 'delete_segment'; segmentId: string }
  | { op: 'reorder_segments'; order: string[] }
  | { op: 'update_meta'; meta: StoryMetaPatch }

// Apply a batch of story ops atomically. Owner-resolved through the story's
// moment → timeline (mirrors setStoryTheme). Returns null (a no-op) when the story
// isn't the caller's, so the caller surfaces a clean forbidden. Re-sequences the
// segment set to contiguous 0..n-1 after every batch.
export function patchStory(
  storyId: string,
  ops: StoryOp[],
  ownerId: string,
  summary?: string,
): { storyId: string; segmentCount: number; applied: number; publishedChapter: boolean } | null {
  const owner = db
    .select({ ownerId: timelines.ownerId })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(eq(stories.id, storyId))
    .get()
  if (!owner || owner.ownerId !== ownerId) return null

  // Prior status + series membership, read before the batch — used to detect a
  // draft→published TRANSITION so the on-publish notification (local-160) fires once,
  // only when a chapter of a series actually goes live (not on every re-publish).
  const prior = db.select({ status: stories.status, seriesId: stories.seriesId }).from(stories).where(eq(stories.id, storyId)).get()

  // Capture the story before the batch — the undo target (ADR 0006 D7).
  const before = captureStorySnapshot(storyId)

  let applied = 0
  db.transaction((tx) => {
    let order = tx
      .select({ id: storySegments.id })
      .from(storySegments)
      .where(eq(storySegments.storyId, storyId))
      .orderBy(asc(storySegments.sequence))
      .all()
      .map((r) => r.id)

    // Replace a segment's artifact-backed citations (segment_citations) when the
    // caller passed an artifactCitations array; undefined leaves them untouched.
    const writeArtifactCites = (segmentId: string, acs?: { artifactId: string; excerptUsed?: string | null }[]) => {
      if (acs === undefined) return
      tx.delete(segmentCitations).where(eq(segmentCitations.segmentId, segmentId)).run()
      for (const ac of acs)
        tx.insert(segmentCitations)
          .values({ segmentId, artifactId: ac.artifactId, excerptUsed: ac.excerptUsed ?? null })
          .onConflictDoNothing()
          .run()
    }

    for (const op of ops) {
      if (op.op === 'update_meta') {
        const set: Record<string, unknown> = { updatedAt: new Date() }
        const m = op.meta
        if (m.title !== undefined) set.title = m.title
        if (m.hook !== undefined) set.hook = m.hook
        if (m.cast !== undefined) set.cast = m.cast
        if (m.coverImage !== undefined) set.coverImage = m.coverImage
        if (m.theme !== undefined) set.theme = m.theme
        if (m.status !== undefined) set.status = m.status
        if (m.isPublic !== undefined) set.isPublic = m.isPublic
        tx.update(stories).set(set).where(eq(stories.id, storyId)).run()
      } else if (op.op === 'add_segment') {
        const s = op.segment
        const seg = tx
          .insert(storySegments)
          .values({
            storyId,
            sequence: order.length, // temp — re-sequenced below
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
        writeArtifactCites(seg.id, s.artifactCitations)
        const at = op.at == null ? order.length : Math.max(0, Math.min(op.at, order.length))
        order.splice(at, 0, seg.id)
      } else if (op.op === 'update_segment') {
        const s = op.segment
        const set: Record<string, unknown> = {}
        if (s.bodyText !== undefined) set.bodyText = s.bodyText
        if (s.kind !== undefined) set.kind = s.kind
        if (s.settingNote !== undefined) set.settingNote = s.settingNote
        if (s.relatedNodeIds !== undefined) set.relatedNodeIds = s.relatedNodeIds
        if (s.focusNodeId !== undefined) set.focusNodeId = s.focusNodeId
        if (s.lens !== undefined) set.lens = s.lens
        if (s.citations !== undefined) set.citations = s.citations
        if (s.image !== undefined) set.image = s.image
        if (s.widget !== undefined) set.widget = s.widget
        if (Object.keys(set).length)
          tx.update(storySegments)
            .set(set)
            .where(and(eq(storySegments.id, op.segmentId), eq(storySegments.storyId, storyId)))
            .run()
        writeArtifactCites(op.segmentId, s.artifactCitations)
      } else if (op.op === 'delete_segment') {
        tx.delete(storySegments)
          .where(and(eq(storySegments.id, op.segmentId), eq(storySegments.storyId, storyId)))
          .run()
        order = order.filter((id) => id !== op.segmentId)
      } else if (op.op === 'reorder_segments') {
        // Keep only known ids; append any omitted in their current order (defensive).
        const known = new Set(order)
        const next = op.order.filter((id) => known.has(id))
        for (const id of order) if (!next.includes(id)) next.push(id)
        order = next
      }
      applied++
    }

    // Re-sequence the surviving set to contiguous 0..n-1.
    order.forEach((id, i) => {
      tx.update(storySegments).set({ sequence: i }).where(eq(storySegments.id, id)).run()
    })
    // Any batch bumps the story's updatedAt (so the canvas/reader poll refreshes).
    tx.update(stories).set({ updatedAt: new Date() }).where(eq(stories.id, storyId)).run()
  })

  // Record the batch on the story's own undo stack: before + after snapshot, new
  // patch truncates the redo branch (ADR 0006 D7). Best-effort — a snapshot failure
  // never fails the already-applied edit.
  const after = captureStorySnapshot(storyId)
  if (before && after) {
    db.transaction((tx) => {
      tx.delete(storyPatches).where(and(eq(storyPatches.storyId, storyId), eq(storyPatches.status, 'undone'))).run()
      const top = tx.select({ m: max(storyPatches.seq) }).from(storyPatches).where(eq(storyPatches.storyId, storyId)).get()
      const seq = (top?.m ?? 0) + 1
      tx.insert(storyPatches)
        .values({ storyId, ownerId, seq, summary: summary ?? `patch_story — ${ops.length} op${ops.length === 1 ? '' : 's'}`, before, after, status: 'applied' })
        .run()
    })
  }

  const n = db.select({ n: sql<number>`count(*)` }).from(storySegments).where(eq(storySegments.storyId, storyId)).get()?.n ?? 0
  // A chapter published for the first time this batch (draft/archived → published,
  // in a series) — the caller fires notifyNewChapter on this (local-160).
  const publishedChapter =
    !!prior?.seriesId &&
    prior.status !== 'published' &&
    ops.some((o) => o.op === 'update_meta' && o.meta.status === 'published')
  return { storyId, segmentCount: Number(n), applied, publishedChapter }
}

// --- patch_story undo/redo (ADR 0006 D7) — the per-story stack -------------
// Owner-resolved through the story's moment → timeline (like setStoryTheme). Returns
// the timelineId so the caller can emit the live-refresh event + invalidate caches.

function storyOwnerTimeline(storyId: string, ownerId: string): string | null {
  const row = db
    .select({ ownerId: timelines.ownerId, timelineId: timelines.id })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(eq(stories.id, storyId))
    .get()
  if (!row || row.ownerId !== ownerId) return null
  return row.timelineId
}

export function undoStory(storyId: string, ownerId: string): { ok: boolean; timelineId: string | null } {
  const timelineId = storyOwnerTimeline(storyId, ownerId)
  if (!timelineId) return { ok: false, timelineId: null }
  const p = db
    .select()
    .from(storyPatches)
    .where(and(eq(storyPatches.storyId, storyId), eq(storyPatches.status, 'applied')))
    .orderBy(desc(storyPatches.seq))
    .limit(1)
    .get()
  if (!p) return { ok: false, timelineId }
  db.transaction((tx) => {
    restoreStorySnapshot(tx, storyId, p.before)
    tx.update(storyPatches).set({ status: 'undone' }).where(eq(storyPatches.id, p.id)).run()
  })
  return { ok: true, timelineId }
}

export function redoStory(storyId: string, ownerId: string): { ok: boolean; timelineId: string | null } {
  const timelineId = storyOwnerTimeline(storyId, ownerId)
  if (!timelineId) return { ok: false, timelineId: null }
  const p = db
    .select()
    .from(storyPatches)
    .where(and(eq(storyPatches.storyId, storyId), eq(storyPatches.status, 'undone')))
    .orderBy(asc(storyPatches.seq))
    .limit(1)
    .get()
  if (!p) return { ok: false, timelineId }
  db.transaction((tx) => {
    restoreStorySnapshot(tx, storyId, p.after)
    tx.update(storyPatches).set({ status: 'applied' }).where(eq(storyPatches.id, p.id)).run()
  })
  return { ok: true, timelineId }
}

export function storyHistoryState(storyId: string): { canUndo: boolean; canRedo: boolean } {
  const applied =
    db.select({ c: count() }).from(storyPatches).where(and(eq(storyPatches.storyId, storyId), eq(storyPatches.status, 'applied'))).get()?.c ?? 0
  const undone = db
    .select({ id: storyPatches.id })
    .from(storyPatches)
    .where(and(eq(storyPatches.storyId, storyId), eq(storyPatches.status, 'undone')))
    .limit(1)
    .get()
  return { canUndo: applied > 0, canRedo: !!undone }
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

// Raw fields needed to resolve a story's effective brand (the cascade walks
// story.brandId ?? series.brandId ?? project.brandId). Returns null when missing.
export function getStoryBrandContext(
  storyId: string,
): { momentId: string; seriesId: string | null; brandId: string | null } | null {
  return (
    db
      .select({ momentId: stories.momentId, seriesId: stories.seriesId, brandId: stories.brandId })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get() ?? null
  )
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
  // Chapter number when the story belongs to a series (ADR 0006), else null.
  chapterNumber: stories.chapterNumber,
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
      // Series identity for the featured-hero chapter badge/link (local-161 slice E).
      // LEFT-joined: null columns for a standalone (non-series) story.
      seriesId: storySeries.id,
      seriesSlug: storySeries.slug,
      seriesTitle: storySeries.title,
    })
    .from(stories)
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .leftJoin(entities, eq(nodes.entityId, entities.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .leftJoin(storySeries, eq(stories.seriesId, storySeries.id))
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
  return withBeatCounts(rows).map(({ cast, updatedAt, seriesId, seriesSlug, seriesTitle, ...rest }) => ({
    ...rest,
    updatedAt: updatedAt?.getTime() ?? 0,
    castNames: (cast ?? [])
      .map((m) => (m.nodeId ? titleById.get(m.nodeId) : m.name) ?? m.name ?? '')
      .filter((s): s is string => Boolean(s)),
    series: seriesId && seriesSlug && seriesTitle ? { id: seriesId, slug: seriesSlug, title: seriesTitle } : null,
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
