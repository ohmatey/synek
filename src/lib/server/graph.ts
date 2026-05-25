import { createServerFn } from '@tanstack/react-start'
import { ensureTimeline, loadGraph } from '~/lib/db/graph'
import type { TimelineGraph } from '~/lib/domain/types'

// Client-callable RPC to load a timeline's graph as serializable DTOs. The db
// import (bun:sqlite) is server-only and stripped from the client bundle.
export const getGraph = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(({ data: timelineId }): TimelineGraph => {
    ensureTimeline(timelineId)
    const { nodes, edges } = loadGraph(timelineId)
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        startInstant: n.startInstant,
        endInstant: n.endInstant,
        precision: n.precision,
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
