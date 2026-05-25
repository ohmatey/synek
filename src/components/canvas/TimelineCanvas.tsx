import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  MarkerType,
  Position,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import { EventNode } from './nodes/EventNode'
import { EntityNode } from './nodes/EntityNode'
import { PeriodNode } from './nodes/PeriodNode'
import { instantToX, laneY, layoutLaneY, estimateNodeHeight } from './useTimelineScale'
import { formatInstant } from '~/lib/domain/dates'
import { getGraph } from '~/lib/server/graph'
import { AppBar } from './AppBar'
import { HistoryControls } from './HistoryControls'
import { NodeDetailPanel } from './NodeDetailPanel'
import { TimeRuler } from './TimeRuler'
import { ExportControls } from './ExportControls'
import { useBuildStream } from './build-stream'
import type { CanvasNodeData, NodeDraft } from './types'
import type { EdgeKind } from '~/lib/domain/types'

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode }

// Re-frame the view when the set of nodes changes (a committed turn or a live
// stream) — without remounting React Flow, so existing nodes keep their identity
// and glide to new positions instead of snapping. Skips the first render (the
// `fitView` prop frames the initial graph).
function AutoFit({ nodeCount, pendingCount }: { nodeCount: number; pendingCount: number }) {
  const rf = useReactFlow()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    rf.fitView({ padding: 0.2, duration: 450 })
  }, [nodeCount, pendingCount, rf])
  return null
}

// Per-kind edge styling: color, stroke width, and dash. Influence/rivalry read
// as softer dashed lines; causal/succession as solid.
const EDGE_STYLE: Record<EdgeKind, { color: string; width: number; dash?: string }> = {
  caused: { color: '#e0a458', width: 2 },
  succeeded: { color: '#6aa9ff', width: 2 },
  influenced: { color: '#9b8cff', width: 1.5, dash: '6 4' },
  acquired: { color: '#ff6a8b', width: 2 },
  competed_with: { color: '#52c41a', width: 1.5, dash: '2 5' },
}

export function TimelineCanvas({ timelineId }: { timelineId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['graph', timelineId],
    queryFn: () => getGraph({ data: timelineId }),
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Draft is stamped with its node id so a stale draft never leaks onto another
  // node during a selection switch.
  const [draft, setDraft] = useState<{ id: string; draft: NodeDraft } | null>(null)

  const { pending, focusIds, setFocusIds } = useBuildStream()
  const focusSet = focusIds.length ? new Set(focusIds) : null

  const gnodes = data?.nodes ?? []
  const gedges = data?.edges ?? []
  // Overlay the panel's in-progress draft on the selected node — a live preview
  // that's never persisted until Save (closing/canceling just drops it).
  const effectiveNodes =
    draft && draft.id === selectedId
      ? gnodes.map((n) => (n.id === selectedId ? { ...n, ...draft.draft } : n))
      : gnodes
  // minInstant spans real + pending so optimistic nodes share the same scale.
  const startInstants = [...effectiveNodes.map((n) => n.startInstant), ...pending.map((p) => p.startInstant)]
  const minInstant = startInstants.length ? Math.min(...startInstants) : 0
  // Derive the selection from live data, so a deleted node closes the panel.
  const selectedNode = selectedId ? (gnodes.find((n) => n.id === selectedId) ?? null) : null

  // Stable so the panel's draft-emit effect doesn't loop on every render.
  const handleDraft = useCallback(
    (d: NodeDraft | null) => setDraft(d && selectedId ? { id: selectedId, draft: d } : null),
    [selectedId],
  )

  const widthOf = (start: number, end: number | null) =>
    end ? Math.max(48, instantToX(end, minInstant) - instantToX(start, minInstant)) : undefined

  const realPositioned = effectiveNodes.map((n) => ({
    n,
    x: instantToX(n.startInstant, minInstant),
    width: widthOf(n.startInstant, n.endInstant),
  }))
  const pendingPositioned = pending.map((p) => ({
    p,
    id: `pending:${p.key}`,
    x: instantToX(p.startInstant, minInstant),
    width: widthOf(p.startInstant, p.endInstant),
  }))

  // Spread same-lane nodes that would overlap horizontally onto stacked rows
  // (real + pending laid out together so they don't collide mid-stream).
  const laneYById = layoutLaneY([
    ...realPositioned.map((r) => ({
      id: r.n.id,
      type: r.n.type,
      x: r.x,
      width: r.width,
      height: estimateNodeHeight(r.n.type, r.n.size, r.n.images.some((i) => i.show)),
    })),
    ...pendingPositioned.map((pp) => ({
      id: pp.id,
      type: pp.p.type,
      x: pp.x,
      width: pp.width,
      height: estimateNodeHeight(pp.p.type, 'medium', false),
    })),
  ])

  const rfNodes: Node[] = []
  for (const { n, x, width } of realPositioned) {
    const nodeData: CanvasNodeData = {
      title: n.title,
      width,
      date: formatInstant(n.startInstant, n.precision),
      citations: n.citations.length,
      images: n.images.filter((i) => i.show),
      size: n.size,
      color: n.color,
    }
    rfNodes.push({
      id: n.id,
      type: n.type,
      position: { x, y: laneYById.get(n.id) ?? laneY(n.type) },
      data: nodeData,
      draggable: false,
      selectable: true,
      selected: n.id === selectedId,
      className: focusSet ? (focusSet.has(n.id) ? 'rf-focused' : 'rf-dimmed') : undefined,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
  }
  for (const { p, id, x, width } of pendingPositioned) {
    const nodeData: CanvasNodeData = { title: p.title, width, date: formatInstant(p.startInstant, p.precision) }
    rfNodes.push({
      id,
      type: p.type,
      position: { x, y: laneYById.get(id) ?? laneY(p.type) },
      data: nodeData,
      draggable: false,
      selectable: false,
      className: 'rf-pending',
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
  }

  const rfEdges: Edge[] = gedges.map((e) => {
    const s = EDGE_STYLE[e.kind]
    // Dim edges that don't connect two focused nodes while a lens is active.
    const dim = focusSet && !(focusSet.has(e.sourceId) && focusSet.has(e.targetId))
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      label: e.label ?? e.kind,
      style: { stroke: s.color, strokeWidth: s.width, strokeDasharray: s.dash, opacity: dim ? 0.12 : undefined },
      labelStyle: { fill: s.color, fontSize: 11, opacity: dim ? 0.12 : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
    }
  })

  return (
    <div className="canvas-root">
      <AppBar timelineId={timelineId} title={data?.title ?? 'Untitled timeline'} />
      <HistoryControls timelineId={timelineId} />
      <ExportControls graph={{ title: data?.title ?? 'Timeline', nodes: gnodes, edges: gedges }} />
      {focusSet && (
        <div className="lens-bar">
          <span>Lens · {focusSet.size} node{focusSet.size === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => setFocusIds([])} title="Clear lens">
            Clear ✕
          </button>
        </div>
      )}
      <ReactFlow
        // Remount only when switching timelines; within one, nodes keep their
        // identity (diffed by id) so position changes glide instead of snapping.
        key={timelineId}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
        fitView
        fitViewOptions={{ padding: 0.2, duration: 600 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={48} />
        <Controls showInteractive={false} />
        <AutoFit nodeCount={gnodes.length} pendingCount={pending.length} />
        {(gnodes.length > 0 || pending.length > 0) && <TimeRuler minInstant={minInstant} />}
        {!isLoading && gnodes.length === 0 && pending.length === 0 && (
          <Panel position="top-center">
            <div className="canvas-empty">
              Ask the chat to map an industry, field, or technology — nodes will appear here along the timeline.
            </div>
          </Panel>
        )}
      </ReactFlow>
      {selectedNode && (
        <NodeDetailPanel
          key={selectedNode.id}
          node={selectedNode}
          edges={gedges}
          nodes={gnodes}
          timelineId={timelineId}
          onClose={() => setSelectedId(null)}
          onSelectNode={setSelectedId}
          onDraft={handleDraft}
        />
      )}
    </div>
  )
}
