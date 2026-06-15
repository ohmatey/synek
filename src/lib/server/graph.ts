import { createServerFn } from '@tanstack/react-start'
import { loadGraph, getTimelineMeta, canView, nodeRowToGraphNode, resolveTimelineTheme } from '~/lib/db/graph'
import { storyDepthByMoment, storyVersionForMoments } from '~/lib/db/stories'
import { getCurrentUser } from '~/lib/auth/session'
import type { TimelineGraphResult } from '~/lib/domain/types'

// Client-callable RPC to load a timeline's graph as serializable DTOs, gated by
// visibility: the owner sees it (editable), anyone sees a public timeline
// (read-only), private timelines you don't own are `forbidden`, and a missing id
// is `notFound`. Viewing can be anonymous (getCurrentUser may be null), so this
// does NOT auto-create timelines — creation happens via the home UI or MCP.
export const getGraph = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(async ({ data: timelineId }): Promise<TimelineGraphResult> => {
    const user = await getCurrentUser()
    const meta = getTimelineMeta(timelineId)
    if (!meta) return { status: 'notFound' }
    if (!canView(meta, user?.id ?? null)) return { status: 'forbidden' }

    const { nodes, edges } = loadGraph(timelineId)
    const momentIds = nodes.map((n) => n.id)
    // Which moments carry a story (and at what depth) — one query, for the badge.
    const depthByMoment = storyDepthByMoment(momentIds)
    // A signature of every story on the timeline; the client invalidates an open
    // reader when it shifts (the poll-based path for separate-process writes).
    const storyVersion = storyVersionForMoments(momentIds)
    return {
      status: 'ok',
      isOwner: user?.id != null && meta.ownerId === user.id,
      isPublic: meta.isPublic,
      viewSettings: meta.viewSettings ?? null,
      // Theme inheritance (D5): the timeline's own theme, else its project's.
      theme: resolveTimelineTheme(meta),
      storyVersion,
      title: meta.title,
      nodes: nodes.map((n) => ({
        ...nodeRowToGraphNode(n),
        // The canvas badge needs the per-moment story depth the bare mapper omits.
        hasStory: depthByMoment.has(n.id),
        storyDepth: depthByMoment.get(n.id) ?? null,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        kind: e.kind,
        label: e.label,
      })),
    }
  })
