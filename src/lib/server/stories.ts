import { createServerFn } from '@tanstack/react-start'
import {
  getMomentTimelineId,
  getStoryById,
  getStoryBySlug,
  getStoryForMoment,
  getStoriesForMoment,
  listStoriesForTimeline,
  referencedNodeIds,
} from '~/lib/db/stories'
import { db } from '~/lib/db/index'
import { stories } from '~/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getTimelineMeta, canView, nodesByIds, nodeRowToGraphNode, setTimelinePublic } from '~/lib/db/graph'
import { getCurrentUser, requireUser } from '~/lib/auth/session'
import type { PublicStoryDTO, StoryDTO, StoryListItem } from '~/lib/domain/types'

// Read the story attached to a moment, gated by the SAME visibility rule as the
// graph (owner, or public) so a private timeline's story is never leaked. Returns
// null when the moment has no story (or can't be viewed). Viewing may be
// anonymous on a public timeline, so getCurrentUser may be null — mirrors getGraph.
export const getStory = createServerFn({ method: 'GET' })
  .inputValidator((momentId: string) => momentId)
  .handler(async ({ data: momentId }): Promise<StoryDTO | null> => {
    const timelineId = getMomentTimelineId(momentId)
    if (!timelineId) return null
    const meta = getTimelineMeta(timelineId)
    if (!meta) return null
    const user = await getCurrentUser()
    if (!canView(meta, user?.id ?? null)) return null
    return getStoryForMoment(momentId)
  })

// Every story on a timeline (for the AppBar "Stories" dropdown), gated by the same
// visibility rule as the graph. Returns [] for a missing/forbidden timeline or one
// with no stories. Viewing may be anonymous on a public timeline.
export const listStories = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(async ({ data: timelineId }): Promise<StoryListItem[]> => {
    const meta = getTimelineMeta(timelineId)
    if (!meta) return []
    const user = await getCurrentUser()
    if (!canView(meta, user?.id ?? null)) return []
    return listStoriesForTimeline(timelineId)
  })

// Every story attached to a single moment (for the entity panel's story list),
// gated by the same visibility rule. Returns [] when the moment has none or can't
// be viewed.
export const getStoriesForMomentFn = createServerFn({ method: 'GET' })
  .inputValidator((momentId: string) => momentId)
  .handler(async ({ data: momentId }): Promise<StoryListItem[]> => {
    const timelineId = getMomentTimelineId(momentId)
    if (!timelineId) return []
    const meta = getTimelineMeta(timelineId)
    if (!meta) return []
    const user = await getCurrentUser()
    if (!canView(meta, user?.id ?? null)) return []
    return getStoriesForMoment(momentId)
  })

// One story by id (for the docked reader), gated by the same visibility rule. The
// story resolves to its moment → timeline for the check. Returns null when missing
// or forbidden.
export const getStoryByIdFn = createServerFn({ method: 'GET' })
  .inputValidator((storyId: string) => storyId)
  .handler(async ({ data: storyId }): Promise<StoryDTO | null> => {
    const row = db.select({ momentId: stories.momentId }).from(stories).where(eq(stories.id, storyId)).get()
    if (!row) return null
    const timelineId = getMomentTimelineId(row.momentId)
    if (!timelineId) return null
    const meta = getTimelineMeta(timelineId)
    if (!meta) return null
    const user = await getCurrentUser()
    if (!canView(meta, user?.id ?? null)) return null
    return getStoryById(storyId)
  })

// PUBLIC, no-auth: the sharable story page (/s/$slug). Resolves the story by its
// slug and serves it ONLY when its timeline is public (the same primitive timeline
// sharing uses) and the story isn't archived — anonymous viewers welcome. Ships the
// story plus the lightweight nodes its cast / beat-focus / widgets reference, the
// timeline theme, the axis scale, and updatedAt (the live stamp). Returns null when
// missing or not public, so the route renders a clean not-found.
export const getPublicStory = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<PublicStoryDTO | null> => {
    const found = getStoryBySlug(slug)
    if (!found || found.status === 'archived') return null
    const timelineId = getMomentTimelineId(found.momentId)
    if (!timelineId) return null
    const meta = getTimelineMeta(timelineId)
    if (!meta || !meta.isPublic) return null // fully public gate — no user required
    const nodes = nodesByIds(timelineId, referencedNodeIds(found.story)).map(nodeRowToGraphNode)
    return {
      story: found.story,
      timelineId,
      timelineTitle: meta.title,
      theme: meta.theme ?? null,
      viewSettings: meta.viewSettings ?? null,
      updatedAt: found.updatedAt,
      nodes,
    }
  })

// Owner-gated: make a story publicly shareable. Publishes its timeline (the same
// isPublic primitive as timeline sharing) so /s/$slug is viewable by anyone, and
// returns the slug so the caller can build the link. A non-owner is forbidden.
export const publishStoryShare = createServerFn({ method: 'POST' })
  .inputValidator((storyId: string) => storyId)
  .handler(async ({ data: storyId }): Promise<{ slug: string } | { error: 'not_found' | 'forbidden' }> => {
    const user = await requireUser()
    const row = db
      .select({ slug: stories.slug, momentId: stories.momentId })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get()
    if (!row) return { error: 'not_found' }
    const timelineId = getMomentTimelineId(row.momentId)
    if (!timelineId) return { error: 'not_found' }
    const meta = getTimelineMeta(timelineId)
    if (!meta || meta.ownerId !== user.id) return { error: 'forbidden' }
    setTimelinePublic(timelineId, user.id, true)
    return { slug: row.slug }
  })
