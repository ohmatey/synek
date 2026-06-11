import { createServerFn } from '@tanstack/react-start'
import { getMomentTimelineId, getStoryForMoment, listStoriesForTimeline } from '~/lib/db/stories'
import { getTimelineMeta, canView } from '~/lib/db/graph'
import { getCurrentUser } from '~/lib/auth/session'
import type { StoryDTO, StoryListItem } from '~/lib/domain/types'

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
