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
import { Pause, Play } from 'lucide-react'
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
import { getStory } from '~/lib/server/stories'
import { useTimelineStream } from './useTimelineStream'
import { AppBar } from './AppBar'
import { ShareDialog } from './ShareDialog'
import { ProfileMenu } from '~/components/ProfileMenu'
import { HistoryControls } from './HistoryControls'
import { NodeDetailPanel } from './NodeDetailPanel'
import { StoryReader } from './StoryReader'
import { TimeRuler } from './TimeRuler'
import { CanvasSettings } from './CanvasSettings'
import { McpStatusChip } from './McpStatusChip'
import { CanvasEmpty } from './CanvasEmpty'
import { StoriesMenu } from './StoriesMenu'
import { useBuildStream } from './build-stream'
import type { CanvasNodeData, NodeDraft } from './types'
import type { EdgeKind, NodeSubtype, NodeType } from '~/lib/domain/types'

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

// Frames the story camera target(s) as the reader steps — the current beat's focus
// node (GAP 1·B), "walking you around the map". Crucially it frames the node in the
// VISIBLE canvas to the LEFT of the docked reader + panel (measured at runtime), not
// centered under them, so the focused entity sits nicely beside the story. maxZoom
// caps the zoom so a single small node isn't blown up; reader-driven, never
// data-driven, so it doesn't fight ViewportInit's saved-camera restore.
const STORY_CAM_MAX_ZOOM = 1.2
const STORY_CAM_PAD = 0.28
function StoryCamera({ ids }: { ids: string[] }) {
  const rf = useReactFlow()
  const key = ids.join(',')
  useEffect(() => {
    if (!ids.length) return
    // World-space bounds of the target node(s), from their measured DOM size.
    const targets = ids.map((id) => rf.getNode(id)).filter(Boolean) as NonNullable<ReturnType<typeof rf.getNode>>[]
    if (!targets.length) {
      rf.fitView({ nodes: ids.map((id) => ({ id })), padding: STORY_CAM_PAD, duration: 450, maxZoom: STORY_CAM_MAX_ZOOM })
      return
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const n of targets) {
      const w = n.measured?.width ?? n.width ?? 0
      const h = n.measured?.height ?? n.height ?? 0
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    }
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    const pane = document.querySelector('.react-flow') as HTMLElement | null
    if (!pane) {
      rf.fitView({ nodes: ids.map((id) => ({ id })), padding: STORY_CAM_PAD, duration: 450, maxZoom: STORY_CAM_MAX_ZOOM })
      return
    }
    const pr = pane.getBoundingClientRect()
    // The docked reader is the leftmost occluder; fall back to the detail panel.
    const dock = (document.querySelector('.story-reader') ?? document.querySelector('.detail-panel')) as HTMLElement | null
    // When the dock sits beside the canvas (not a narrow full-width overlay), the
    // usable width is everything left of it; otherwise use the whole pane.
    let visibleW = pr.width
    if (dock) {
      const dr = dock.getBoundingClientRect()
      if (dr.left > pr.left + 160) visibleW = dr.left - pr.left
    }
    const zoom = Math.max(
      0.1,
      Math.min(
        STORY_CAM_MAX_ZOOM,
        (visibleW * (1 - 2 * STORY_CAM_PAD)) / bw,
        (pr.height * (1 - 2 * STORY_CAM_PAD)) / bh,
      ),
    )
    // Center the node within the visible (left) region, not the whole pane.
    const x = visibleW / 2 - cx * zoom
    const y = pr.height / 2 - cy * zoom
    rf.setViewport({ x, y, zoom }, { duration: 450 })
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
  // While true the docked StoryReader is open beside the panel; activeBeat tracks
  // the beat it's on (drives the per-beat camera + which entity the panel shows).
  // `storyPaused` is lifted so the top story chip can drive play/pause too.
  const [reading, setReading] = useState(false)
  const [activeBeat, setActiveBeat] = useState(0)
  const [storyPaused, setStoryPaused] = useState(false)
  // A moment whose story should auto-open in the reader (set by the AppBar Stories
  // menu). Consumed once its story loads with beats, then cleared.
  const [autoPlayStoryId, setAutoPlayStoryId] = useState<string | null>(null)
  const playStory = useCallback((momentId: string) => {
    setSelectedId(momentId)
    setAutoPlayStoryId(momentId)
  }, [])
  // Selecting a node always drops any open reader first.
  const selectNode = useCallback((id: string) => {
    setReading(false)
    setSelectedId(id)
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

  // The story attached to the selected moment (read-only playback), or null. Keyed
  // by node id so it refetches on selection change; the storyVersion watch above
  // invalidates ['story'] so a live write_story refresh updates an open reader.
  const { data: story } = useQuery({
    queryKey: ['story', selectedId],
    queryFn: () => getStory({ data: selectedId as string }),
    enabled: !!selectedId,
  })
  const momentStory = story ?? null // undefined while loading → treat as none here

  // A new selection drops any open reader; (re)opening starts at beat 0, unpaused.
  useEffect(() => {
    setReading(false)
    setActiveBeat(0)
    setStoryPaused(false)
  }, [selectedId])
  // Auto-play from the AppBar Stories menu: once the picked moment's story loads
  // with beats, open the reader and consume the one-shot signal.
  useEffect(() => {
    if (autoPlayStoryId && autoPlayStoryId === selectedId && momentStory && momentStory.beats.length > 0) {
      setActiveBeat(0)
      setStoryPaused(false)
      setReading(true)
      setAutoPlayStoryId(null)
    }
  }, [autoPlayStoryId, selectedId, momentStory])
  const startReading = useCallback(() => {
    setActiveBeat(0)
    setStoryPaused(false)
    setReading(true)
  }, [])

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
  const nodeById = useMemo(() => new Map(gnodes.map((n) => [n.id, n])), [gnodes])

  // Story lens + per-beat focus — only while READING (selecting a moment just opens
  // its panel; pressing Play starts the story). While reading we ring the moment +
  // its whole cast (every beat's focus + related nodes) and dim the rest, reusing
  // the build-stream lens machinery (rf-focused/rf-dimmed + the lens bar). The active
  // beat's focusNodeId additionally drives the camera and which entity the detail
  // panel shows beside the story — it "follows the beat"; beats with no focus fall
  // back to the moment.
  const storyFocusIds = useMemo(() => {
    if (!reading || !selectedId || !momentStory) return null
    const ids = new Set<string>([selectedId])
    for (const b of momentStory.beats) {
      if (b.focusNodeId) ids.add(b.focusNodeId)
      for (const id of b.relatedNodeIds) ids.add(id)
    }
    return [...ids]
  }, [reading, selectedId, momentStory])
  const activeBeatData =
    reading && momentStory ? momentStory.beats[Math.min(activeBeat, momentStory.beats.length - 1)] : null
  // The entity this beat spotlights: an explicit focusNodeId, else its first related
  // node. BOTH the camera and the detail panel follow it, so the right panel tracks
  // whatever the current beat is about; a beat that names nothing falls back to the
  // moment (the story's originator). Guard self / dangling ids.
  const rawBeatFocus = activeBeatData
    ? (activeBeatData.focusNodeId ?? activeBeatData.relatedNodeIds[0] ?? null)
    : null
  const beatFocusId = rawBeatFocus && rawBeatFocus !== selectedId && nodeById.has(rawBeatFocus) ? rawBeatFocus : null
  const focusNode = beatFocusId ? (nodeById.get(beatFocusId) ?? null) : null
  // The panel follows the beat's focus while reading, else shows the moment.
  const displayNode = focusNode ?? selectedNode
  // Camera only moves while reading; frame the focus (else the moment). Selecting a
  // node never pans the canvas.
  const cameraIds = reading && selectedId ? [beatFocusId ?? selectedId] : null
  // A story lens wins over the build-stream lens while reading.
  const effectiveFocusIds = storyFocusIds ?? focusIds
  // A deleted moment (gone from live data) tears the reader down too.
  useEffect(() => {
    if (!selectedNode && reading) setReading(false)
  }, [selectedNode, reading])
  const noopDraft = useCallback(() => {}, [])

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
      ...realPositioned.map((r) => {
        const shown = r.n.images.filter((i) => i.show)
        // Person cards frame only the first shown image; other nodes tile a strip,
        // so any portrait among them stretches it. Match that for the height estimate.
        const hasPortrait =
          r.n.subtype === 'person'
            ? shown[0]?.aspect === 'portrait'
            : shown.some((i) => i.aspect === 'portrait')
        return {
          id: r.n.id,
          type: r.n.type,
          x: r.x,
          width: r.width,
          lane: r.n.lane,
          height: estimateNodeHeight(r.n.type, r.n.size, shown.length > 0, r.n.subtype, !!r.n.summary, hasPortrait),
        }
      }),
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
            {/* Sharing (public link + export) + account live at the far right of the bar. */}
            <ShareDialog
              timelineId={timelineId}
              graph={{ title, nodes: gnodes, edges: gedges }}
              isOwner={isOwner}
              isPublic={isPublic}
            />
            <ProfileMenu />
          </div>
        </div>
        {lensSize > 0 && (
          <div className="lens-bar">
            <span>
              {reading
                ? `Story · ${momentStory?.title ?? ''}`
                : `Lens · ${lensSize} node${lensSize === 1 ? '' : 's'}`}
            </span>
            {reading ? (
              <>
                {/* Transport for the playing story (mirrors the docked reader). */}
                <button
                  type="button"
                  className="lens-bar-ctrl"
                  onClick={() => setStoryPaused((p) => !p)}
                  aria-pressed={storyPaused}
                  title={storyPaused ? 'Resume' : 'Pause'}
                  aria-label={storyPaused ? 'Resume story' : 'Pause story'}
                >
                  {storyPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
                </button>
                <button type="button" onClick={() => setReading(false)} title="Stop story" aria-label="Stop story">
                  Stop ✕
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setFocusIds([])} title="Clear lens">
                Clear ✕
              </button>
            )}
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
          {cameraIds && <StoryCamera ids={cameraIds} />}
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
        {displayNode ? (
          <NodeDetailPanel
            // Re-key on the displayed node so it remounts (fresh state) when the
            // reader steps to a beat that focuses a different entity.
            key={displayNode.id}
            node={displayNode}
            edges={gedges}
            nodes={gnodes}
            timelineId={timelineId}
            // While reading, the panel is a read-only preview of the beat's focus.
            readOnly={!isOwner || reading}
            preview={reading}
            previewLabel={selectedNode?.title}
            // The story section only shows on the moment when not reading (the
            // docked reader is the story surface while reading).
            story={reading ? undefined : story}
            onClose={() => {
              setSelectedId(null)
              setReading(false)
            }}
            onSelectNode={selectNode}
            // A preview panel must not emit drafts (it shows a different node than
            // the selected moment); the onDraft-change cleanup clears any stale one.
            onDraft={reading ? noopDraft : handleDraft}
            onPlayStory={startReading}
          />
        ) : null}
        {reading && momentStory && selectedNode ? (
          <StoryReader
            story={momentStory}
            momentTitle={selectedNode.title}
            nodeById={nodeById}
            paused={storyPaused}
            onPausedChange={setStoryPaused}
            onClose={() => setReading(false)}
            onSelectNode={selectNode}
            onBeatChange={setActiveBeat}
          />
        ) : null}
      </div>
    </ReactFlowProvider>
  )
}
