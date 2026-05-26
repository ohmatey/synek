import { createServerFn } from '@tanstack/react-start'
import { ensureTimeline, loadGraph, getTimelineTitle, momentStoryInfo } from '~/lib/db/graph'
import type { TimelineGraph } from '~/lib/domain/types'

// Client-callable RPC to load a timeline's graph as serializable DTOs. The db
// import (bun:sqlite) is server-only and stripped from the client bundle.
export const getGraph = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(({ data: timelineId }): TimelineGraph => {
    ensureTimeline(timelineId)
    const { nodes, edges } = loadGraph(timelineId)
    const storyInfo = momentStoryInfo(timelineId)
    return {
      title: getTimelineTitle(timelineId),
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        summary: n.summary,
        startInstant: n.startInstant,
        endInstant: n.endInstant,
        precision: n.precision,
        citations: n.metadata?.citations ?? [],
        images: n.metadata?.images ?? [],
        size: n.metadata?.size ?? 'medium',
        color: n.metadata?.color ?? null,
        subtype: n.metadata?.subtype ?? null,
        storyCount: storyInfo.get(n.id)?.storyCount ?? 0,
        topHook: storyInfo.get(n.id)?.topHook ?? null,
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
