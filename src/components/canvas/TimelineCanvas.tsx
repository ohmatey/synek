import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
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
import { LabeledEdge } from './edges/LabeledEdge'
import {
  laneY,
  layoutLaneY,
  estimateNodeHeight,
  personCardWidth,
  workCardWidth,
  entityCardWidth,
  eventPillWidth,
  makeTimeScale,
  placeEdgeLabel,
  estimateLabelWidth,
  LABEL_HEIGHT,
  NOMINAL_WIDTH as NOMINAL_NODE_WIDTH,
  type LabelRect,
  loadScalePref,
  collapseFromPref,
  orientationFromPref,
  suggestionsFromPref,
  loadDismissedGhosts,
  dismissGhost,
  resetDismissedGhosts,
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
import { fillGapSpec, extendLaneSpec, populateEraSpec, globeBackfillSpec } from '~/lib/verbs'
import { ViewSwitcher, type CanvasView } from './ViewSwitcher'
import { AddMenu, AddDialogs, type AddMode } from './AddMenu'
import { MoreMenu } from './MoreMenu'
import { globeCoverage } from './globe-coverage'
import type { GlobeControls } from './GlobeLens'
import { getGraph } from '~/lib/server/graph'
import { getStoriesForMomentFn, getStoryByIdFn } from '~/lib/server/stories'
import { useTimelineStream } from './useTimelineStream'
import { AppBar } from './AppBar'
import { CanvasLayout } from './CanvasLayout'
import { ShareDialog } from './ShareDialog'
import { HistoryShortcuts } from './HistoryShortcuts'
import { NodeDetailPanel } from './NodeDetailPanel'
import { centerOnNodes } from './cameraFocus'
import { CommandPalette } from './CommandPalette'
import { StoryReader } from './StoryReader'
import { TimelineScrubber, TimelineZoomControls } from './TimelineScroller'
import { CanvasSettings } from './CanvasSettings'
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
import type { EdgeKind, NodeOrientation, NodeSubtype, NodeType } from '~/lib/domain/types'

// The token a node is filtered by: entities filter by their subtype (person/
// org/place/work, or 'entity' when untyped); everything else by its type.
function kindToken(n: { type: NodeType; subtype?: NodeSubtype | null }): string {
  return n.type === 'entity' ? (n.subtype ?? 'entity') : n.type
}

// Memoized module-level — required by React Flow.
const nodeTypes = { event: EventNode, entity: EntityNode, period: PeriodNode, concept: ConceptNode, invitation: InvitationNode }
const edgeTypes = { labeled: LabeledEdge }

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
    // Cap the zoom so a sparse graph (one or two nodes) frames at a sane scale instead
    // of magnifying a single node — otherwise the canvas opens looking near-empty.
    else rf.fitView({ padding: 0.2, duration: 0, maxZoom: 1.2 })
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

// Lazy + code-split: d3-geo + the world TopoJSON (~60-75kB gzip) load only when the
// user first switches to the globe lens, never on the initial canvas paint or SSR.
const GlobeLens = lazy(() => import('./GlobeLens'))

export function TimelineCanvas({ timelineId }: { timelineId: string }) {
  const { resolvedTheme } = useTheme()
  // ── URL-backed canvas state ──────────────────────────────────────────────
  // view / active node / open story live in the URL search params (see the route's
  // validateSearch) so the canvas is deep-linkable, shareable, and reload-stable —
  // the MCP client can hand back a precise link. The URL is the single source of
  // truth; these expose a useState-compatible [value, setter] so call sites are
  // unchanged. Setters resolve against the freshest params (navigate's updater
  // form) and `replace`, so selecting nodes doesn't spam browser history; a value
  // at its default is dropped from the URL. A node/story id that isn't in the live
  // graph yet (an MCP build still streaming) simply resolves to nothing-selected.
  const search = useSearch({ from: '/timelines/$id' })
  const navigate = useNavigate({ from: '/timelines/$id' })
  const selectedId = search.node ?? null
  const setSelectedId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) =>
      navigate({
        replace: true,
        search: (prev) => {
          const next = typeof action === 'function' ? action(prev.node ?? null) : action
          return { ...prev, node: next ?? undefined }
        },
      }),
    [navigate],
  )
  const selectedStoryId = search.story ?? null
  const setSelectedStoryId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) =>
      navigate({
        replace: true,
        search: (prev) => {
          const next = typeof action === 'function' ? action(prev.story ?? null) : action
          return { ...prev, story: next ?? undefined }
        },
      }),
    [navigate],
  )
  const lensView: CanvasView = search.view ?? 'timeline'
  const setLensView = useCallback<Dispatch<SetStateAction<CanvasView>>>(
    (action) =>
      navigate({
        replace: true,
        search: (prev) => {
          const cur: CanvasView = prev.view ?? 'timeline'
          const next = typeof action === 'function' ? action(cur) : action
          return { ...prev, view: next === 'timeline' ? undefined : next }
        },
      }),
    [navigate],
  )
  // A node chosen from the ⌘K palette to fly the camera to (one-shot; cleared
  // by FlyToCamera once it has framed the node).
  const [flyToId, setFlyToId] = useState<string | null>(null)
  // GS2: the lazy GlobeLens registers its imperative zoom handle here while mounted,
  // so ⌘K "Globe: zoom in/out/reset" can drive it. Null when the globe isn't open.
  const globeControlsRef = useRef<GlobeControls | null>(null)
  // The fill-this-gap prompt shown in the shared PromptDialog (null = closed),
  // opened by clicking a dashed gap-invitation ghost on the canvas (NEXT.5 Tier 2).
  const [gapSpec, setGapSpec] = useState<PromptSpec | null>(null)
  // While true the docked StoryReader is open beside the panel; activeBeat tracks
  // the beat it's on (drives the per-beat camera + which entity the panel shows; -1
  // = on the cover, so the moment stays framed).
  // `storyPaused` is lifted so the top story chip can drive play/pause too.
  const [reading, setReading] = useState(false)
  const [activeBeat, setActiveBeat] = useState(-1)
  const [storyPaused, setStoryPaused] = useState(false)
  // Whether the reader skips its cover and begins stepping the moment it opens. Set
  // per-open by openStory (default true → "Play story" runs straight away); the cover
  // is only kept for non-autoplay deep-links (e.g. Continue writing).
  const [readerAutoStart, setReaderAutoStart] = useState(false)
  // Theme being live-previewed by the ThemeEditorDialog (wins over the saved
  // one while editing); null = show the server-saved theme.
  const [previewTheme, setPreviewTheme] = useState<TimelineTheme | null>(null)
  // Unified "Add" surface: which flow is open (driven by the Add button AND ⌘K),
  // plus the ⋯ More menu's two controlled dialogs (settings + share).
  const [addMode, setAddMode] = useState<AddMode>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // User-resizable widths for the right-docked panels (detail + story reader).
  // Applied as CSS vars on .canvas-root; persisted to localStorage on release.
  const [panelW, setPanelW] = useState<PanelWidths>(() => loadPanelWidths())
  const panelWRef = useRef(panelW)
  panelWRef.current = panelW
  const resizeDetail = useCallback((next: number) => setPanelW((w) => ({ ...w, detail: clampDetail(next) })), [])
  const resizeStory = useCallback((next: number) => setPanelW((w) => ({ ...w, story: clampStory(next) })), [])
  const commitPanelW = useCallback(() => savePanelWidths(panelWRef.current), [])
  // The view to restore when the reader closes — captured when a story opens, so
  // closing a story opened from the Stories list returns to the list, while one
  // opened from a node panel stays on the timeline. A ref (read at close time).
  const storyReturnViewRef = useRef<CanvasView>('timeline')
  // Open a story in the docked reader (from the Stories panel or a node panel).
  // DECOUPLED from selection: it sets ONLY the story — the moment is NOT selected and
  // no entity panel opens. By default it runs straight away (autoStart skips the cover
  // and begins stepping); the immersive lens effect then tours the beats across the
  // globe + timeline. Pass { autoStart: false } to land on the cover (Continue writing).
  const openStory = useCallback(
    (storyId: string, opts?: { autoStart?: boolean }) => {
      storyReturnViewRef.current = search.view ?? 'timeline'
      setReaderAutoStart(opts?.autoStart ?? true)
      setSelectedStoryId(storyId)
      setActiveBeat(-1)
      setStoryPaused(false)
      setReading(true)
    },
    [search.view, setSelectedStoryId],
  )
  // Close the reader and restore the view the story was opened from.
  const closeReader = useCallback(() => {
    setReading(false)
    setSelectedStoryId(null)
    setActiveBeat(-1)
    setStoryPaused(false)
    setLensView(storyReturnViewRef.current)
  }, [setSelectedStoryId, setLensView])
  // Open an entity panel for a node (canvas / ⌘K / cast-chip click). DECOUPLED:
  // this never closes an open story — opening an entity is an optional side-trip.
  const selectNode = useCallback((id: string) => setSelectedId(id), [setSelectedId])
  // Horizontal time density (px/day) + gap-collapsing — the axis scale,
  // independent of camera zoom. Seeded from the per-timeline saved preference.
  const initialPref = useRef(loadScalePref(timelineId)).current
  const [pxPerDay, setPxPerDay] = useState(initialPref?.pxPerDay ?? BASE_PX_PER_DAY)
  const [collapseGaps, setCollapseGaps] = useState(collapseFromPref(initialPref))
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
  // Card shape for event/concept nodes. Like collapseGaps it has a timeline-level
  // saved default, so an explicit choice on this device must mark `chosen`.
  const [nodeOrientation, setNodeOrientation] = useState<NodeOrientation>(orientationFromPref(initialPref))
  const chooseNodeOrientation = useCallback((v: NodeOrientation) => {
    scaleChosen.current = true
    setNodeOrientation(v)
  }, [])
  // Owner-only invitation ghosts: a global switch plus a per-ghost dismissal set.
  // Both device-local — a suggestion is an offer, never graph state.
  const [showSuggestions, setShowSuggestions] = useState(suggestionsFromPref(initialPref))
  const [dismissedGhosts, setDismissedGhosts] = useState<Set<string>>(() => loadDismissedGhosts(timelineId))
  const onDismissGhost = useCallback(
    (key: string) => setDismissedGhosts(dismissGhost(timelineId, key)),
    [timelineId],
  )
  const onResetGhosts = useCallback(() => setDismissedGhosts(resetDismissedGhosts(timelineId)), [timelineId])
  // Live updates from the MCP client — on by default, toggled in settings.
  const [autoRefresh, setAutoRefresh] = useState(initialPref?.autoRefresh ?? true)
  // Read-aloud story narration (Web Speech API) — opt-in, off by default.
  const [speakStories, setSpeakStories] = useState(initialPref?.speak ?? false)
  // Timed auto-advance for the story reader (the Reels/Stories slideshow) — on by
  // default; off makes the reader fully manual. Lifted so it persists per-timeline.
  const [autoPlayStories, setAutoPlayStories] = useState(initialPref?.autoPlay ?? true)

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
    setCollapseGaps(collapseFromPref(pref))
    setAutoRefresh(pref?.autoRefresh ?? true)
    setSpeakStories(pref?.speak ?? false)
    setAutoPlayStories(pref?.autoPlay ?? true)
    setNodeOrientation(orientationFromPref(pref))
    setShowSuggestions(suggestionsFromPref(pref))
    setDismissedGhosts(loadDismissedGhosts(timelineId)) // dismissals are per timeline
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
    saveScalePref(timelineId, {
      pxPerDay,
      collapseGaps,
      autoRefresh,
      speak: speakStories,
      autoPlay: autoPlayStories,
      nodeOrientation,
      showSuggestions,
      chosen: scaleChosen.current,
    })
  }, [timelineId, pxPerDay, collapseGaps, autoRefresh, speakStories, autoPlayStories, nodeOrientation, showSuggestions])

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

  // Reset the canvas-side playback transport when the open story changes. Selecting
  // a node no longer touches the reader (stories are decoupled from selection); the
  // reader itself re-keys on the story id, so its internal cover/beat state resets too.
  useEffect(() => {
    setActiveBeat(-1)
    setStoryPaused(false)
  }, [selectedStoryId])

  // A story id in the URL (a deep-link — home Play / Continue writing, or a shared
  // canvas link) raises the docked reader. Now that Stories is a toolbar panel rather
  // than a full-pane lens, the ?story param's only job is to open the reader. We react
  // only when the id *changes* (tracked in a ref): closing the reader flips `reading`
  // false a tick before the URL drops ?story, and without this guard that gap would
  // immediately re-open the story the user just closed.
  const handledStoryRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedStoryId === handledStoryRef.current) return
    handledStoryRef.current = selectedStoryId
    // Home Play passes ?autoplay → run straight away; a bare ?story (Continue writing /
    // a shared canvas link) lands on the cover.
    if (selectedStoryId && !reading) openStory(selectedStoryId, { autoStart: !!search.autoplay })
  }, [selectedStoryId, reading, openStory, search.autoplay])

  // getGraph returns a discriminated result: an `ok` payload (with the graph +
  // access flags), or notFound/forbidden. Non-owners get a read-only canvas.
  const graph = data && data.status === 'ok' ? data : null
  const gnodes = graph?.nodes ?? []
  const gedges = graph?.edges ?? []
  const isOwner = graph?.isOwner ?? false
  const isPublic = graph?.isPublic ?? false
  const title = graph?.title ?? 'Untitled timeline'
  // Globe-lens coverage: gates the backfill prompt + the in-globe coverage banner.
  // The view switcher itself is always shown (the Globe segment is a permanent
  // fixture); coverage only decides what clicking Globe does.
  const globeCov = useMemo(() => globeCoverage(gnodes), [gnodes])
  // Clicking the Globe segment: if any node is located, switch to the globe (the
  // in-globe coverage banner nudges when it's below the gate). With NO located
  // nodes, don't show an empty globe — open the backfill prompt so the user can
  // ask their MCP client to add coordinates (same spec as ⌘K "Set up globe view").
  // Clicking Globe ALWAYS enters the globe — with no coordinates it shows an
  // empty state whose primary action ("Create a globe") opens the setup prompt,
  // rather than interrupting the switch with a dialog.
  const switchToGlobe = useCallback(() => setLensView('globe'), [])
  // Escape exits the globe back to the timeline (PRD §Exit). Let an open dialog
  // (⌘K, a prompt) or a focused text field consume Escape first.
  useEffect(() => {
    if (lensView !== 'globe') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      setLensView('timeline')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lensView])
  // The timeline's saved theme (live: an MCP set_timeline_theme lands via the
  // same SSE → refetch path as everything else). The editor's preview wins
  // while it's open; saving/cancelling hands back to server truth.
  const timelineTheme = graph?.theme ?? null
  // While a story plays in the docked reader, the canvas adopts the story's OWN
  // theme (story.theme ?? the timeline's) — a noir story dims the whole canvas, an
  // epic warms it: the immersive payoff of per-story themes. Closing the reader
  // (reading → false) drops it back in one render. Precedence: the live editor
  // preview wins, then the active story, then the timeline. (Guard via a named
  // const, not `reading && …`, so a falsy short-circuit can't poison the `??` chain.)
  const storyTheme = reading ? (readingStory?.theme ?? null) : null
  const effectiveTheme = previewTheme ?? storyTheme ?? timelineTheme
  const themeVars = useMemo(
    () => resolveThemeVars(effectiveTheme, resolvedTheme),
    [effectiveTheme, resolvedTheme],
  )
  // 'default' = today's untextured canvas (the plain 48px dot grid).
  const texture = effectiveTheme?.texture ?? 'default'
  // Derive the selection from live data, so a deleted node closes the panel.
  const selectedNode = selectedId ? (gnodes.find((n) => n.id === selectedId) ?? null) : null
  const nodeById = useMemo(() => new Map(gnodes.map((n) => [n.id, n])), [gnodes])

  // The story's anchor moment — its node id, taken from the LOADED story (not the
  // canvas selection, which is now decoupled: a story plays by itself and may have
  // no node selected). Drives the lens, the camera, and the reader's title.
  const storyMomentId = reading && readingStory ? readingStory.momentId : null
  const storyMomentTitle =
    (storyMomentId ? nodeById.get(storyMomentId)?.title : null) ?? readingStory?.title ?? ''
  // Story lens + per-beat focus — only while READING. We ring the moment + its whole
  // cast (every beat's focus + related nodes) and dim the rest, reusing the
  // build-stream lens machinery (rf-focused/rf-dimmed + the lens bar). The active
  // beat's focusNodeId additionally drives the camera; the detail panel does NOT
  // follow the beat (decoupled) — it opens only when the user taps an entity.
  const storyFocusIds = useMemo(() => {
    if (!reading || !readingStory) return null
    const ids = new Set<string>([readingStory.momentId])
    for (const b of readingStory.beats) {
      if (b.focusNodeId) ids.add(b.focusNodeId)
      for (const id of b.relatedNodeIds) ids.add(id)
    }
    return [...ids]
  }, [reading, readingStory])
  // activeBeat is -1 on the cover → no beat focus (frame the moment).
  const activeBeatData =
    reading && readingStory && activeBeat >= 0
      ? readingStory.beats[Math.min(activeBeat, readingStory.beats.length - 1)]
      : null
  // The entity this beat spotlights: an explicit focusNodeId, else its first related
  // node — the camera frames it (a beat that names nothing falls back to the moment).
  // Guard self / dangling ids.
  const rawBeatFocus = activeBeatData
    ? (activeBeatData.focusNodeId ?? activeBeatData.relatedNodeIds[0] ?? null)
    : null
  const beatFocusId =
    rawBeatFocus && rawBeatFocus !== storyMomentId && nodeById.has(rawBeatFocus) ? rawBeatFocus : null
  // The detail panel shows ONLY the entity the user explicitly opened (a cast chip /
  // related-node tap or a canvas click) — it never auto-follows the beat.
  const displayNode = selectedNode
  // Camera only moves while reading; frame the beat's focus, else the moment.
  const cameraIds = reading && storyMomentId ? [beatFocusId ?? storyMomentId] : null
  // GS1 (globe story mode): the same node the timeline camera frames — the beat's
  // focus, else the moment — carrying its coords (lat/lng may be null = an off-map
  // beat) and instant, drives the globe when the lens is up. The globe's StoryCamera
  // twin; null when not reading. Passing it while on the timeline view is harmless
  // (GlobeLens isn't mounted).
  const storyFocusNodeId = reading && storyMomentId ? (beatFocusId ?? storyMomentId) : null
  const storyFocus = useMemo(() => {
    if (!storyFocusNodeId) return null
    const n = nodeById.get(storyFocusNodeId)
    if (!n) return null
    return { id: n.id, lat: n.lat, lng: n.lng, instant: n.startInstant }
  }, [storyFocusNodeId, nodeById])
  // Immersive stage: while a story PLAYS, the canvas surface follows the active beat —
  // its explicit `lens`, else derived from whether its focus node is located (globe) or
  // not (timeline). So a place beat sweeps the globe and a time/idea beat drops to the
  // timeline, beat to beat. Null on the cover/end (activeBeat -1) leaves the lens be;
  // closeReader restores the pre-story view. Only fires as the *desired* surface
  // changes, so a manual lens nudge within one beat isn't immediately yanked back.
  const immersiveLens: CanvasView | null = useMemo(() => {
    if (!reading || activeBeat < 0) return null
    if (activeBeatData?.lens) return activeBeatData.lens
    if (!storyFocus) return 'timeline'
    return storyFocus.lat != null && storyFocus.lng != null ? 'globe' : 'timeline'
  }, [reading, activeBeat, activeBeatData, storyFocus])
  useEffect(() => {
    if (immersiveLens) setLensView(immersiveLens)
  }, [immersiveLens, setLensView])
  // A story lens wins over the build-stream lens while reading.
  const effectiveFocusIds = storyFocusIds ?? focusIds
  // A deleted story (its row gone — e.g. the moment was deleted, cascading the story)
  // tears the reader down. readingStoryData === null = "loaded, not found"; undefined
  // = still loading, so don't tear down mid-load.
  useEffect(() => {
    if (reading && selectedStoryId && readingStoryData === null) closeReader()
  }, [reading, selectedStoryId, readingStoryData, closeReader])
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
    const key = `${timelineId}|${vs.pxPerDay}|${vs.collapseGaps}|${vs.nodeOrientation ?? ''}`
    if (serverDefaultKey.current === key) return
    serverDefaultKey.current = key
    if (loadScalePref(timelineId)?.chosen) return
    setPxPerDay(vs.pxPerDay)
    setCollapseGaps(vs.collapseGaps)
    if (vs.nodeOrientation) setNodeOrientation(vs.nodeOrientation)
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
                ? eventPillWidth(n.title, n.size, nodeOrientation)
                : undefined)),
    }))
    const pendingPositioned = pending.map((p) => ({
      p,
      id: `pending:${p.key}`,
      x: scale.toX(p.startInstant),
      width:
        widthOf(p.startInstant, p.endInstant) ??
        (p.type === 'entity'
          ? entityCardWidth()
          : p.type === 'event'
            ? eventPillWidth(p.title, 'medium', nodeOrientation)
            : undefined),
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
            estimateNodeHeight(
              r.n.type,
              r.n.size,
              shown.length > 0,
              r.n.subtype,
              !!r.n.summary,
              hasPortrait,
              nodeOrientation,
              r.n.title,
            ) + titleWrap,
        }
      }),
      ...pendingPositioned.map((pp) => ({
        id: pp.id,
        type: pp.p.type,
        x: pp.x,
        width: m.get(pp.id)?.w ?? pp.width,
        height:
          m.get(pp.id)?.h ??
          estimateNodeHeight(pp.p.type, 'medium', false, null, false, false, nodeOrientation, pp.p.title),
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
        orientation: nodeOrientation,
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
    // stays an exact reflection of its real nodes. The owner can switch them off
    // wholesale (showSuggestions) or wave off individual ones (dismissedGhosts) —
    // a deliberately thin track shouldn't nag forever. The "Add to a track" action
    // stays reachable from ⌘K either way.
    if (isOwner && showSuggestions) {
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
          .filter((z) => !dismissedGhosts.has(`gap:${z.fromInstant}:${z.toInstant}`))
          .slice(0, MAX_GAP_GHOSTS)
        for (const z of zones) {
          const midX = scale.toX((z.fromInstant + z.toInstant) / 2)
          const key = `gap:${z.fromInstant}:${z.toInstant}`
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
              onDismiss: () => onDismissGhost(key),
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
      const sparseLanes = [...laneStats.entries()]
        .filter(([lane, g]) => g.count <= SPARSE_LANE_MAX && !dismissedGhosts.has(`lane:${lane}`))
        .slice(0, MAX_LANE_GHOSTS)
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
            onDismiss: () => onDismissGhost(`lane:${lane}`),
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
        .filter((p) => !dismissedGhosts.has(`era:${p.id}`))
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
            onDismiss: () => onDismissGhost(`era:${p.id}`),
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

    // Node geometry for edge-label placement. The layout already knows every
    // rect (that's what the lane packer works on), so labels are solved here
    // once per layout rather than by each edge subscribing to the RF store.
    const geom = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const { n, x, width } of realPositioned) {
      const meas = m.get(n.id)
      const y = laneYById.get(n.id) ?? laneY(n.type)
      const w = meas?.w ?? width ?? NOMINAL_NODE_WIDTH
      const h = meas?.h ?? estimateNodeHeight(n.type, n.size, false, n.subtype, false, false, nodeOrientation, n.title)
      geom.set(n.id, { x, y, w, h })
    }
    const labelRects: LabelRect[] = [...geom.values()].map((g) => ({
      left: g.x,
      top: g.y,
      right: g.x + g.w,
      bottom: g.y + g.h,
    }))
    // Each label placed becomes an obstacle for the next, so two connectors
    // crossing the same corridor don't stack on top of each other. Edge order is
    // stable, so the result is deterministic.
    const placedLabels: LabelRect[] = []

    const rfEdges: Edge[] = gedges.map((e) => {
      const s = EDGE_STYLE[e.kind]
      const bothFocused = !!focusSet && focusSet.has(e.sourceId) && focusSet.has(e.targetId)
      // Dim edges that don't connect two focused nodes while a lens is active.
      const dim = focusSet && !bothFocused
      const isPeriodEdge = periodIds.has(e.sourceId) || periodIds.has(e.targetId)
      const touchesSelection = selectedId != null && (e.sourceId === selectedId || e.targetId === selectedId)
      const touchesHidden = !!hiddenNodeIds && (hiddenNodeIds.has(e.sourceId) || hiddenNodeIds.has(e.targetId))
      const hidden = touchesHidden || (isPeriodEdge && !touchesSelection && !bothFocused)
      // Humanize the relation kind: snake_case → spaced words ("competed_with"
      // → "competed with"). Explicit labels are already human, shown as-is.
      const label = e.label ?? e.kind.replace(/_/g, ' ')

      // Solve the label's slot against the node rects. The handles are the source's
      // right edge and the target's left edge, so the curve's waist sits between
      // them — search around that point, not the nodes' centres.
      const sg = geom.get(e.sourceId)
      const tg = geom.get(e.targetId)
      let pos: { x: number; y: number } | null = null
      if (sg && tg && !hidden) {
        pos = placeEdgeLabel((sg.x + sg.w + tg.x) / 2, (sg.y + sg.h / 2 + tg.y + tg.h / 2) / 2, label, [
          ...labelRects,
          ...placedLabels,
        ])
        const lw = estimateLabelWidth(label)
        placedLabels.push({
          left: pos.x - lw / 2,
          top: pos.y - LABEL_HEIGHT / 2,
          right: pos.x + lw / 2,
          bottom: pos.y + LABEL_HEIGHT / 2,
        })
      }

      return {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        // LabeledEdge draws the label off the curve; React Flow's built-in label
        // would pin it to the bezier midpoint, straight through the next lane.
        type: 'labeled',
        data: {
          label,
          color: s.color,
          opacity: dim ? 0.12 : 1,
          labelX: pos?.x,
          labelY: pos?.y,
        },
        hidden,
        style: { stroke: s.color, strokeWidth: s.width, strokeDasharray: s.dash, opacity: dim ? 0.12 : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
      }
    })

    return { rfNodes, rfEdges, scale }
    // measuredVersion stands in for measuredRef.current's contents (a ref, so
    // not a valid dep itself) — it bumps exactly when a node's DOM size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gnodes, gedges, pending, draft, selectedId, effectiveFocusIds, pxPerDay, collapseGaps, hiddenKinds, measuredVersion, timelineId, title, isOwner, nodeOrientation, showSuggestions, dismissedGhosts, onDismissGhost])

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

  // A private timeline you can't see, or a missing one — show a state, not the
  // canvas. It still renders through CanvasLayout, so the app bar (logo/home +
  // account menu) is present: the user keeps their navigation instead of landing
  // on a stranded error page.
  if (data && data.status !== 'ok') {
    return (
      <CanvasLayout>
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
      </CanvasLayout>
    )
  }

  return (
    <ReactFlowProvider>
      <CanvasLayout
        texture={texture}
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
        brand={<AppBar timelineId={timelineId} title={title} isOwner={isOwner} isPublic={isPublic} />}
        // Top-center lens toggle — always shown; clicking Globe with no located
        // nodes opens the setup prompt instead of switching (switchToGlobe).
        center={
          <ViewSwitcher
            view={lensView}
            onChange={setLensView}
            onSwitchToGlobe={switchToGlobe}
            coverage={globeCov}
          />
        }
        controls={
          <>
            {gnodes.length > 0 && (
              <CommandPalette
                nodes={gnodes}
                onSelect={flyTo}
                timelineId={timelineId}
                timelineTitle={title}
                selectedNode={selectedNode}
                onSwitchToGlobe={() => setLensView('globe')}
                globeSetupSpec={null}
                globeZoom={
                  lensView === 'globe'
                    ? {
                        in: () => globeControlsRef.current?.zoomIn(),
                        out: () => globeControlsRef.current?.zoomOut(),
                        reset: () => globeControlsRef.current?.zoomReset(),
                      }
                    : null
                }
                canAdd={isOwner}
                onAdd={setAddMode}
              />
            )}
            {/* Undo/redo buttons removed from the toolbar; ⌘Z / ⌘⇧Z still drive the
                patch history via this headless owner-only binding. */}
            {isOwner && <HistoryShortcuts timelineId={timelineId} />}
            {/* Stories live in their own toolbar panel again (not a full-pane lens):
                a popover that lists the timeline's stories + a "New Story" action. */}
            {(gnodes.length > 0 || pending.length > 0) && (
              <StoriesMenu
                timelineId={timelineId}
                storyVersion={storyVersion ?? ''}
                canCreate={isOwner}
                nodes={gnodes.map((n) => ({ id: n.id, title: n.title, type: n.type }))}
                openStoryId={selectedStoryId}
                onOpenStory={openStory}
              />
            )}
            {/* Unified "Add" entry point — create new · place existing · new story.
                Owner-only; the flows' dialogs are the shared <AddDialogs/> below. */}
            {isOwner && <AddMenu onPick={setAddMode} />}
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
                autoPlay={autoPlayStories}
                onAutoPlay={setAutoPlayStories}
                kindCounts={kindCounts}
                hiddenKinds={hiddenKinds}
                onToggleKind={toggleKind}
                onResetKinds={resetKinds}
                nodeOrientation={nodeOrientation}
                onNodeOrientation={chooseNodeOrientation}
                showSuggestions={showSuggestions}
                onShowSuggestions={setShowSuggestions}
                dismissedCount={dismissedGhosts.size}
                onResetGhosts={onResetGhosts}
                theme={timelineTheme}
                onPreviewTheme={setPreviewTheme}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                hideTrigger
              />
            )}
            {/* Secondary chrome — display settings + share/export — folds behind the
                ⋯ More menu so the bar stays a tight, always-reachable set (and never
                clips on mobile). Both dialogs render here, controlled + trigger-less;
                More just opens them. The account menu is appended by CanvasLayout, so
                it stays rightmost. */}
            <MoreMenu
              canSettings={gnodes.length > 0 || pending.length > 0}
              canShare={isOwner || gnodes.length > 0}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenShare={() => setShareOpen(true)}
            />
            <ShareDialog
              timelineId={timelineId}
              graph={{ title, nodes: gnodes, edges: gedges }}
              isOwner={isOwner}
              isPublic={isPublic}
              open={shareOpen}
              onOpenChange={setShareOpen}
              hideTrigger
            />
            {/* The shared Add dialogs (create · place · story), driven by the Add
                button and ⌘K alike. Owner-only. */}
            {isOwner && (
              <AddDialogs
                mode={addMode}
                onMode={setAddMode}
                timelineId={timelineId}
                nodes={gnodes.map((n) => ({ id: n.id, title: n.title, type: n.type }))}
                onCreated={flyTo}
              />
            )}
          </>
        }
      >
        {/* The lens-bar is build-stream chrome only; while a story plays the
            docked reader carries its own transport, so no bar up top. */}
        {lensView === 'timeline' && lensSize > 0 && !reading && (
          <div className="lens-bar">
            <span>{`Lens · ${lensSize} node${lensSize === 1 ? '' : 's'}`}</span>
            <button type="button" onClick={() => setFocusIds([])} title="Clear lens">
              Clear ✕
            </button>
          </div>
        )}
        {lensView === 'timeline' ? (
        <ReactFlow
          // Remount only when switching timelines; within one, nodes keep their
          // identity (diffed by id) so position changes glide instead of snapping.
          key={timelineId}
          nodes={displayNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
          <TimelineZoomControls />
          <ViewportInit timelineId={timelineId} nodeCount={gnodes.length} />
          {cameraIds && (
            <StoryCamera ids={cameraIds} dockW={(displayNode ? panelW.detail : 0) + panelW.story} />
          )}
          <FlyToCamera targetId={flyToId} onArrive={clearFlyTo} />
          {gnodes.length > 0 && (
            <TimelineScrubber
              nodes={gnodes}
              scale={scale}
              timelineId={timelineId}
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
        ) : (
          <Suspense fallback={<div className="canvas-loading">Loading globe…</div>}>
            <GlobeLens
              nodes={gnodes}
              pxPerDay={pxPerDay}
              collapseGaps={collapseGaps}
              selectedId={selectedId}
              // Clear BOTH right docks: the detail portrait and, in story mode, the
              // story reader (mirrors the canvas StoryCamera's dockW).
              rightInset={(displayNode ? panelW.detail : 0) + (reading ? panelW.story : 0)}
              timelineId={timelineId}
              storyMode={reading}
              storyFocus={storyFocus}
              controlsRef={globeControlsRef}
              onMarkerClick={setSelectedId}
              onBackfill={() =>
                setGapSpec(
                  globeBackfillSpec(
                    { timelineId, timelineTitle: title, surface: 'globe_banner' },
                    globeCov.uncoordinated,
                  ),
                )
              }
            />
          </Suspense>
        )}
        {displayNode ? (
          <NodeDetailPanel
            // Re-key on the node so it remounts (fresh state) when the user opens a
            // different entity (a cast chip / related-node tap / canvas click).
            key={displayNode.id}
            node={displayNode}
            edges={gedges}
            nodes={gnodes}
            timelineId={timelineId}
            // The panel is the entity the user explicitly opened — full detail, even
            // mid-story (a deliberate side-trip, not the beat's auto-portrait).
            readOnly={!isOwner}
            stories={stories}
            // Closing the entity keeps any open story playing (decoupled).
            onClose={() => setSelectedId(null)}
            onSelectNode={selectNode}
            onDraft={handleDraft}
            onPlayStory={openStory}
            onAddToGlobe={() =>
              setGapSpec(
                globeBackfillSpec({ timelineId, timelineTitle: title, surface: 'node_panel' }, globeCov.uncoordinated),
              )
            }
            width={panelW.detail}
            onResize={resizeDetail}
            onCommitResize={commitPanelW}
          />
        ) : null}
        {reading && readingStory ? (
          <StoryReader
            // Re-key on the story so switching stories resets the reader (cover, beat 0).
            key={readingStory.id}
            story={readingStory}
            // Moment label/id come from the story itself — the reader is decoupled
            // from canvas selection (no node need be selected to play a story).
            momentTitle={storyMomentTitle}
            momentId={readingStory.momentId}
            timelineId={timelineId}
            nodeById={nodeById}
            // No entity panel open → dock flush at the right edge (data-solo).
            solo={!displayNode}
            paused={storyPaused}
            onPausedChange={setStoryPaused}
            speak={speakStories}
            onSpeakChange={setSpeakStories}
            autoPlay={autoPlayStories}
            onAutoPlayChange={setAutoPlayStories}
            onClose={closeReader}
            // A story plays on whichever lens is up: opened on the timeline it stays
            // there; opened on the globe the globe is its stage (GS1 story mode).
            onSelectNode={selectNode}
            onBeatChange={setActiveBeat}
            canShare={isOwner}
            // Run straight away (skip the cover) for panel/card opens + home Play;
            // a bare ?story deep-link (Continue writing) lands on the cover.
            autoStart={readerAutoStart}
            width={panelW.story}
            onResize={resizeStory}
            onCommitResize={commitPanelW}
          />
        ) : null}
        {/* Fill-this-gap prompt, opened by a dashed gap-invitation ghost (Tier 2). */}
        <PromptDialog open={!!gapSpec} onOpenChange={(o) => { if (!o) setGapSpec(null) }} spec={gapSpec} />
      </CanvasLayout>
    </ReactFlowProvider>
  )
}
