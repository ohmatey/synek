import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  MarkerType,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import { useTheme } from '@synek/ui'
import { resolveThemeVars } from '~/lib/theme/resolveTimelineTheme'
import type { TimelineTheme } from '~/lib/domain/types'
import { EventNode } from './nodes/EventNode'
import { EntityNode } from './nodes/EntityNode'
import { PeriodNode } from './nodes/PeriodNode'
import { ConceptNode } from './nodes/ConceptNode'
import { InvitationNode } from './nodes/InvitationNode'
import {
  laneY,
  layoutLaneY,
  estimateNodeHeight,
  personCardWidth,
  workCardWidth,
  entityCardWidth,
  eventPillWidth,
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
import { findDeadZones } from '~/lib/domain/dead-zones'
import { capture } from '~/lib/posthog/client'
import { PromptDialog, type PromptSpec } from '~/components/PromptDialog'
import { fillGapSpec, extendLaneSpec, populateEraSpec } from '~/lib/verbs'
import { getGraph } from '~/lib/server/graph'
import { getStoriesForMomentFn, getStoryByIdFn } from '~/lib/server/stories'
import { useTimelineStream } from './useTimelineStream'
import { AppBar } from './AppBar'
import { ShareDialog } from './ShareDialog'
import { ProfileMenu } from '~/components/ProfileMenu'
import { HistoryControls } from './HistoryControls'
import { NodeDetailPanel } from './NodeDetailPanel'
import { centerOnNodes } from './cameraFocus'
import { CommandPalette } from './CommandPalette'
import { StoryReader } from './StoryReader'
import { TimeRuler } from './TimeRuler'
import { CanvasSettings } from './CanvasSettings'
import { McpStatusChip } from './McpStatusChip'
import { CanvasEmpty } from './CanvasEmpty'
import { StoriesMenu } from './StoriesMenu'
import { useBuildStream } from './build-stream'
import {
  loadPanelWidths,
  savePanelWidths,
  clampDetail,
  clampStory,
  type PanelWidths,
} from './usePanelSize'
import type { CanvasNodeData, NodeDraft } from './types'
import type { EdgeKind, NodeSubtype, NodeType } from '~/lib/domain/types'

// The token a node is filtered by: entities filter by their subtype (person/
// org/place/work, or 'entity' when untyped); everything else by its type.
function kindToken(n: { type: NodeType; subtype?: NodeSubtype | null }): string {
  return n.type === 'entity' ? (n.subtype ?? 'entity') : n.type
}

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode, concept: ConceptNode, invitation: InvitationNode }

// Invitation ghosts (NEXT.5 Tier 2): the dashed card's fixed width, the vertical
// band gap/era ghosts sit in (a dead zone is horizontally empty across all lanes,
// so any y in the timeline band is collision-free), and per-kind on-screen caps.
const GAP_CARD_W = 188
const GAP_Y = 72
const ERA_Y = 120
const MAX_GAP_GHOSTS = 4
const MAX_LANE_GHOSTS = 3
const MAX_ERA_GHOSTS = 3
// A lane/era counts as worth an invitation at or below this many real nodes.
const SPARSE_LANE_MAX = 2
const BARE_ERA_MAX = 1

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
function StoryCamera({ ids, dockW }: { ids: string[]; dockW: number }) {
  const rf = useReactFlow()
  const key = ids.join(',')
  // Step pans glide (450ms); re-centering because the user dragged a panel edge
  // should track the cursor instantly, so those re-runs use duration 0.
  const prevKey = useRef<string | null>(null)
  useEffect(() => {
    if (!ids.length) return
    const stepped = prevKey.current !== key
    prevKey.current = key
    const duration = stepped ? 450 : 0
    centerOnNodes(rf, ids, { duration, maxZoom: STORY_CAM_MAX_ZOOM, pad: STORY_CAM_PAD })
    // dockW re-triggers this when a panel is resized so the focus node stays
    // centered in the canvas left of the (now wider/narrower) dock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf, key, dockW])
  return null
}

// Flies the camera to a single node chosen from the ⌘K palette. Lives inside
// <ReactFlow> so useReactFlow has context (a Radix-portaled palette can't reach
// it). Selecting a node mounts the detail panel — which animates in via
// `dock-slide-in` (translateX over 260ms) — and, if the node's kind was
// filtered out, newly mounts the node too. Both confound an immediate measure:
// centerOnNodes reads the dock's getBoundingClientRect (which reflects the live
// transform) and the node's measured size. So rAF-poll until BOTH have settled
// (node measured + dock edge stops moving), capped so it always fires. Under
// prefers-reduced-motion the panel has no animation, so it settles on the second
// frame and still feels instant.
const FLY_SETTLE_FRAMES = 24
function FlyToCamera({ targetId, onArrive }: { targetId: string | null; onArrive: () => void }) {
  const rf = useReactFlow()
  useEffect(() => {
    if (!targetId) return
    let raf = 0
    let frames = 0
    let prevLeft = Number.NaN
    const tick = () => {
      frames += 1
      const measured = !!rf.getNode(targetId)?.measured?.width
      // The leftmost occluder, same query centerOnNodes uses; its left edge
      // glides while dock-slide-in runs, so stability across two frames ⇒ at rest.
      const dock = (document.querySelector('.story-reader') ??
        document.querySelector('.detail-panel')) as HTMLElement | null
      const left = dock ? dock.getBoundingClientRect().left : Number.NaN
      const dockSettled = !dock || left === prevLeft
      prevLeft = left
      if ((measured && dockSettled) || frames >= FLY_SETTLE_FRAMES) {
        try {
          centerOnNodes(rf, [targetId], { duration: 450, maxZoom: 1.2, pad: 0.28 })
        } finally {
          onArrive()
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [rf, targetId, onArrive])
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
  // A node chosen from the ⌘K palette to fly the camera to (one-shot; cleared
  // by FlyToCamera once it has framed the node).
  const [flyToId, setFlyToId] = useState<string | null>(null)
  // The fill-this-gap prompt shown in the shared PromptDialog (null = closed),
  // opened by clicking a dashed gap-invitation ghost on the canvas (NEXT.5 Tier 2).
  const [gapSpec, setGapSpec] = useState<PromptSpec | null>(null)
  // A moment can hold several stories; this is the one the docked reader plays.
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  // While true the docked StoryReader is open beside the panel; activeBeat tracks
  // the beat it's on (drives the per-beat camera + which entity the panel shows; -1
  // = on the cover, so the moment stays framed).
  // `storyPaused` is lifted so the top story chip can drive play/pause too.
  const [reading, setReading] = useState(false)
  const [activeBeat, setActiveBeat] = useState(-1)
  const [storyPaused, setStoryPaused] = useState(false)
  // Theme being live-previewed by the ThemeEditorDialog (wins over the saved
  // one while editing); null = show the server-saved theme.
  const [previewTheme, setPreviewTheme] = useState<TimelineTheme | null>(null)
  // User-resizable widths for the right-docked panels (detail + story reader).
  // Applied as CSS vars on .canvas-root; persisted to localStorage on release.
  const [panelW, setPanelW] = useState<PanelWidths>(() => loadPanelWidths())
  const panelWRef = useRef(panelW)
  panelWRef.current = panelW
  const resizeDetail = useCallback((next: number) => setPanelW((w) => ({ ...w, detail: clampDetail(next) })), [])
  const resizeStory = useCallback((next: number) => setPanelW((w) => ({ ...w, story: clampStory(next) })), [])
  const commitPanelW = useCallback(() => savePanelWidths(panelWRef.current), [])
  // A story that should auto-open in the reader (set by the AppBar Stories menu).
  // Consumed once it loads with beats, then cleared. Mirrored in a ref so the
  // selection-change effect below can see a pending autoplay without taking it
  // as a dependency — picking a story also CHANGES the selection, and that
  // effect must not clobber the story id it was set together with.
  const [autoPlay, setAutoPlay] = useState<{ momentId: string; storyId: string } | null>(null)
  const autoPlayRef = useRef<{ momentId: string; storyId: string } | null>(null)
  const playStory = useCallback((momentId: string, storyId: string) => {
    autoPlayRef.current = { momentId, storyId }
    setSelectedId(momentId)
    setSelectedStoryId(storyId)
    setAutoPlay({ momentId, storyId })
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
  // True once the USER explicitly adjusted the scale on this device (vs the
  // ambient auto-save below) — only then does the local pref beat the timeline's
  // saved default view. Persisted in the pref so the choice survives reloads.
  const scaleChosen = useRef(initialPref?.chosen ?? false)
  const choosePxPerDay = useCallback((v: number) => {
    scaleChosen.current = true
    setPxPerDay(v)
  }, [])
  const chooseCollapseGaps = useCallback((v: boolean) => {
    scaleChosen.current = true
    setCollapseGaps(v)
  }, [])
  // Live updates from the MCP client — on by default, toggled in settings.
  const [autoRefresh, setAutoRefresh] = useState(initialPref?.autoRefresh ?? true)
  // Read-aloud story narration (Web Speech API) — opt-in, off by default.
  const [speakStories, setSpeakStories] = useState(initialPref?.speak ?? false)

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
  // any story write/rewrite; when it changes here, invalidate the ['story'] +
  // ['stories'] families so an open reader AND the panel's per-moment list refetch.
  // (Same-process writes still refresh instantly via the SSE 'story' frame in
  // useTimelineStream; this is the poll-based floor.)
  const qc = useQueryClient()
  const storyVersion = data && data.status === 'ok' ? data.storyVersion : null
  const prevStoryVersion = useRef<string | null>(null)
  useEffect(() => {
    if (storyVersion == null) return
    if (prevStoryVersion.current != null && prevStoryVersion.current !== storyVersion) {
      void qc.invalidateQueries({ queryKey: ['story'] })
      void qc.invalidateQueries({ queryKey: ['stories'] })
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
    setSpeakStories(pref?.speak ?? false)
    scaleChosen.current = pref?.chosen ?? false
    measuredRef.current = new Map() // sizes belong to the previous timeline's nodes
    setPreviewTheme(null) // a theme preview belongs to the previous timeline
    // New timeline → re-baseline the story-version watch so the first load of the
    // new graph isn't mistaken for a story write.
    prevStoryVersion.current = null
  }, [timelineId])

  // Persist the scale per timeline (local-first; no DB). Runs on mount too, so
  // the pref's mere existence means nothing — `chosen` carries the user intent.
  useEffect(() => {
    saveScalePref(timelineId, { pxPerDay, collapseGaps, autoRefresh, speak: speakStories, chosen: scaleChosen.current })
  }, [timelineId, pxPerDay, collapseGaps, autoRefresh, speakStories])

  // Measured DOM size per node id — the layout's second pass. Estimates place
  // nodes on first paint; once React Flow measures the real cards, lanes re-pack
  // with the truth, so estimate drift can never overlap nodes again. A ref +
  // version counter (not state) so a burst of dimension events costs one re-pack.
  const measuredRef = useRef(new Map<string, { w: number; h: number }>())
  const [measuredVersion, setMeasuredVersion] = useState(0)
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    let dirty = false
    for (const c of changes) {
      if (c.type !== 'dimensions' || !c.dimensions) continue
      const { width, height } = c.dimensions
      if (!width || !height) continue
      const prev = measuredRef.current.get(c.id)
      // Sub-2px jitter (zoom rounding) doesn't earn a re-pack.
      if (prev && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) continue
      measuredRef.current.set(c.id, { w: width, h: height })
      dirty = true
    }
    if (dirty) setMeasuredVersion((v) => v + 1)
  }, [])

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

  // Every story on the selected moment — backs the panel's compact list. Keyed by
  // node id so it refetches on selection change; the storyVersion watch invalidates
  // ['stories'] so a live write_story refresh updates the list.
  const { data: stories } = useQuery({
    queryKey: ['stories', selectedId],
    queryFn: () => getStoriesForMomentFn({ data: selectedId as string }),
    enabled: !!selectedId,
  })
  // The full DTO of the story the reader plays (chosen from the list), or null. Keyed
  // by story id; the storyVersion watch invalidates ['story'] so a live rewrite
  // refreshes an open reader.
  const { data: readingStoryData } = useQuery({
    queryKey: ['story', selectedStoryId],
    queryFn: () => getStoryByIdFn({ data: selectedStoryId as string }),
    enabled: !!selectedStoryId,
  })
  const readingStory = readingStoryData ?? null // undefined while loading → treat as none

  // A new selection drops any open reader + its chosen story — unless that story
  // was picked together with the selection (AppBar autoplay): nulling it here
  // would disable the story query and the autoplay below could never fire.
  useEffect(() => {
    setReading(false)
    if (autoPlayRef.current?.momentId !== selectedId) {
      autoPlayRef.current = null
      setSelectedStoryId(null)
    }
    setActiveBeat(-1)
    setStoryPaused(false)
  }, [selectedId])
  // Auto-play from the AppBar Stories menu: once the picked story loads with beats,
  // open the reader and consume the one-shot signal.
  useEffect(() => {
    if (
      autoPlay &&
      autoPlay.momentId === selectedId &&
      autoPlay.storyId === selectedStoryId &&
      readingStory &&
      readingStory.beats.length > 0
    ) {
      setActiveBeat(-1)
      setStoryPaused(false)
      setReading(true)
      autoPlayRef.current = null
      setAutoPlay(null)
    }
  }, [autoPlay, selectedId, selectedStoryId, readingStory])
  const startReading = useCallback((storyId: string) => {
    setSelectedStoryId(storyId)
    setActiveBeat(-1)
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
  // The timeline's saved theme (live: an MCP set_timeline_theme lands via the
  // same SSE → refetch path as everything else). The editor's preview wins
  // while it's open; saving/cancelling hands back to server truth.
  const timelineTheme = graph?.theme ?? null
  const effectiveTheme = previewTheme ?? timelineTheme
  const themeVars = useMemo(
    () => resolveThemeVars(effectiveTheme, resolvedTheme),
    [effectiveTheme, resolvedTheme],
  )
  // 'default' = today's untextured canvas (the plain 48px dot grid).
  const texture = effectiveTheme?.texture ?? 'default'
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
    if (!reading || !selectedId || !readingStory) return null
    const ids = new Set<string>([selectedId])
    for (const b of readingStory.beats) {
      if (b.focusNodeId) ids.add(b.focusNodeId)
      for (const id of b.relatedNodeIds) ids.add(id)
    }
    return [...ids]
  }, [reading, selectedId, readingStory])
  // activeBeat is -1 on the cover → no beat focus (frame the moment).
  const activeBeatData =
    reading && readingStory && activeBeat >= 0
      ? readingStory.beats[Math.min(activeBeat, readingStory.beats.length - 1)]
      : null
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

  // ⌘K palette pick: if the node's kind is currently filtered out, reveal it
  // first (else the camera would chase a node that isn't rendered), then select
  // it (opens the detail panel, drops any reader) and arm the fly-to camera.
  const flyTo = useCallback(
    (id: string) => {
      const n = nodeById.get(id)
      if (n) {
        const token = kindToken(n)
        setHiddenKinds((prev) => {
          if (!prev.has(token)) return prev
          const next = new Set(prev)
          next.delete(token)
          return next
        })
      }
      selectNode(id)
      setFlyToId(id)
    },
    [nodeById, selectNode],
  )
  // Stable so FlyToCamera's effect (which depends on onArrive) doesn't re-run
  // every render; clears the one-shot target once the camera has framed it.
  const clearFlyTo = useCallback(() => setFlyToId(null), [])

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

  // Apply the saved default scale (owner "save as default" / MCP set_timeline_view)
  // whenever its VALUE changes — including live, mid-session, as a building agent
  // calls set_timeline_view. A device where the user explicitly adjusted the scale
  // keeps its own (`chosen`); the ambient auto-saved pref does not block this.
  const serverDefaultKey = useRef<string | null>(null)
  useEffect(() => {
    const vs = graph?.viewSettings
    if (!vs) return
    const key = `${timelineId}|${vs.pxPerDay}|${vs.collapseGaps}`
    if (serverDefaultKey.current === key) return
    serverDefaultKey.current = key
    if (loadScalePref(timelineId)?.chosen) return
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
      // Person and work cards are fixed-size (polaroid/cover) anchored at the
      // start instant (the span moves into the caption), not stretched across
      // the span. Other spanless nodes need an honest width too — the packer
      // can only prevent overlap if it knows the rendered size: entities get a
      // fixed card width, event pills a text-driven estimate.
      width:
        n.subtype === 'person'
          ? personCardWidth(n.size)
          : n.subtype === 'work'
            ? workCardWidth(n.size)
            : (widthOf(n.startInstant, n.endInstant) ??
            (n.type === 'entity'
              ? entityCardWidth(n.size)
              : n.type === 'event'
                ? eventPillWidth(n.title, n.size)
                : undefined)),
    }))
    const pendingPositioned = pending.map((p) => ({
      p,
      id: `pending:${p.key}`,
      x: scale.toX(p.startInstant),
      width:
        widthOf(p.startInstant, p.endInstant) ??
        (p.type === 'entity' ? entityCardWidth() : p.type === 'event' ? eventPillWidth(p.title) : undefined),
    }))

    // Spread same-lane nodes that would overlap horizontally onto stacked rows
    // (real + pending laid out together so they don't collide mid-stream).
    // Measured DOM sizes (second pass) beat the estimates once available.
    const m = measuredRef.current
    const laneYById = layoutLaneY([
      ...realPositioned.map((r) => {
        const shown = r.n.images.filter((i) => i.show)
        // Person/work cards frame only the first shown image; other nodes tile a
        // strip, so any portrait among them stretches it. Match that for the
        // height estimate.
        const hasPortrait =
          r.n.subtype === 'person' || r.n.subtype === 'work'
            ? shown[0]?.aspect === 'portrait'
            : shown.some((i) => i.aspect === 'portrait')
        // A fixed-width entity card clamps a long title to a second line, which
        // estimateNodeHeight's single-line body doesn't cover (the person/work
        // card bodies already budget a two-line plate).
        const titleWrap =
          r.n.type === 'entity' &&
          r.n.subtype !== 'person' &&
          r.n.subtype !== 'work' &&
          r.n.endInstant == null &&
          r.n.title.length > 16
            ? 16
            : 0
        const meas = m.get(r.n.id)
        return {
          id: r.n.id,
          type: r.n.type,
          x: r.x,
          width: meas?.w ?? r.width,
          lane: r.n.lane,
          height:
            meas?.h ??
            estimateNodeHeight(r.n.type, r.n.size, shown.length > 0, r.n.subtype, !!r.n.summary, hasPortrait) +
              titleWrap,
        }
      }),
      ...pendingPositioned.map((pp) => ({
        id: pp.id,
        type: pp.p.type,
        x: pp.x,
        width: m.get(pp.id)?.w ?? pp.width,
        height: m.get(pp.id)?.h ?? estimateNodeHeight(pp.p.type, 'medium', false),
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

    // Invitation ghosts (NEXT.5 Tier 2): the map showing its own holes and offering
    // to fill them. Three variants, all dashed InvitationNode cards opening the
    // shared fill PromptDialog. Each capped so the canvas stays calm. Owner-only —
    // these are authoring affordances ("Fill this gap" / "Add to this track" /
    // "Populate this era") that hand the user a build prompt; a public read-only
    // viewer can't build, so they never see the ghosts and the public/seed canvas
    // stays an exact reflection of its real nodes.
    if (isOwner) {
      // 1. GAP — a dead zone (big empty stretch of the axis). LINEAR mode only;
      //    collapse mode already squeezes big gaps (so a ghost would sit in a squeezed
      //    span — the collapsed-range marker is its own future affordance). Skip any
      //    zone a period bar spans (its start/end bracket the gap → the bar fills it).
      if (!collapseGaps) {
        const gapInstants = effectiveNodes.flatMap((n) => [
          n.startInstant,
          ...(n.endInstant != null ? [n.endInstant] : []),
        ])
        const zones = findDeadZones(gapInstants)
          .filter(
            (z) =>
              !effectiveNodes.some(
                (n) => n.startInstant <= z.fromInstant && (n.endInstant ?? n.startInstant) >= z.toInstant,
              ),
          )
          .slice(0, MAX_GAP_GHOSTS)
        for (const z of zones) {
          const midX = scale.toX((z.fromInstant + z.toInstant) / 2)
          rfNodes.push({
            id: `inv-gap:${z.fromInstant}:${z.toInstant}`,
            type: 'invitation',
            position: { x: midX - GAP_CARD_W / 2, y: GAP_Y },
            data: {
              variant: 'gap',
              title: `≈ ${z.years} years empty`,
              subtitle: `${formatInstant(z.fromInstant, 'year')} → ${formatInstant(z.toInstant, 'year')}`,
              cta: 'Fill this gap',
              cardWidth: GAP_CARD_W,
              onFill: () => setGapSpec(fillGapSpec(z, { timelineId, timelineTitle: title, surface: 'canvas_gap' })),
            },
            draggable: false,
            selectable: false,
          })
        }
      }

      // 2. LANE — a thin swimlane ("rival track" with ≤ SPARSE_LANE_MAX nodes). Ghost
      //    sits just past the lane's rightmost node, in that lane's row.
      const laneStats = new Map<string, { count: number; maxRight: number; y: number }>()
      for (const r of realPositioned) {
        if (!r.n.lane) continue
        const right = r.x + (r.width ?? GAP_CARD_W)
        const y = laneYById.get(r.n.id) ?? GAP_Y
        const g = laneStats.get(r.n.lane) ?? { count: 0, maxRight: -Infinity, y }
        g.count++
        g.maxRight = Math.max(g.maxRight, right)
        laneStats.set(r.n.lane, g)
      }
      const sparseLanes = [...laneStats.entries()].filter(([, g]) => g.count <= SPARSE_LANE_MAX).slice(0, MAX_LANE_GHOSTS)
      for (const [lane, g] of sparseLanes) {
        rfNodes.push({
          id: `inv-lane:${lane}`,
          type: 'invitation',
          position: { x: g.maxRight + 24, y: g.y },
          data: {
            variant: 'lane',
            title: lane,
            subtitle: 'thin track',
            cta: 'Add to this track',
            cardWidth: GAP_CARD_W,
            onFill: () => setGapSpec(extendLaneSpec(lane, { timelineId, timelineTitle: title, surface: 'canvas_lane' })),
          },
          draggable: false,
          selectable: false,
        })
      }

      // 3. ERA — a period with ≤ BARE_ERA_MAX nodes inside its span. Ghost sits at the
      //    era's midpoint, below the period bar.
      const bareEras = effectiveNodes
        .filter((n) => n.type === 'period')
        .filter((p) => {
          const end = p.endInstant ?? p.startInstant
          const within = effectiveNodes.filter(
            (n) => n.id !== p.id && n.type !== 'period' && n.startInstant >= p.startInstant && n.startInstant <= end,
          )
          return within.length <= BARE_ERA_MAX
        })
        .slice(0, MAX_ERA_GHOSTS)
      for (const p of bareEras) {
        const end = p.endInstant ?? p.startInstant
        const midX = scale.toX((p.startInstant + end) / 2)
        rfNodes.push({
          id: `inv-era:${p.id}`,
          type: 'invitation',
          position: { x: midX - GAP_CARD_W / 2, y: ERA_Y },
          data: {
            variant: 'era',
            title: p.title,
            subtitle: `${formatInstant(p.startInstant, 'year')} → ${formatInstant(end, 'year')}`,
            cta: 'Populate this era',
            cardWidth: GAP_CARD_W,
            onFill: () =>
              setGapSpec(
                populateEraSpec(
                  { title: p.title, fromInstant: p.startInstant, toInstant: end },
                  { timelineId, timelineTitle: title, surface: 'canvas_era' },
                ),
              ),
          },
          draggable: false,
          selectable: false,
        })
      }
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
        // Humanize the relation kind: snake_case → spaced words ("competed_with"
        // → "competed with"). Explicit labels are already human, shown as-is.
        label: e.label ?? e.kind.replace(/_/g, ' '),
        hidden,
        style: { stroke: s.color, strokeWidth: s.width, strokeDasharray: s.dash, opacity: dim ? 0.12 : undefined },
        labelStyle: { fill: s.color, fontSize: 11, fontWeight: 500, opacity: dim ? 0.12 : undefined },
        // A canvas-bg pill plate behind the label so it doesn't collide with the
        // nodes it routes between. Reads the pane wash (themed canvasBg or the
        // brand bg-base) so the plate always matches the surface it sits on.
        labelBgStyle: { fill: 'var(--xy-background-color, var(--color-bg-base))', fillOpacity: dim ? 0.12 : 0.88 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 999,
        markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
      }
    })

    return { rfNodes, rfEdges, scale }
    // measuredVersion stands in for measuredRef.current's contents (a ref, so
    // not a valid dep itself) — it bumps exactly when a node's DOM size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gnodes, gedges, pending, draft, selectedId, effectiveFocusIds, pxPerDay, collapseGaps, hiddenKinds, measuredVersion, timelineId, title, isOwner])

  // Impression for the Tier-2 canvas invitations (gap/lane/era ghosts), so the
  // fill-gap/extend-lane/populate-era copy events have a denominator — copy-RATE,
  // not just count (bet B5). Keyed on the per-variant counts so it fires once per
  // distinct invitation set per timeline (not every render), and again if the set
  // changes as the graph builds (e.g. a gap gets filled and its ghost disappears).
  const invitationCounts = useMemo(() => {
    const c = { gap: 0, lane: 0, era: 0 }
    for (const n of rfNodes) {
      if (n.type !== 'invitation') continue
      const v = (n.data as { variant?: 'gap' | 'lane' | 'era' }).variant
      if (v) c[v] += 1
    }
    return c
  }, [rfNodes])
  const invitationSig = `${timelineId}:${invitationCounts.gap}:${invitationCounts.lane}:${invitationCounts.era}`
  useEffect(() => {
    const { gap, lane, era } = invitationCounts
    if (gap + lane + era === 0) return
    capture('invitation_shown', { timeline_id: timelineId, gap, lane, era })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationSig])

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
      <div
        className="canvas-root"
        data-canvas-texture={texture}
        style={
          {
            '--detail-panel-w': `${panelW.detail}px`,
            '--story-reader-w': `${panelW.story}px`,
            // Per-timeline theme overrides (inline custom properties cascade to
            // every canvas descendant). React drops keys absent from a new style
            // object, so clearing the theme reverts in one render.
            ...themeVars,
          } as React.CSSProperties
        }
      >
        <div className="top-bar">
          <AppBar timelineId={timelineId} title={title} isOwner={isOwner} isPublic={isPublic} />
          <div className="canvas-toolbar">
            {gnodes.length > 0 && (
              <CommandPalette
                nodes={gnodes}
                onSelect={flyTo}
                timelineId={timelineId}
                timelineTitle={title}
                selectedNode={selectedNode}
              />
            )}
            {isOwner && <McpStatusChip />}
            {isOwner && <HistoryControls timelineId={timelineId} />}
            {(isOwner || gnodes.some((n) => n.hasStory)) && (
              <StoriesMenu
                timelineId={timelineId}
                storyVersion={storyVersion ?? ''}
                canCreate={isOwner}
                nodes={gnodes.map((n) => ({ id: n.id, title: n.title, type: n.type }))}
                onPlay={playStory}
              />
            )}
            {(gnodes.length > 0 || pending.length > 0) && (
              <CanvasSettings
                timelineId={timelineId}
                timelineTitle={title}
                isOwner={isOwner}
                pxPerDay={pxPerDay}
                collapseGaps={collapseGaps}
                autoRefresh={autoRefresh}
                scale={scale}
                buildScale={buildScale}
                onPxPerDay={choosePxPerDay}
                onCollapseGaps={chooseCollapseGaps}
                onAutoRefresh={setAutoRefresh}
                speak={speakStories}
                onSpeak={setSpeakStories}
                kindCounts={kindCounts}
                hiddenKinds={hiddenKinds}
                onToggleKind={toggleKind}
                onResetKinds={resetKinds}
                theme={timelineTheme}
                onPreviewTheme={setPreviewTheme}
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
        {/* The lens-bar is build-stream chrome only; while a story plays the
            docked reader carries its own transport, so no bar up top. */}
        {lensSize > 0 && !reading && (
          <div className="lens-bar">
            <span>{`Lens · ${lensSize} node${lensSize === 1 ? '' : 's'}`}</span>
            <button type="button" onClick={() => setFocusIds([])} title="Clear lens">
              Clear ✕
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
          // Dimension changes feed the measured-size layout pass; we never apply
          // the changes back (positions are owned by the layout memo).
          onNodesChange={handleNodesChange}
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
          {/* Texture: 'default' keeps the classic 48px dot grid; 'dots'/'grid'
              are denser, visible variants (styles.css strengthens their pattern
              color); 'paper' is a CSS grain layer and 'none' is a clean wash —
              both render no RF Background. */}
          {texture !== 'none' && texture !== 'paper' && (
            <Background
              gap={texture === 'dots' ? 20 : 48}
              size={texture === 'dots' ? 2.5 : undefined}
              lineWidth={texture === 'grid' ? 1 : undefined}
              variant={texture === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            />
          )}
          <Controls showInteractive={false} />
          <ViewportInit timelineId={timelineId} nodeCount={gnodes.length} />
          {cameraIds && <StoryCamera ids={cameraIds} dockW={panelW.detail + panelW.story} />}
          <FlyToCamera targetId={flyToId} onArrive={clearFlyTo} />
          {(gnodes.length > 0 || pending.length > 0) && (
            <TimeRuler
              scale={scale}
              // In collapse-gaps mode a dead zone is squeezed to a break marker
              // instead of an open span — so the marker itself becomes the fill
              // affordance (owner only), the collapse-mode twin of the gap ghost.
              onFillGap={
                isOwner
                  ? (fromInstant, toInstant) => {
                      const years = Math.max(
                        1,
                        Math.round((toInstant - fromInstant) / (365.25 * 86_400_000)),
                      )
                      setGapSpec(
                        fillGapSpec(
                          { fromInstant, toInstant, years },
                          { timelineId, timelineTitle: title, surface: 'canvas_gap_collapsed' },
                        ),
                      )
                    }
                  : undefined
              }
            />
          )}
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
            // While reading, the panel is the story-mode portrait of the beat's
            // focus (no relations/stories/citations, no editing).
            readOnly={!isOwner}
            mode={reading ? 'story' : 'default'}
            storyLabel={selectedNode?.title}
            // The story list only shows on the moment when not reading (the docked
            // reader is the story surface while reading).
            stories={reading ? undefined : stories}
            onClose={() => {
              setSelectedId(null)
              setReading(false)
            }}
            onSelectNode={selectNode}
            // A preview panel must not emit drafts (it shows a different node than
            // the selected moment); the onDraft-change cleanup clears any stale one.
            onDraft={reading ? noopDraft : handleDraft}
            onPlayStory={startReading}
            width={panelW.detail}
            onResize={resizeDetail}
            onCommitResize={commitPanelW}
          />
        ) : null}
        {reading && readingStory && selectedNode ? (
          <StoryReader
            // Re-key on the story so switching stories resets the reader (cover, beat 0).
            key={readingStory.id}
            story={readingStory}
            momentTitle={selectedNode.title}
            momentId={selectedNode.id}
            timelineId={timelineId}
            nodeById={nodeById}
            paused={storyPaused}
            onPausedChange={setStoryPaused}
            speak={speakStories}
            onSpeakChange={setSpeakStories}
            onClose={() => setReading(false)}
            onSelectNode={selectNode}
            onBeatChange={setActiveBeat}
            width={panelW.story}
            onResize={resizeStory}
            onCommitResize={commitPanelW}
          />
        ) : null}
        {/* Fill-this-gap prompt, opened by a dashed gap-invitation ghost (Tier 2). */}
        <PromptDialog open={!!gapSpec} onOpenChange={(o) => { if (!o) setGapSpec(null) }} spec={gapSpec} />
      </div>
    </ReactFlowProvider>
  )
}
