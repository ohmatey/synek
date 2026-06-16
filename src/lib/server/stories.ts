import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  getMomentTimelineId,
  getStoryById,
  getStoryBySlug,
  getStoryForMoment,
  getStoriesForMoment,
  getStoryTimelineId,
  listStoriesForHome,
  listStoriesForTimeline,
  referencedNodeIds,
  setStoryShared as dbSetStoryShared,
  setStoryTheme as dbSetStoryTheme,
} from '~/lib/db/stories'
import { db } from '~/lib/db/index'
import { stories } from '~/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  getTimelineMeta,
  canView,
  nodesByIds,
  nodeRowToGraphNode,
  resolveTimelineTheme,
} from '~/lib/db/graph'
import { emitTimelineEvent } from '~/lib/server/bus'
import { maxAppliedSeq } from '~/lib/db/patches'
import { getCurrentUser, requireUser } from '~/lib/auth/session'
import { timelineThemeSchema } from '~/lib/domain/theme'
import type { HomeStoryCard, PublicStoryDTO, StoryDTO, StoryListItem, TimelineTheme } from '~/lib/domain/types'

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

// Every story the SIGNED-IN owner has across all their timelines (optionally
// narrowed to one project) — backs the cinematic home's hero + "Your stories" row.
// Owner-only (the home is the private dashboard): owner-scope is enforced in the db
// query's timeline join, and an unowned/foreign `projectId` simply matches nothing
// (degrades to empty, never leaks). Sorted newest-`updatedAt`-first.
export const listHomeStories = createServerFn({ method: 'GET' })
  .inputValidator((d?: { projectId?: string }) =>
    z.object({ projectId: z.string().optional() }).optional().parse(d),
  )
  .handler(async ({ data }): Promise<HomeStoryCard[]> => {
    const user = await requireUser()
    return listStoriesForHome(user.id, data?.projectId)
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
// slug and serves it ONLY when the STORY itself is public (per-story visibility,
// INDEPENDENT of the timeline) and isn't archived — anonymous viewers welcome.
// Sharing a story never exposes its timeline: only the nodes its cast / beat-focus
// / widgets reference ship to the page (no full-graph leak). A private/missing slug
// returns null indistinguishably (don't reveal a private story exists), so the
// route renders one clean "not available" fallback for every miss.
export const getPublicStory = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<PublicStoryDTO | null> => {
    const found = getStoryBySlug(slug)
    if (!found || found.status === 'archived' || !found.story.isPublic) return null
    const timelineId = getMomentTimelineId(found.momentId)
    if (!timelineId) return null
    const meta = getTimelineMeta(timelineId)
    if (!meta) return null // need it for title/theme/nodes — but NOT for the gate
    const nodes = nodesByIds(timelineId, referencedNodeIds(found.story)).map(nodeRowToGraphNode)
    return {
      story: found.story,
      timelineId,
      timelineTitle: meta.title,
      // Story-first theme chain: the story's own theme wins, else the timeline's
      // (which itself falls back to the project's) — so a shared story carries its
      // own look or inherits the canvas it lives on.
      theme: found.story.theme ?? resolveTimelineTheme(meta),
      viewSettings: meta.viewSettings ?? null,
      updatedAt: found.updatedAt,
      nodes,
    }
  })

// Owner-gated: make THIS story publicly shareable (per-story, independent of the
// timeline — it does NOT publish the timeline). Flips the story's own isPublic and
// returns the slug so the caller can build the /s/$slug link. A non-owner (or a
// missing story) is forbidden. Backs the reader's one-tap Share control.
export const publishStoryShare = createServerFn({ method: 'POST' })
  .inputValidator((storyId: string) => storyId)
  .handler(async ({ data: storyId }): Promise<{ slug: string } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const res = dbSetStoryShared(storyId, user.id, true)
    return res ? { slug: res.slug } : { error: 'forbidden' }
  })

// Owner-gated per-story share TOGGLE (share AND unshare) — independent of the
// timeline. Returns the slug on success so a freshly-shared story's link can be
// copied immediately; a non-owner/missing story is forbidden. Backs the Share
// dialog's per-story switches.
export const setStoryShare = createServerFn({ method: 'POST' })
  .inputValidator((d: { storyId: string; isPublic: boolean }) =>
    z.object({ storyId: z.string(), isPublic: z.boolean() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true; slug: string } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const res = dbSetStoryShared(data.storyId, user.id, data.isPublic)
    return res ? { ok: true as const, slug: res.slug } : { error: 'forbidden' }
  })

// Owner-gated: set (or clear, null) a story's OWN visual theme — the in-app
// editor's counterpart to the set_story_theme MCP tool (both write the same row).
// Ownership is resolved through the story's moment → timeline.ownerId in the db
// layer; a non-owner's call no-ops there and we report it as forbidden. On success
// we nudge live viewers on the story's timeline to refetch (same channel as a
// story write), so an open reader picks the new look up.
export const setStoryTheme = createServerFn({ method: 'POST' })
  .inputValidator((d: { storyId: string; theme: TimelineTheme | null }) =>
    z.object({ storyId: z.string(), theme: timelineThemeSchema.nullable() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const ok = dbSetStoryTheme(data.storyId, user.id, data.theme)
    if (!ok) return { error: 'forbidden' }
    const timelineId = getStoryTimelineId(data.storyId)
    if (timelineId) emitTimelineEvent({ timelineId, kind: 'story', seq: maxAppliedSeq(timelineId) })
    return { ok: true }
  })
