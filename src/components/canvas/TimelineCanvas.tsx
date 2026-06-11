import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { ConceptNode } from './nodes/ConceptNode'
import {
  laneY,
  layoutLaneY,
  estimateNodeHeight,
  personCardWidth,
  makeTimeScale,
  loadScalePref,
  saveScalePref,
  loadViewport,
  saveViewport,
  BASE_PX_PER_DAY,
  type SavedViewport,
  type TimeScale,
} from './useTimelineScale'
import { formatInstant, eraTint } from '~/lib/domain/dates'
import { getGraph } from '~/lib/server/graph'
import { useTimelineStream } from './useTimelineStream'
import { AppBar } from './AppBar'
import { ShareControl } from './ShareControl'
import { ProfileMenu } from '~/components/ProfileMenu'
import { HistoryControls } from './HistoryControls'
import { NodeDetailPanel } from './NodeDetailPanel'
import { TimeRuler } from './TimeRuler'
import { CanvasSettings } from './CanvasSettings'
import { McpStatusChip } from './McpStatusChip'
import { CanvasEmpty } from './CanvasEmpty'
import { ExportControls } from './ExportControls'
import { StoriesMenu } from './StoriesMenu'
import { useBuildStream } from './build-stream'
import type { CanvasNodeData, NodeDraft } from './types'
import type { EdgeKind, NodeSubtype, NodeType, StoryDTO } from '~/lib/domain/types'

// The token a node is filtered by: entities filter by their subtype (person/
// org/place/work, or 'entity' when untyped); everything else by its type.
function kindToken(n: { type: NodeType; subtype?: NodeSubtype | null }): string {
  return n.type === 'entity' ? (n.subtype ?? 'entity') : n.type
}

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode, concept: ConceptNode }

// Frame the graph ONCE, the first time nodes arrive (the query loads async, so the
// initial graph appears after mount). If the user has a saved camera for this
// timeline, restore that instead of fitting. Crucially it does NOT re-fit on later
// node-count changes — so a live refetch (or an MCP write) never yanks the user's
// zoom/pan. Re-framing on demand is the explicit Fit button.
function ViewportInit({ timelineId, nodeCount }: { timelineId: string; nodeCount: number }) {
  const rf = useReactFlow()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || nodeCount === 0) return
    done.current = true
    const saved = loadViewport(timelineId)
    if (saved) rf.setViewport(saved)
    else rf.fitView({ padding: 0.2, duration: 0 })
  }, [timelineId, nodeCount, rf])
  return null
}

// Frames the story camera target(s) — the moment on open, then the current beat's
// node as the reader steps (GAP 1·B), "walking you around the map". maxZoom caps the
// zoom so a single small node isn't blown up; this is reader-driven, never data-driven,
// so it doesn't fight ViewportInit's saved-camera restore.
function StoryCamera({ ids }: { ids: string[] }) {
  const rf = useReactFlow()
  const key = ids.join(',')
  useEffect(() => {
    if (!ids.length) return
    rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.3, duration: 450, maxZoom: 1.2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf, key])
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
  const { resolvedTheme } = useTheme()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A moment whose story should auto-open in the Reels viewer (set by the AppBar
  // Stories menu). The detail panel consumes it once its story loads, then clears.
  const [autoPlayStoryId, setAutoPlayStoryId] = useState<string | null>(null)
  const playStory = useCallback((momentId: string) => {
    setSelectedId(momentId)
    setAutoPlayStoryId(momentId)
  }, [])
  // Horizontal time density (px/day) + gap-collapsing — the axis scale,
  // independent of camera zoom. Seeded from the per-timeline saved preference.
  const initialPref = useRef(loadScalePref(timelineId)).current
  const [pxPerDay, setPxPerDay] = useState(initialPref?.pxPerDay ?? BASE_PX_PER_DAY)
  const [collapseGaps, setCollapseGaps] = useState(initialPref?.collapseGaps ?? false)
  // Live updates from the MCP client — on by default, toggled in settings.
  const [autoRefresh, setAutoRefresh] = useState(initialPref?.autoRefresh ?? true)

  // Near-real-time stream (SSE). While the stream is healthy it drives freshness
  // (refetch on each frame) and pollingInterval stays false; if it drops, the hook
  // surfaces a polling interval the query below falls back to (also the only path
  // that picks up writes from the separate-process stdio MCP server).
  const { pollingInterval } = useTimelineStream({ timelineId, enabled: autoRefresh })

  const { data, isLoading } = useQuery({
    queryKey: ['graph', timelineId],
    queryFn: () => getGraph({ data: timelineId }),
    // ViewportInit keeps the camera stable across refetches, so new nodes appear
    // without a jump. SSE drives refetches live; this interval is the fallback.
    refetchInterval: autoRefresh ? pollingInterval : false,
  })

  // A separate-process (stdio) story write emits no SSE frame, so an open reader
  // (keyed ['story', nodeId]) won't refresh from the stream — it converges only
  // via the graph poll. getGraph carries a storyVersion signature that shifts on
  // any story write/rewrite; when it changes here, invalidate the ['story'] family
  // so an open reader refetches. (Same-process writes still refresh instantly via
  // the SSE 'story' frame in useTimelineStream; this is the poll-based floor.)
  const qc = useQueryClient()
  const storyVersion = data && data.status === 'ok' ? data.storyVersion : null
  const prevStoryVersion = useRef<string | null>(null)
  useEffect(() => {
    if (storyVersion == null) return
    if (prevStoryVersion.current != null && prevStoryVersion.current !== storyVersion) {
      void qc.invalidateQueries({ queryKey: ['story'] })
    }
    prevStoryVersion.current = storyVersion
  }, [storyVersion, qc])

  // Reload the saved scale + refresh pref when switching timelines (the component
  // persists across timeline changes; only React Flow remounts via key).
  const firstTimeline = useRef(true)
  useEffect(() => {
    if (firstTimeline.current) {
      firstTimeline.current = false
      return
    }
    const pref = loadScalePref(timelineId)
    setPxPerDay(pref?.pxPerDay ?? BASE_PX_PER_DAY)
    setCollapseGaps(pref?.collapseGaps ?? false)
    setAutoRefresh(pref?.autoRefresh ?? true)
    // New timeline → re-baseline the story-version watch so the first load of the
    // new graph isn't mistaken for a story write.
    prevStoryVersion.current = null
  }, [timelineId])

  // Persist the chosen scale per timeline (local-first; no DB).
  useEffect(() => {
    saveScalePref(timelineId, { pxPerDay, collapseGaps, autoRefresh })
  }, [timelineId, pxPerDay, collapseGaps, autoRefresh])

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

  // Story lens: when a story opens, ring the moment + its referenced nodes and dim
  // the rest, reusing the build-stream lens machinery (rf-focused/rf-dimmed + the
  // lens bar). Set by the detail panel reporting its loaded story up; cleared when
  // the reader closes. While active it overrides the build-stream focus.
  const [storyLens, setStoryLens] = useState<{ momentId: string; title: string; focusIds: string[] } | null>(null)
  // The node ids the story camera frames (GAP 1·B): the moment on open, the current
  // beat's target as the reader steps. Null → fall back to framing the moment.
  const [storyCamIds, setStoryCamIds] = useState<string[] | null>(null)
  const handleStoryLoaded = useCallback(
    (story: StoryDTO | null) => {
      setStoryCamIds(null) // reset the camera to the moment on (re)load / clear
      if (!story || !selectedId) {
        setStoryLens(null)
        return
      }
      const ids = new Set<string>([selectedId])
      for (const b of story.beats) for (const id of b.relatedNodeIds) ids.add(id)
      setStoryLens({ momentId: selectedId, title: story.title, focusIds: [...ids] })
    },
    [selectedId],
  )
  const handleStoryCamera = useCallback((ids: string[]) => setStoryCamIds(ids), [])
  // A story lens wins over the build-stream lens while reading.
  const effectiveFocusIds = storyLens ? storyLens.focusIds : focusIds

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

  // Per-kind visibility filter — session-only (a returning user shouldn't find
  // nodes "missing"). Node counts feed the filter chips.
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(() => new Set())
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of gnodes) m.set(kindToken(n), (m.get(kindToken(n)) ?? 0) + 1)
    return m
  }, [gnodes])
  const toggleKind = useCallback((token: string) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token)
      else next.add(token)
      return next
    })
  }, [])
  const resetKinds = useCallback(() => setHiddenKinds(new Set()), [])

  // Briefly glow nodes that newly arrived (e.g. from a live MCP write) so the
  // user notices what changed — without the camera moving.
  const [glowIds, setGlowIds] = useState<Set<string>>(() => new Set())
  const prevIdsRef = useRef<Set<string> | null>(null)
  const glowTimelineRef = useRef(timelineId)
  const nodeIdKey = gnodes.map((n) => n.id).join(',')
  useEffect(() => {
    const current = new Set(gnodes.map((n) => n.id))
    const prev = prevIdsRef.current
    prevIdsRef.current = current
    if (glowTimelineRef.current !== timelineId) {
      glowTimelineRef.current = timelineId
      return // timeline switched — establish a baseline, don't glow everything
    }
    if (!prev) return // first load — don't glow the whole graph
    const fresh = [...current].filter((id) => !prev.has(id))
    if (fresh.length === 0) return
    setGlowIds(new Set(fresh))
    const t = setTimeout(() => setGlowIds(new Set()), 2000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdKey, timelineId])

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
    const focusSet = effectiveFocusIds.length ? new Set(effectiveFocusIds) : null

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

    // Kind filter: keep the time axis anchored on the full set (so toggling a
    // kind doesn't reflow the scale), but only render/lay out the visible nodes.
    const hiddenNodeIds = hiddenKinds.size
      ? new Set(effectiveNodes.filter((n) => hiddenKinds.has(kindToken(n))).map((n) => n.id))
      : null
    const visibleNodes = hiddenNodeIds ? effectiveNodes.filter((n) => !hiddenNodeIds.has(n.id)) : effectiveNodes

    const widthOf = (start: number, end: number | null) =>
      end ? Math.max(48, scale.toX(end) - scale.toX(start)) : undefined

    const realPositioned = visibleNodes.map((n) => ({
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
        lane: r.n.lane,
        height: estimateNodeHeight(r.n.type, r.n.size, r.n.images.some((i) => i.show), r.n.subtype, !!r.n.summary),
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
        endDate: n.endInstant != null ? formatInstant(n.endInstant, n.precision) : undefined,
        summary: n.summary ?? undefined,
        hasSummary: !!n.summary,
        citations: n.citations.length,
        images: n.images.filter((i) => i.show),
        size: n.size,
        color: n.color,
        subtype: n.subtype,
        hasStory: n.hasStory,
        storyDepth: n.storyDepth,
        // Period background reads the era of its date range (period nodes only).
        tint: n.type === 'period' ? eraTint(n.startInstant, n.endInstant) : undefined,
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
      const touchesHidden = !!hiddenNodeIds && (hiddenNodeIds.has(e.sourceId) || hiddenNodeIds.has(e.targetId))
      const hidden = touchesHidden || (isPeriodEdge && !touchesSelection && !bothFocused)
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
  }, [gnodes, gedges, pending, draft, selectedId, effectiveFocusIds, pxPerDay, collapseGaps, hiddenKinds])

  // Layer the transient "new node" glow on top WITHOUT re-running lane packing
  // (a cheap shallow remap, vs. recomputing the whole layout in the memo above).
  const displayNodes = useMemo(
    () =>
      glowIds.size === 0
        ? rfNodes
        : rfNodes.map((node) =>
            glowIds.has(node.id)
              ? { ...node, className: [node.className, 'rf-focused'].filter(Boolean).join(' ') }
              : node,
          ),
    [rfNodes, glowIds],
  )

  // Debounced persistence of the camera, so a reload/live-refetch restores the
  // user's framing instead of snapping back to fit.
  const vpSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistViewport = useCallback(
    (_: unknown, vp: SavedViewport) => {
      if (vpSaveTimer.current) clearTimeout(vpSaveTimer.current)
      vpSaveTimer.current = setTimeout(() => saveViewport(timelineId, vp), 200)
    },
    [timelineId],
  )

  const lensSize = effectiveFocusIds.length

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
            {isOwner && <McpStatusChip />}
            {isOwner && <HistoryControls timelineId={timelineId} />}
            {gnodes.some((n) => n.hasStory) && (
              <StoriesMenu timelineId={timelineId} storyVersion={storyVersion ?? ''} onPlay={playStory} />
            )}
            {(gnodes.length > 0 || pending.length > 0) && (
              <CanvasSettings
                timelineId={timelineId}
                isOwner={isOwner}
                pxPerDay={pxPerDay}
                collapseGaps={collapseGaps}
                autoRefresh={autoRefresh}
                scale={scale}
                buildScale={buildScale}
                counts={kindCounts}
                hiddenKinds={hiddenKinds}
                onToggleKind={toggleKind}
                onResetKinds={resetKinds}
                onPxPerDay={setPxPerDay}
                onCollapseGaps={setCollapseGaps}
                onAutoRefresh={setAutoRefresh}
              />
            )}
            <ExportControls graph={{ title, nodes: gnodes, edges: gedges }} />
            {/* Sharing + account live at the far right of the bar. */}
            {isOwner && <ShareControl timelineId={timelineId} isPublic={isPublic} />}
            <ProfileMenu />
          </div>
        </div>
        {lensSize > 0 && (
          <div className="lens-bar">
            <span>
              {storyLens ? `Story · ${storyLens.title}` : `Lens · ${lensSize} node${lensSize === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              // Closing a story lens closes the reader (which clears the lens via the
              // panel's unmount); a build lens just clears its focus.
              onClick={() => (storyLens ? setSelectedId(null) : setFocusIds([]))}
              title={storyLens ? 'Close story' : 'Clear lens'}
            >
              {storyLens ? 'Close ✕' : 'Clear ✕'}
            </button>
          </div>
        )}
        <ReactFlow
          // Remount only when switching timelines; within one, nodes keep their
          // identity (diffed by id) so position changes glide instead of snapping.
          key={timelineId}
          nodes={displayNodes}
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
          // Initial framing is owned by ViewportInit (restores saved camera, or
          // fits once on first load) — NOT the `fitView` prop, which would also
          // re-fit on async data and fight viewport restore.
          onMoveEnd={persistViewport}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={48} />
          <Controls showInteractive={false} />
          <ViewportInit timelineId={timelineId} nodeCount={gnodes.length} />
          {storyLens && <StoryCamera ids={storyCamIds?.length ? storyCamIds : [storyLens.momentId]} />}
          {(gnodes.length > 0 || pending.length > 0) && <TimeRuler scale={scale} />}
          {!isLoading && gnodes.length === 0 && pending.length === 0 && (
            <Panel position="top-center">
              {isOwner ? (
                <CanvasEmpty />
              ) : (
                <div className="canvas-empty">This timeline is empty — its author hasn’t added anything yet.</div>
              )}
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
            onStoryLoaded={handleStoryLoaded}
            onStoryCamera={handleStoryCamera}
            autoPlayStory={autoPlayStoryId === selectedNode.id}
            onAutoPlayConsumed={() => setAutoPlayStoryId(null)}
          />
        ) : null}
      </div>
    </ReactFlowProvider>
  )
}
