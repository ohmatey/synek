import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  MarkerType,
  Position,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import { useTheme } from '@synek/ui'
import { EventNode } from './nodes/EventNode'
import { EntityNode } from './nodes/EntityNode'
import { PeriodNode } from './nodes/PeriodNode'
import {
  laneY,
  layoutLaneY,
  estimateNodeHeight,
  personCardWidth,
  makeTimeScale,
  loadScalePref,
  saveScalePref,
  BASE_PX_PER_DAY,
  type TimeScale,
} from './useTimelineScale'
import { formatInstant } from '~/lib/domain/dates'
import { getGraph } from '~/lib/server/graph'
import { AppBar } from './AppBar'
import { HistoryControls } from './HistoryControls'
import { NodeDetailPanel } from './NodeDetailPanel'
import { TimeRuler } from './TimeRuler'
import { CanvasSettings } from './CanvasSettings'
import { ExportControls } from './ExportControls'
import { useBuildStream } from './build-stream'
import type { CanvasNodeData, NodeDraft } from './types'
import type { EdgeKind } from '~/lib/domain/types'

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode }

// Re-frame the view when the set of nodes changes (e.g. an external MCP edit lands
// and the graph refetches) — without remounting React Flow, so existing nodes keep
// their identity and glide to new positions instead of snapping. Skips the first
// render (the `fitView` prop frames the initial graph).
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

// Per-kind edge styling: color (as a CSS var so it flips light/dark via the
// active theme), stroke width, and dash. Influence/rivalry read as softer
// dashed lines; causal/succession as solid.
const EDGE_STYLE: Record<EdgeKind, { color: string; width: number; dash?: string }> = {
  caused: { color: 'var(--color-accent-story)', width: 2 },
  succeeded: { color: 'var(--color-accent-dialogue)', width: 2 },
  influenced: { color: 'var(--color-accent-influence)', width: 1.5, dash: '6 4' },
  acquired: { color: 'var(--color-danger)', width: 2 },
  competed_with: { color: 'var(--color-success)', width: 1.5, dash: '2 5' },
}

export function TimelineCanvas({ timelineId }: { timelineId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['graph', timelineId],
    queryFn: () => getGraph({ data: timelineId }),
  })
  const { resolvedTheme } = useTheme()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Horizontal time density (px/day) + gap-collapsing — the axis scale,
  // independent of camera zoom. Seeded from the per-timeline saved preference.
  const initialPref = useRef(loadScalePref(timelineId)).current
  const [pxPerDay, setPxPerDay] = useState(initialPref?.pxPerDay ?? BASE_PX_PER_DAY)
  const [collapseGaps, setCollapseGaps] = useState(initialPref?.collapseGaps ?? false)

  // Reload the saved scale when switching timelines (the component persists
  // across timeline changes; only React Flow remounts via key).
  const firstTimeline = useRef(true)
  useEffect(() => {
    if (firstTimeline.current) {
      firstTimeline.current = false
      return
    }
    const pref = loadScalePref(timelineId)
    setPxPerDay(pref?.pxPerDay ?? BASE_PX_PER_DAY)
    setCollapseGaps(pref?.collapseGaps ?? false)
  }, [timelineId])

  // Persist the chosen scale per timeline (local-first; no DB).
  useEffect(() => {
    saveScalePref(timelineId, { pxPerDay, collapseGaps })
  }, [timelineId, pxPerDay, collapseGaps])

  // Latest anchor instants (node start/end), mirrored so the controls can build
  // a prospective scale for keep-center re-anchoring without recomputing here.
  const anchorsRef = useRef<number[]>([])
  const buildScale = useCallback(
    (ppd: number, gaps: boolean): TimeScale => makeTimeScale(anchorsRef.current, ppd, gaps),
    [],
  )
  // Draft is stamped with its node id so a stale draft never leaks onto another
  // node during a selection switch.
  const [draft, setDraft] = useState<{ id: string; draft: NodeDraft } | null>(null)

  const { pending, focusIds, setFocusIds } = useBuildStream()

  // getGraph returns a discriminated result: an `ok` payload (with the graph +
  // access flags), or notFound/forbidden. Non-owners get a read-only canvas.
  const graph = data && data.status === 'ok' ? data : null
  const gnodes = graph?.nodes ?? []
  const gedges = graph?.edges ?? []
  const isOwner = graph?.isOwner ?? false
  const isPublic = graph?.isPublic ?? false
  const title = graph?.title ?? 'Untitled timeline'
  // Derive the selection from live data, so a deleted node closes the panel.
  const selectedNode = selectedId ? (gnodes.find((n) => n.id === selectedId) ?? null) : null

  // Apply the owner-saved default scale once per timeline, but only when this
  // device has no local override (the local working scale wins on a return visit).
  const serverDefaultFor = useRef<string | null>(null)
  useEffect(() => {
    if (serverDefaultFor.current === timelineId) return
    const vs = graph?.viewSettings
    if (!vs) return
    serverDefaultFor.current = timelineId
    if (loadScalePref(timelineId)) return
    setPxPerDay(vs.pxPerDay)
    setCollapseGaps(vs.collapseGaps)
  }, [graph?.viewSettings, timelineId])

  // Stable so the panel's draft-emit effect doesn't loop on every render.
  const handleDraft = useCallback(
    (d: NodeDraft | null) => setDraft(d && selectedId ? { id: selectedId, draft: d } : null),
    [selectedId],
  )

  // The full layout pipeline — overlay, scale, lane packing, and the React Flow
  // node/edge arrays — is O(n log n) and rebuilt only when its inputs change.
  // Memoizing matters because the detail panel emits a fresh draft on every
  // keystroke; without this each keystroke re-packs lanes and re-diffs the graph.
  const { rfNodes, rfEdges, scale } = useMemo(() => {
    const focusSet = focusIds.length ? new Set(focusIds) : null

    // Overlay the panel's in-progress draft on the selected node — a live preview
    // that's never persisted until Save (closing/canceling just drops it).
    const effectiveNodes =
      draft && draft.id === selectedId
        ? gnodes.map((n) => (n.id === selectedId ? { ...n, ...draft.draft } : n))
        : gnodes

    // Anchor instants span real + pending (and span-ends) so optimistic nodes
    // share the scale and gap-collapsing sees every date.
    const anchors = [
      ...effectiveNodes.map((n) => n.startInstant),
      ...effectiveNodes.flatMap((n) => (n.endInstant != null ? [n.endInstant] : [])),
      ...pending.map((p) => p.startInstant),
      ...pending.flatMap((p) => (p.endInstant != null ? [p.endInstant] : [])),
    ]
    anchorsRef.current = anchors
    const scale = makeTimeScale(anchors, pxPerDay, collapseGaps)

    const widthOf = (start: number, end: number | null) =>
      end ? Math.max(48, scale.toX(end) - scale.toX(start)) : undefined

    const realPositioned = effectiveNodes.map((n) => ({
      n,
      x: scale.toX(n.startInstant),
      // Person cards are fixed-size polaroids anchored at the start instant
      // (the lifespan moves into the caption), not stretched across the span.
      width: n.subtype === 'person' ? personCardWidth(n.size) : widthOf(n.startInstant, n.endInstant),
    }))
    const pendingPositioned = pending.map((p) => ({
      p,
      id: `pending:${p.key}`,
      x: scale.toX(p.startInstant),
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
        height: estimateNodeHeight(r.n.type, r.n.size, r.n.images.some((i) => i.show), r.n.subtype),
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
        subtype: n.subtype,
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

    // Period nodes are background context; their connections stay hidden until
    // one endpoint is selected, so the canvas isn't cluttered with links to long
    // time-span bars.
    const periodIds = new Set(gnodes.filter((n) => n.type === 'period').map((n) => n.id))

    const rfEdges: Edge[] = gedges.map((e) => {
      const s = EDGE_STYLE[e.kind]
      const bothFocused = !!focusSet && focusSet.has(e.sourceId) && focusSet.has(e.targetId)
      // Dim edges that don't connect two focused nodes while a lens is active.
      const dim = focusSet && !bothFocused
      const isPeriodEdge = periodIds.has(e.sourceId) || periodIds.has(e.targetId)
      const touchesSelection = selectedId != null && (e.sourceId === selectedId || e.targetId === selectedId)
      const hidden = isPeriodEdge && !touchesSelection && !bothFocused
      return {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.label ?? e.kind,
        hidden,
        style: { stroke: s.color, strokeWidth: s.width, strokeDasharray: s.dash, opacity: dim ? 0.12 : undefined },
        labelStyle: { fill: s.color, fontSize: 11, opacity: dim ? 0.12 : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
      }
    })

    return { rfNodes, rfEdges, scale }
  }, [gnodes, gedges, pending, draft, selectedId, focusIds, pxPerDay, collapseGaps])

  const lensSize = focusIds.length

  // A private timeline you can't see, or a missing one — show a state, not the canvas.
  if (data && data.status !== 'ok') {
    return (
      <div className="canvas-root">
        <div className="canvas-state">
          <h2>{data.status === 'forbidden' ? 'This timeline is private' : 'Timeline not found'}</h2>
          <p>
            {data.status === 'forbidden'
              ? 'Its owner hasn’t made it public. Ask them to enable sharing, or sign in with the owning account.'
              : 'It may have been deleted, or the link is wrong.'}
          </p>
          <a className="canvas-state-home" href="/">
            ← Back home
          </a>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="canvas-root">
        <div className="top-bar">
          <AppBar timelineId={timelineId} title={title} isOwner={isOwner} isPublic={isPublic} />
          <div className="canvas-toolbar">
            {isOwner && <HistoryControls timelineId={timelineId} />}
            {(gnodes.length > 0 || pending.length > 0) && (
              <CanvasSettings
                timelineId={timelineId}
                isOwner={isOwner}
                pxPerDay={pxPerDay}
                collapseGaps={collapseGaps}
                scale={scale}
                buildScale={buildScale}
                onPxPerDay={setPxPerDay}
                onCollapseGaps={setCollapseGaps}
              />
            )}
            <ExportControls graph={{ title, nodes: gnodes, edges: gedges }} />
          </div>
        </div>
        {lensSize > 0 && (
          <div className="lens-bar">
            <span>Lens · {lensSize} node{lensSize === 1 ? '' : 's'}</span>
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
          // Flip xyflow's built-in styles (controls, minimap, attribution, default
          // edge defaults) to match the active app theme. Node accent colors
          // (per-node borderColor) are intentionally NOT theme-coupled — those are
          // domain accents (per node type / per node config), not surface chrome.
          colorMode={resolvedTheme}
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
          {(gnodes.length > 0 || pending.length > 0) && <TimeRuler scale={scale} />}
          {!isLoading && gnodes.length === 0 && pending.length === 0 && (
            <Panel position="top-center">
              <div className="canvas-empty">
                Connect an MCP client to build this timeline — nodes will appear here along the axis.
              </div>
            </Panel>
          )}
        </ReactFlow>
        {selectedNode ? (
          <NodeDetailPanel
            key={selectedNode.id}
            node={selectedNode}
            edges={gedges}
            nodes={gnodes}
            timelineId={timelineId}
            readOnly={!isOwner}
            onClose={() => setSelectedId(null)}
            onSelectNode={setSelectedId}
            onDraft={handleDraft}
          />
        ) : null}
      </div>
    </ReactFlowProvider>
  )
}
