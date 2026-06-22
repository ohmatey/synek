import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createSeries as dbCreateSeries,
  getSeries as dbGetSeries,
  getSeriesRowBySlug,
  getSeriesChapters,
  listSeriesForOwner,
  setSeriesShared as dbSetSeriesShared,
  makeRequireOwnedSeries,
  seriesWatermark,
} from '~/lib/db/series'
import { getProjectMeta, makeRequireOwnedProject } from '~/lib/db/projects'
import { getStoryById, getMomentTimelineId } from '~/lib/db/stories'
import { nodesByIds, nodeRowToGraphNode } from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'
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
        isPublic: series.isPublic,
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
    // The SERIES public flag is the publish action for the whole season (ADR 0006
    // D10) — every chapter ships in order, regardless of its own per-story isPublic
    // (that flag governs the standalone /s/$slug page, not the season).
    const chapterRows = getSeriesChapters(series.id)
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
  })
