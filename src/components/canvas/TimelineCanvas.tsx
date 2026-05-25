import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react'
import { EventNode } from './nodes/EventNode'
import { EntityNode } from './nodes/EntityNode'
import { PeriodNode } from './nodes/PeriodNode'
import { instantToX, laneY } from './useTimelineScale'
import { formatInstant } from '~/lib/domain/dates'
import { getGraph } from '~/lib/server/graph'
import type { CanvasNodeData } from './types'
import type { EdgeKind } from '~/lib/domain/types'

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode }

const EDGE_COLOR: Record<EdgeKind, string> = {
  caused: '#e0a458',
  succeeded: '#6aa9ff',
  influenced: '#9b8cff',
  acquired: '#ff6a8b',
  competed_with: '#52c41a',
}

export function TimelineCanvas({ timelineId }: { timelineId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['graph', timelineId],
    queryFn: () => getGraph({ data: timelineId }),
  })

  const gnodes = data?.nodes ?? []
  const gedges = data?.edges ?? []
  const minInstant = gnodes.length ? Math.min(...gnodes.map((n) => n.startInstant)) : 0

  const rfNodes: Node[] = gnodes.map((n) => {
    const x = instantToX(n.startInstant, minInstant)
    const width = n.endInstant ? Math.max(48, instantToX(n.endInstant, minInstant) - x) : undefined
    const nodeData: CanvasNodeData = { title: n.title, width, date: formatInstant(n.startInstant, n.precision) }
    return {
      id: n.id,
      type: n.type,
      position: { x, y: laneY(n.type) },
      data: nodeData,
      draggable: false,
      selectable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  })

  const rfEdges: Edge[] = gedges.map((e) => {
    const color = EDGE_COLOR[e.kind]
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      label: e.label ?? e.kind,
      style: { stroke: color },
      labelStyle: { fill: color, fontSize: 11 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    }
  })

  return (
    <div className="canvas-root">
      <ReactFlow
        // Remount on node-count change so fitView re-frames newly added nodes.
        key={`${timelineId}:${gnodes.length}`}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={48} />
        <Controls showInteractive={false} />
        {!isLoading && gnodes.length === 0 && (
          <Panel position="top-center">
            <div className="canvas-empty">
              Ask the chat to map an industry, field, or technology — nodes will appear here along the timeline.
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}
