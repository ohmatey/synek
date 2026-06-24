import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './index'
import { storySeries, stories, nodes, type SeriesRow } from './schema'
import { getStoryById, referencedNodeIds } from './stories'
import type { StoryImage, StoryStatus, TimelineTheme } from '~/lib/domain/types'

// --- story_series: the narrative spine (ADR 0006) -------------------------
// A child of `projects`: a project is a world/workspace, a series is an ORDERED
// sequence of chapters (each chapter is a `stories` row, linked by stories.seriesId
// + chapterNumber). CRUD mirrors db/projects.ts EXACTLY — the db layer takes ids
// and trusts its guarded caller (server fns via requireUser, MCP via ctx.ownerId);
// owner-scoped mutations AND on ownerId so a non-owner's call no-ops. Series CRUD
// is METADATA — never a Patch. The frontier is DERIVED at read (D9), never stored.

export type SeriesMeta = {
  id: string
  projectId: string
  ownerId: string | null
  slug: string
  title: string
  theme: TimelineTheme | null
}

// One chapter's list-row (no beat payload) — ordered by chapterNumber.
export type ChapterRow = {
  storyId: string
  slug: string
  title: string
  hook: string | null
  status: StoryStatus
  isPublic: boolean
  momentId: string
  chapterNumber: number | null
}

// Slugify a title the same way the project/story paths do, so series URLs read
// consistently with the rest of the app.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'series'

// `story_series.slug` is global-unique. Slugify the title, then dedupe against the
// table with a numeric suffix on collision (same shape as projects/stories).
function uniqueSlug(title: string): string {
  const base = slugify(title)
  let candidate = base
  let n = 1
  while (db.select({ id: storySeries.id }).from(storySeries).where(eq(storySeries.slug, candidate)).get()) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}

// Every series in a project, newest first. NOT owner-scoped here — the caller
// owner-checks the project first (the security boundary is the project's ownerId).
export function listSeriesForProject(projectId: string): SeriesRow[] {
  return db
    .select()
    .from(storySeries)
    .where(eq(storySeries.projectId, projectId))
    .orderBy(desc(storySeries.createdAt))
    .all()
}

// Every series the OWNER has (optionally narrowed to one project), newest first —
// owner-scope is the security boundary; projectId is an organizational filter.
export function listSeriesForOwner(ownerId: string, projectId?: string): SeriesRow[] {
  return db
    .select()
    .from(storySeries)
    .where(projectId ? and(eq(storySeries.ownerId, ownerId), eq(storySeries.projectId, projectId)) : eq(storySeries.ownerId, ownerId))
    .orderBy(desc(storySeries.createdAt))
    .all()
}

// Create a series in a project. Slug is slugified-from-title + deduped.
export function createSeries(
  projectId: string,
  ownerId: string,
  opts: { title: string; hook?: string | null; coverImage?: StoryImage | null; theme?: TimelineTheme | null; anchorMomentId?: string | null },
): SeriesRow {
  return db
    .insert(storySeries)
    .values({
      projectId,
      ownerId,
      slug: uniqueSlug(opts.title),
      title: opts.title,
      hook: opts.hook ?? null,
      coverImage: opts.coverImage ?? null,
      theme: opts.theme ?? null,
      anchorMomentId: opts.anchorMomentId ?? null,
      status: 'active',
    })
    .returning()
    .get()
}

// One series row by id, or null. NOT owner-scoped — callers own-check via ownerId.
export function getSeries(id: string): SeriesRow | null {
  return db.select().from(storySeries).where(eq(storySeries.id, id)).get() ?? null
}

// Ownership metadata for one series, or null. Mirror of getProjectMeta.
export function getSeriesMeta(id: string): SeriesMeta | null {
  const row = db
    .select({
      id: storySeries.id,
      projectId: storySeries.projectId,
      ownerId: storySeries.ownerId,
      slug: storySeries.slug,
      title: storySeries.title,
      theme: storySeries.theme,
    })
    .from(storySeries)
    .where(eq(storySeries.id, id))
    .get()
  return row ?? null
}

// One series by its global-unique slug, owner-scoped (returns null for foreign/
// unknown indistinguishably — like getProjectBySlug). Used by the owner-facing
// resolvers; the PUBLIC page uses the visibility-gated path in server/series.ts.
export function getSeriesBySlug(slug: string, ownerId: string): SeriesRow | null {
  return (
    db
      .select()
      .from(storySeries)
      .where(and(eq(storySeries.slug, slug), eq(storySeries.ownerId, ownerId)))
      .get() ?? null
  )
}

// One series by slug, NOT owner-scoped — the PUBLIC page's lookup. The server fn
// applies the isPublic visibility gate; this is pure data access.
export function getSeriesRowBySlug(slug: string): SeriesRow | null {
  return db.select().from(storySeries).where(eq(storySeries.slug, slug)).get() ?? null
}

// The project a series belongs to (for the owner check on series-scoped tools).
export function getSeriesProjectId(id: string): string | null {
  return db.select({ p: storySeries.projectId }).from(storySeries).where(eq(storySeries.id, id)).get()?.p ?? null
}

// Owner-scoped partial update. A non-owner's call no-ops (0 rows matched). theme
// accepts null to clear it back to inheriting the project.
export function updateSeries(
  id: string,
  ownerId: string,
  patch: { title?: string; hook?: string | null; coverImage?: StoryImage | null; theme?: TimelineTheme | null; brandId?: string | null; status?: SeriesRow['status'] },
): void {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.hook !== undefined) set.hook = patch.hook
  if (patch.coverImage !== undefined) set.coverImage = patch.coverImage
  if (patch.theme !== undefined) set.theme = patch.theme
  if (patch.brandId !== undefined) set.brandId = patch.brandId
  if (patch.status !== undefined) set.status = patch.status
  db.update(storySeries)
    .set(set)
    .where(and(eq(storySeries.id, id), eq(storySeries.ownerId, ownerId)))
    .run()
}

// Owner-scoped public toggle. Returns the slug (for building the /sr/$slug link)
// on success, or null when the series is missing or isn't the caller's. INDEPENDENT
// of any chapter's isPublic (D10).
export function setSeriesShared(id: string, ownerId: string, isPublic: boolean): { slug: string } | null {
  const row = db.select({ slug: storySeries.slug, ownerId: storySeries.ownerId }).from(storySeries).where(eq(storySeries.id, id)).get()
  if (!row || row.ownerId !== ownerId) return null
  db.update(storySeries).set({ isPublic, updatedAt: new Date() }).where(eq(storySeries.id, id)).run()
  return { slug: row.slug }
}

// Cascades to nothing destructive: stories.seriesId SETs NULL (D3), so a series
// delete leaves its chapters as standalone stories. Owner-scoped: non-owner no-ops.
export function deleteSeries(id: string, ownerId: string): void {
  db.delete(storySeries).where(and(eq(storySeries.id, id), eq(storySeries.ownerId, ownerId))).run()
}

// The shared owner guard for series — must exist and belong to this owner, else a
// tool error. Mirror of makeRequireOwnedProject one level down.
export function makeRequireOwnedSeries(ownerId: string) {
  return (seriesId: string) => {
    const meta = getSeriesMeta(seriesId)
    if (!meta || meta.ownerId !== ownerId) {
      throw new Error(`series "${seriesId}" not found`)
    }
  }
}

// The series' chapters in chapterNumber order (nulls last, then createdAt) — the
// list-row shape (no beat payload). Backs get_series, the public page, and the home.
export function getSeriesChapters(seriesId: string): ChapterRow[] {
  return db
    .select({
      storyId: stories.id,
      slug: stories.slug,
      title: stories.title,
      hook: stories.hook,
      status: stories.status,
      isPublic: stories.isPublic,
      momentId: stories.momentId,
      chapterNumber: stories.chapterNumber,
    })
    .from(stories)
    .where(eq(stories.seriesId, seriesId))
    .orderBy(asc(sql`coalesce(${stories.chapterNumber}, 1e9)`), asc(stories.createdAt))
    .all()
}

// The next chapter number for a series (max existing + 1, or 1 when empty) — used
// by write_story's appendToSeries shorthand so the client never has to track order.
export function nextChapterNumber(seriesId: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${stories.chapterNumber})` })
    .from(stories)
    .where(eq(stories.seriesId, seriesId))
    .get()
  return (row?.max ?? 0) + 1
}

// The DERIVED frontier + per-chapter coverage — the anti-duplication watermark
// get_series returns (D8/D9). For each chapter: the union of node ids it references
// (cast / beat focus+related / widgets). Frontier: the highest chapterNumber and
// the latest instant any covered node sits at, so the client knows where to advance.
export function seriesWatermark(seriesId: string): {
  chapters: (ChapterRow & { coveredNodeIds: string[] })[]
  frontier: { lastChapterNumber: number | null; lastInstant: number | null }
} {
  const chapters = getSeriesChapters(seriesId)
  const enriched = chapters.map((ch) => {
    const dto = getStoryById(ch.storyId)
    // Coverage = the chapter's own anchor moment PLUS every node it references
    // (cast / beat focus+related / widgets). The moment is what the chapter is
    // ABOUT, so it anchors the frontier instant — referencedNodeIds omits it.
    const covered = new Set<string>([ch.momentId, ...(dto ? referencedNodeIds(dto) : [])])
    return { ...ch, coveredNodeIds: [...covered] }
  })
  const allNodeIds = [...new Set(enriched.flatMap((c) => c.coveredNodeIds))]
  let lastInstant: number | null = null
  if (allNodeIds.length) {
    const row = db
      .select({ max: sql<number | null>`max(${nodes.startInstant})` })
      .from(nodes)
      .where(inArray(nodes.id, allNodeIds))
      .get()
    lastInstant = row?.max ?? null
  }
  const lastChapterNumber = chapters.reduce<number | null>((m, c) => (c.chapterNumber != null && (m == null || c.chapterNumber > m) ? c.chapterNumber : m), null)
  return { chapters: enriched, frontier: { lastChapterNumber, lastInstant } }
}
