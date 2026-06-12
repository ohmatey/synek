import { createServerFn } from '@tanstack/react-start'
import { listArtifactsForTimeline, listArtifactsForMoment, type ArtifactBrowseRow } from '~/lib/db/artifacts'
import { getMomentTimelineId } from '~/lib/db/stories'
import { getTimelineMeta, canView } from '~/lib/db/graph'
import { getCurrentUser } from '~/lib/auth/session'
import type { ArtifactRow } from '~/lib/db/schema'

// Artifact-first browse: every artifact belonging to a timeline (linked to a moment
// and/or anchoring a story) with the moments it sits on + the stories it anchors.
// Gated by the SAME visibility rule as the graph so a private timeline's corpus is
// never leaked. Returns [] for a missing/forbidden/empty timeline.
export const listArtifacts = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(async ({ data: timelineId }): Promise<ArtifactBrowseRow[]> => {
    const meta = getTimelineMeta(timelineId)
    if (!meta) return []
    const user = await getCurrentUser()
    if (!canView(meta, user?.id ?? null)) return []
    return listArtifactsForTimeline(timelineId)
  })

// Every artifact linked to a single moment (for the entity panel), gated the same
// way. Returns [] when the moment has none or can't be viewed.
export const getArtifactsForMoment = createServerFn({ method: 'GET' })
  .inputValidator((momentId: string) => momentId)
  .handler(async ({ data: momentId }): Promise<ArtifactRow[]> => {
    const timelineId = getMomentTimelineId(momentId)
    if (!timelineId) return []
    const meta = getTimelineMeta(timelineId)
    if (!meta) return []
    const user = await getCurrentUser()
    if (!canView(meta, user?.id ?? null)) return []
    return listArtifactsForMoment(momentId)
  })
