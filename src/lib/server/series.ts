import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createSeries as dbCreateSeries,
  getSeries as dbGetSeries,
  getSeriesRowBySlug,
  getSeriesChapters,
  publicSeriesChapters,
  getChapterContext,
  listSeriesForOwner,
  setSeriesShared as dbSetSeriesShared,
  setSeriesReviewMode as dbSetSeriesReviewMode,
  makeRequireOwnedSeries,
  seriesWatermark,
  type ChapterContext,
  type ChapterRow,
} from '~/lib/db/series'
import type { SeriesRow } from '~/lib/db/schema'
import { getProjectMeta, makeRequireOwnedProject } from '~/lib/db/projects'
import { getStoryById, getMomentTimelineId, patchStory } from '~/lib/db/stories'
import { nodesByIds, nodeRowToGraphNode } from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'
import { notifyNewChapter } from '~/lib/server/subscriptions'
import type {
  HomeSeriesCard,
  PublicSeriesChapter,
  PublicSeriesDTO,
  SeriesDetailChapter,
  SeriesDetailDTO,
  StoryDTO,
} from '~/lib/domain/types'

// --- Series RPCs (ADR 0006) ----------------------------------------------
// Owner-scoped reads/writes (requireUser at the entry point); the PUBLIC page read
// is no-auth and gated on isPublic, mirroring getPublicStory.

// Every series the signed-in owner has (optionally narrowed to one project) — backs
// the cinematic home's Series row (slice 5). Owner-scope is the boundary; an
// unowned/foreign projectId simply matches nothing.
export const listHomeSeries = createServerFn({ method: 'GET' })
  .inputValidator((d?: { projectId?: string }) => z.object({ projectId: z.string().optional() }).optional().parse(d))
  .handler(async ({ data }): Promise<HomeSeriesCard[]> => {
    const user = await requireUser()
    return listSeriesForOwner(user.id, data?.projectId).map((s) => ({
      seriesId: s.id,
      slug: s.slug,
      title: s.title,
      hook: s.hook,
      coverImage: s.coverImage ?? null,
      isPublic: s.isPublic,
      chapterCount: getSeriesChapters(s.id).length,
      updatedAt: s.updatedAt?.getTime() ?? 0,
    }))
  })

// Create a series in a project (owner-checked). Returns the new id + slug.
export const createSeries = createServerFn({ method: 'POST' })
  .inputValidator((d: { projectId: string; title: string; hook?: string }) =>
    z.object({ projectId: z.string(), title: z.string().trim().min(1).max(200), hook: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ seriesId: string; slug: string } | { error: 'forbidden' }> => {
    const user = await requireUser()
    try {
      makeRequireOwnedProject(user.id)(data.projectId)
    } catch {
      return { error: 'forbidden' }
    }
    const s = dbCreateSeries(data.projectId, user.id, { title: data.title, hook: data.hook ?? null })
    return { seriesId: s.id, slug: s.slug }
  })

// One series + its ordered chapters + derived frontier (owner-scoped) — the owner
// dashboard read; mirrors the get_series MCP tool.
export const getSeries = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => z.string().parse(id))
  .handler(async ({ data: id }) => {
    const user = await requireUser()
    try {
      makeRequireOwnedSeries(user.id)(id)
    } catch {
      return null
    }
    const series = dbGetSeries(id)!
    const { chapters, frontier } = seriesWatermark(id)
    return { series, chapters, frontier }
  })

// The in-app series detail (local-161 slice B) — owner-scoped. ALL chapters incl.
// drafts (each with status + a resolved dateline), the derived frontier, and the
// parent project for the breadcrumb. Returns null (indistinguishably) when the
// viewer isn't signed in or doesn't own the series, so the route renders one clean
// "not available" state. Distinct from getPublicSeries (no auth, public-only).
export const getSeriesDetail = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => z.string().parse(id))
  .handler(async ({ data: id }): Promise<SeriesDetailDTO | null> => {
    let user
    try {
      user = await requireUser()
    } catch {
      return null
    }
    try {
      makeRequireOwnedSeries(user.id)(id)
    } catch {
      return null
    }
    const series = dbGetSeries(id)
    if (!series) return null
    const { frontier } = seriesWatermark(id)
    const chapters: SeriesDetailChapter[] = getSeriesChapters(id).map((row) => {
      const tl = getMomentTimelineId(row.momentId)
      const momentInstant = tl ? (nodesByIds(tl, [row.momentId])[0]?.startInstant ?? null) : null
      return {
        storyId: row.storyId,
        number: row.chapterNumber,
        title: row.title,
        hook: row.hook,
        momentInstant,
        status: row.status,
        isPublic: row.isPublic,
        slug: row.slug,
        timelineId: tl ?? null,
      }
    })
    const project = getProjectMeta(series.projectId)
    return {
      series: {
        id: series.id,
        slug: series.slug,
        title: series.title,
        hook: series.hook,
        coverImage: series.coverImage ?? null,
        theme: series.theme ?? null,
        brandId: series.brandId ?? null,
        isPublic: series.isPublic,
        reviewMode: series.reviewMode,
      },
      project: project ? { slug: project.slug, title: project.title } : null,
      chapters,
      frontier,
      updatedAt: series.updatedAt?.getTime() ?? 0,
    }
  })

// Owner-gated publish toggle for the /sr/$slug page. Returns the slug on success.
export const publishSeriesShare = createServerFn({ method: 'POST' })
  .inputValidator((d: { seriesId: string; isPublic: boolean }) =>
    z.object({ seriesId: z.string(), isPublic: z.boolean() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true; slug: string } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const res = dbSetSeriesShared(data.seriesId, user.id, data.isPublic)
    return res ? { ok: true as const, slug: res.slug } : { error: 'forbidden' }
  })

// Owner-gated review-mode toggle (local-175). ON → chapters written into this series
// are born `draft` (enforced server-side in writeStory), so an automated writer can
// append into a PUBLIC series without publishing anything until the owner approves it.
// Backs the series-detail "Review mode" switch; a non-owner/missing series is forbidden.
export const setSeriesReviewMode = createServerFn({ method: 'POST' })
  .inputValidator((d: { seriesId: string; reviewMode: boolean }) =>
    z.object({ seriesId: z.string(), reviewMode: z.boolean() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const ok = dbSetSeriesReviewMode(data.seriesId, user.id, data.reviewMode)
    return ok ? { ok: true as const } : { error: 'forbidden' }
  })

// Owner-gated per-chapter publish gate (local-177). Flips one chapter between `draft`
// and `published` in-app, so approving a reviewed draft no longer needs a connected MCP
// client. Rides the existing owner guard in patchStory (story → moment → timeline.ownerId,
// returns null for a non-owner) — no new boundary. `archived` stays out of the UI.
export const setChapterStatus = createServerFn({ method: 'POST' })
  .inputValidator((d: { storyId: string; status: 'draft' | 'published' }) =>
    z.object({ storyId: z.string(), status: z.enum(['draft', 'published']) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const res = patchStory(data.storyId, [{ op: 'update_meta', meta: { status: data.status } }], user.id)
    if (!res) return { error: 'forbidden' }
    // Approving a reviewed draft in-app → email the season's followers (local-160),
    // fire-and-forget. publishedChapter is true only on a genuine draft→published flip.
    if (res.publishedChapter) void notifyNewChapter(data.storyId)
    return { ok: true as const }
  })

// Compose the reader-ready season DTO from a series row + the chapter rows it should
// ship (the caller decides which — `publicSeriesChapters` for the live page, all
// `getSeriesChapters` for the owner draft preview). Each chapter becomes a full
// StoryDTO; the nodes union is fetched per timeline (no full-graph leak). Shared by
// getPublicSeries (no-auth, published-only) and previewSeries (owner, all chapters).
function composeSeriesDTO(series: SeriesRow, chapterRows: ChapterRow[]): PublicSeriesDTO {
  const chapters: PublicSeriesChapter[] = []
  for (const row of chapterRows) {
    const story = getStoryById(row.storyId)
    if (!story) continue
    // Resolve the chapter's anchor-moment instant for the spine dateline.
    const tl = getMomentTimelineId(story.momentId)
    const momentInstant = tl ? (nodesByIds(tl, [story.momentId])[0]?.startInstant ?? null) : null
    chapters.push({ chapterNumber: row.chapterNumber, momentInstant, story })
  }
  // Union the nodes every chapter references, fetched per their timeline (one
  // timeline per project in practice; grouped defensively for safety).
  const idsByTimeline = new Map<string, Set<string>>()
  const collect = (story: StoryDTO) => {
    const timelineId = getMomentTimelineId(story.momentId)
    if (!timelineId) return
    const set = idsByTimeline.get(timelineId) ?? new Set<string>()
    for (const m of story.cast) if (m.nodeId) set.add(m.nodeId)
    for (const b of story.beats) {
      if (b.focusNodeId) set.add(b.focusNodeId)
      for (const id of b.relatedNodeIds) set.add(id)
      if (b.widget) {
        for (const id of b.widget.nodeIds) set.add(id)
        if (b.widget.focusNodeId) set.add(b.widget.focusNodeId)
      }
    }
    idsByTimeline.set(timelineId, set)
  }
  for (const c of chapters) collect(c.story)
  const nodes = [...idsByTimeline.entries()].flatMap(([timelineId, ids]) =>
    nodesByIds(timelineId, [...ids]).map(nodeRowToGraphNode),
  )
  const projectTheme = getProjectMeta(series.projectId)?.theme ?? null
  return {
    series: {
      id: series.id,
      slug: series.slug,
      title: series.title,
      hook: series.hook,
      coverImage: series.coverImage ?? null,
      theme: series.theme ?? projectTheme,
    },
    chapters,
    nodes,
    updatedAt: series.updatedAt?.getTime() ?? 0,
  }
}

// The PUBLIC season page (no auth). Gated on the SERIES being public; ships only its
// PUBLIC chapters in chapterNumber order, each a full StoryDTO, plus the union of the
// nodes those chapters reference (no full-graph leak). theme resolves
// series.theme ?? project.theme ?? null (client applies defaults). Returns null when
// the series is missing or private — indistinguishably (mirrors getPublicStory).
export const getPublicSeries = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<PublicSeriesDTO | null> => {
    const series = getSeriesRowBySlug(slug)
    if (!series || !series.isPublic) return null
    // The SERIES public flag opens the shelf; publicSeriesChapters then ships only
    // `published` chapters (local-175). A `draft`/`archived` chapter (unfinished or
    // withdrawn) never leaks just because the season is public. A chapter's own
    // `isPublic` (the standalone /s/$slug axis) is orthogonal and NOT consulted here.
    return composeSeriesDTO(series, publicSeriesChapters(series.id))
  })

// OWNER-scoped draft-season PREVIEW (local-161 slice D). Same reader-ready DTO as the
// public page but WITHOUT the isPublic gate and shipping ALL chapters (incl. drafts),
// so the creator can see how the season will read before publishing it. Owner-checked
// via makeRequireOwnedSeries; returns null for anonymous/foreign viewers or a missing
// series (indistinguishably). Reuses composeSeriesDTO, so the preview is byte-for-byte
// the public reading experience minus the publish gate.
export const previewSeries = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => z.string().parse(slug))
  .handler(async ({ data: slug }): Promise<PublicSeriesDTO | null> => {
    let user
    try {
      user = await requireUser()
    } catch {
      return null
    }
    const series = getSeriesRowBySlug(slug)
    if (!series) return null
    try {
      makeRequireOwnedSeries(user.id)(series.id)
    } catch {
      return null
    }
    return composeSeriesDTO(series, getSeriesChapters(series.id))
  })

// The open story's place in its series (local-161 slice C/E) — owner-scoped. Feeds the
// in-app reader's "Chapter N" badge (current) and its "Next chapter →" continuity
// (next). Owner-checked via the resolved series; returns null when the story is in no
// series, isn't owned, or the viewer is anonymous.
export const getChapterContextFn = createServerFn({ method: 'GET' })
  .inputValidator((storyId: string) => z.string().parse(storyId))
  .handler(async ({ data: storyId }): Promise<ChapterContext | null> => {
    let user
    try {
      user = await requireUser()
    } catch {
      return null
    }
    const ctx = getChapterContext(storyId)
    if (!ctx) return null
    try {
      makeRequireOwnedSeries(user.id)(ctx.seriesId)
    } catch {
      return null
    }
    return ctx
  })
