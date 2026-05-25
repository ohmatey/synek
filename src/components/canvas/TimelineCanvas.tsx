import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react'
import { EventNode } from './nodes/EventNode'
import { EntityNode } from './nodes/EntityNode'
import { PeriodNode } from './nodes/PeriodNode'
import { instantToX, laneY } from './useTimelineScale'
import type { CanvasNodeData } from './types'

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode }

const yr = (y: number) => Date.UTC(y, 0, 1)

type Sample = { id: string; type: 'event' | 'entity' | 'period'; title: string; start: number; end?: number }

// Sample data so the scaffold is legible before the Phase 0 AI loop lands.
// Phase 0 replaces this with the timeline's real graph (loaded via TanStack Query).
const SAMPLE: Sample[] = [
  { id: 'p1', type: 'period', title: 'Cloud-native observability era', start: yr(2013), end: yr(2024) },
  { id: 'newrelic', type: 'entity', title: 'New Relic', start: yr(2008), end: yr(2024) },
  { id: 'datadog', type: 'entity', title: 'Datadog', start: yr(2010), end: yr(2024) },
  { id: 'prometheus', type: 'event', title: 'Prometheus released', start: yr(2015) },
  { id: 'otel', type: 'event', title: 'OpenTelemetry merge', start: yr(2019) },
]

const minInstant = Math.min(...SAMPLE.map((s) => s.start))

const nodes: Node[] = SAMPLE.map((s) => {
  const x = instantToX(s.start, minInstant)
  const width = s.end ? Math.max(48, instantToX(s.end, minInstant) - x) : undefined
  const data: CanvasNodeData = { title: s.title, width }
  return {
    id: s.id,
    type: s.type,
    position: { x, y: laneY(s.type) },
    data,
    draggable: false,
    selectable: false,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }
})

const EDGE_COLOR = {
  caused: '#e0a458',
  succeeded: '#6aa9ff',
  influenced: '#9b8cff',
  acquired: '#ff6a8b',
  competed_with: '#52c41a',
} as const

function relation(id: string, source: string, target: string, kind: keyof typeof EDGE_COLOR): Edge {
  const color = EDGE_COLOR[kind]
  return {
    id,
    source,
    target,
    label: kind,
    style: { stroke: color },
    labelStyle: { fill: color, fontSize: 11 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  }
}

const edges: Edge[] = [relation('e1', 'prometheus', 'otel', 'influenced')]

export function TimelineCanvas() {
  return (
    <div className="canvas-root">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={48} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
