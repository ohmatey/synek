import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { instantToX, laneY, layoutLaneY, estimateNodeHeight, personCardWidth } from './useTimelineScale'
import { formatInstant } from '~/lib/domain/dates'
import { getGraph } from '~/lib/server/graph'
import { AppBar } from './AppBar'
import { HistoryControls } from './HistoryControls'
import { NodeDetailPanel } from './NodeDetailPanel'
import { StoryReaderPanel } from './StoryReaderPanel'
import { TimeRuler } from './TimeRuler'
import { ExportControls } from './ExportControls'
import { useBuildStream } from './build-stream'
import { generateStory, getStories, regenerateStory } from '~/lib/server/stories'
import type { CanvasNodeData, NodeDraft } from './types'
import type { EdgeKind, StoryDTO } from '~/lib/domain/types'

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

// Drives the camera during story playback: frames the focus set (the moment +
// the current beat's related moments), and re-centers when a related link is
// tapped. `focusKey` is the value-key of `ids` so the effect fires by content.
function StoryCamera({
  focusKey,
  ids,
  center,
}: {
  focusKey: string
  ids: string[]
  center: { id: string; n: number } | null
}) {
  const rf = useReactFlow()
  useEffect(() => {
    if (ids.length) rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, duration: 500 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, rf])
  useEffect(() => {
    if (center) rf.fitView({ nodes: [{ id: center.id }], padding: 0.6, duration: 500 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, rf])
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

  const { pending, focusIds, setFocusIds, chatOpen, setChatOpen } = useBuildStream()

  // --- Story playback (the reader shares the detail-panel slot) ---
  const qc = useQueryClient()
  const [story, setStory] = useState<StoryDTO | null>(null)
  const [storyMomentId, setStoryMomentId] = useState<string | null>(null)
  const [beat, setBeat] = useState(0)
  const [storyBusy, setStoryBusy] = useState<false | 'loading' | 'regenerating'>(false)
  const [storyError, setStoryError] = useState<string | null>(null)
  const [centerReq, setCenterReq] = useState<{ id: string; n: number } | null>(null)

  const openStory = useCallback(
    async (momentId: string) => {
      setSelectedId(null) // the story takes over the detail slot (mutually exclusive)
      setStoryMomentId(momentId)
      setStory(null)
      setBeat(0)
      setStoryError(null)
      setStoryBusy('loading')
      try {
        const existing = await getStories({ data: momentId })
        const s = existing[0] ?? (await generateStory({ data: momentId }))
        setStory(s)
        if (!existing[0]) await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      } catch (e) {
        setStoryError(e instanceof Error ? e.message : 'Could not compose the story.')
      } finally {
        setStoryBusy(false)
      }
    },
    [qc, timelineId],
  )

  const regenerate = useCallback(async () => {
    if (!story) return
    setStoryBusy('regenerating')
    setStoryError(null)
    try {
      const s = await regenerateStory({ data: story.id })
      setStory(s)
      setBeat(0)
      await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    } catch (e) {
      setStoryError(e instanceof Error ? e.message : 'Could not regenerate the story.')
    } finally {
      setStoryBusy(false)
    }
  }, [story, qc, timelineId])

  const closeStory = useCallback(() => {
    setStory(null)
    setStoryMomentId(null)
    setBeat(0)
    setStoryError(null)
    setStoryBusy(false)
    setCenterReq(null)
    setFocusIds([])
  }, [setFocusIds])

  const focusRelated = useCallback((id: string) => setCenterReq({ id, n: Date.now() }), [])

  const gnodes = data?.nodes ?? []
  const gedges = data?.edges ?? []
  // Derive the selection from live data, so a deleted node closes the panel.
  const selectedNode = selectedId ? (gnodes.find((n) => n.id === selectedId) ?? null) : null

  // Stable so the panel's draft-emit effect doesn't loop on every render.
  const handleDraft = useCallback(
    (d: NodeDraft | null) => setDraft(d && selectedId ? { id: selectedId, draft: d } : null),
    [selectedId],
  )

  // While a story plays, lens the moment + the current beat's related moments
  // (reusing the build-stream focus lens) and keep the camera framed on them.
  const presentIds = new Set(gnodes.map((n) => n.id))
  const beatRelated = (story?.segments[beat]?.relatedNodeIds ?? []).filter((id) => presentIds.has(id))
  const storyFocus = storyMomentId && presentIds.has(storyMomentId) ? [storyMomentId, ...beatRelated] : null
  const storyFocusKey = storyFocus ? storyFocus.join(',') : ''
  const nodeTitles = Object.fromEntries(gnodes.map((n) => [n.id, n.title]))

  useEffect(() => {
    if (storyFocus) setFocusIds(storyFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyFocusKey])

  // The full layout pipeline — overlay, scale, lane packing, and the React Flow
  // node/edge arrays — is O(n log n) and rebuilt only when its inputs change.
  // Memoizing matters because the detail panel emits a fresh draft on every
  // keystroke; without this each keystroke re-packs lanes and re-diffs the graph.
  const { rfNodes, rfEdges, minInstant } = useMemo(() => {
    const focusSet = focusIds.length ? new Set(focusIds) : null

    // Overlay the panel's in-progress draft on the selected node — a live preview
    // that's never persisted until Save (closing/canceling just drops it).
    const effectiveNodes =
      draft && draft.id === selectedId
        ? gnodes.map((n) => (n.id === selectedId ? { ...n, ...draft.draft } : n))
        : gnodes
    // minInstant spans real + pending so optimistic nodes share the same scale.
    const startInstants = [...effectiveNodes.map((n) => n.startInstant), ...pending.map((p) => p.startInstant)]
    const minInstant = startInstants.length ? Math.min(...startInstants) : 0

    const widthOf = (start: number, end: number | null) =>
      end ? Math.max(48, instantToX(end, minInstant) - instantToX(start, minInstant)) : undefined

    const realPositioned = effectiveNodes.map((n) => ({
      n,
      x: instantToX(n.startInstant, minInstant),
      // Person cards are fixed-size polaroids anchored at the start instant
      // (the lifespan moves into the caption), not stretched across the span.
      width: n.subtype === 'person' ? personCardWidth(n.size) : widthOf(n.startInstant, n.endInstant),
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
        storyCount: n.storyCount,
        hook: n.topHook,
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

    return { rfNodes, rfEdges, minInstant }
  }, [gnodes, gedges, pending, draft, selectedId, focusIds])

  const lensSize = focusIds.length

  return (
    <div className={`canvas-root${chatOpen ? '' : ' chat-collapsed'}`}>
      <div className="top-bar">
        <AppBar timelineId={timelineId} title={data?.title ?? 'Untitled timeline'} />
        <div className="canvas-toolbar">
          <HistoryControls timelineId={timelineId} />
          <ExportControls graph={{ title: data?.title ?? 'Timeline', nodes: gnodes, edges: gedges }} />
          <button
            type="button"
            className="toolbar-btn toolbar-btn-chat"
            onClick={() => setChatOpen(!chatOpen)}
            aria-pressed={chatOpen}
            title={chatOpen ? 'Hide chat' : 'Show chat'}
          >
            {chatOpen ? 'Chat ›' : '‹ Chat'}
          </button>
        </div>
      </div>
      {lensSize > 0 && !storyMomentId && (
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
        onNodeClick={(_, n) => {
          closeStory() // a node tap leaves story playback for that node's detail
          setSelectedId(n.id)
        }}
        onPaneClick={() => setSelectedId(null)}
        fitView
        fitViewOptions={{ padding: 0.2, duration: 600 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={48} />
        <Controls showInteractive={false} />
        <AutoFit nodeCount={gnodes.length} pendingCount={pending.length} />
        <StoryCamera focusKey={storyFocusKey} ids={storyFocus ?? []} center={centerReq} />
        {(gnodes.length > 0 || pending.length > 0) && <TimeRuler minInstant={minInstant} />}
        {!isLoading && gnodes.length === 0 && pending.length === 0 && (
          <Panel position="top-center">
            <div className="canvas-empty">
              Ask the chat to map an industry, field, or technology — nodes will appear here along the timeline.
            </div>
          </Panel>
        )}
      </ReactFlow>
      {storyMomentId ? (
        <StoryReaderPanel
          momentTitle={gnodes.find((n) => n.id === storyMomentId)?.title ?? 'Moment'}
          story={story}
          beat={beat}
          busy={storyBusy}
          error={storyError}
          nodeTitles={nodeTitles}
          onBeat={setBeat}
          onRegenerate={regenerate}
          onFocusRelated={focusRelated}
          onClose={closeStory}
        />
      ) : selectedNode ? (
        <NodeDetailPanel
          key={selectedNode.id}
          node={selectedNode}
          edges={gedges}
          nodes={gnodes}
          timelineId={timelineId}
          onClose={() => setSelectedId(null)}
          onSelectNode={setSelectedId}
          onDraft={handleDraft}
          onOpenStory={openStory}
        />
      ) : null}
    </div>
  )
}
