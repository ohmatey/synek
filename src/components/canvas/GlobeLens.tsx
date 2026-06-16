import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { geoOrthographic, geoPath, geoGraticule10, geoDistance, type GeoProjection } from 'd3-geo'
import { feature } from 'topojson-client'
import type { FeatureCollection } from 'geojson'
import type { GeometryCollection } from 'topojson-specification'
import world from 'world-atlas/countries-110m.json'
import {
  BookOpen,
  Box,
  Building2,
  Globe,
  Layers,
  Lightbulb,
  MapPin,
  Maximize,
  Minus,
  Pause,
  Play,
  Plus,
  User,
  Zap,
} from 'lucide-react'
import { GEO_SCOPE_LABELS, type GraphNode, type Precision } from '~/lib/domain/types'
import { formatInstant, formatInstantRange } from '~/lib/domain/dates'
import { makeTimeScale } from './useTimelineScale'
import { isLocated, isPlaceless, globeCoverage } from './globe-coverage'
import { capture } from '~/lib/posthog/client'

// GLOBE LENS (docs/product/prd/globe-lens.md). A read-only orthographic globe that
// plots the timeline's located nodes and plays through time so you watch history
// move across the map. SVG (not canvas) — node counts are in the 100s, so SVG buys
// native hit-testing for marker → NodeDetailPanel and CSS-var theming for free.
// Client-only + lazy-loaded by TimelineCanvas (keeps d3-geo + the world TopoJSON out
// of the main bundle and SSR). Playback advances in x-space through makeTimeScale, so
// gap-collapse compresses dead eras exactly like the timeline canvas (PRD §4).

const MS_PER_YEAR = 365.25 * 86_400_000
const DESIRED_PLAY_SECONDS = 24 // a full playthrough at 1× (scaled by speed)
const ROTATION_EASE = 0.12
const DRAG_SENSITIVITY = 0.28 // degrees of rotation per pixel dragged
const SPEEDS = [1, 2, 4] as const
// GS1 (globe story mode): how far a story beat zooms into its focus place. The
// projection scale is multiplied by `zoom`; a beat eases zoom to this, story end
// eases back to 1× (whole-sphere fit).
const STORY_ZOOM = 1.8
// GS2 (interactive zoom). `zoom` multiplies the projection scale — 1 = whole sphere
// fits the pane; the upper bound keeps an orthographic globe legible up close.
const ZOOM_MIN = 1
const ZOOM_MAX = 6
const ZOOM_STEP_IN = 1.4 // +/− control + ⌘K step factor (out = its reciprocal)
const ZOOM_STEP_OUT = 1 / ZOOM_STEP_IN
const WHEEL_K = 0.0015 // wheel zoom sensitivity (deltaY → scale)
const PINCH_K = 0.01 // trackpad pinch (wheel + ctrlKey) is coarser per tick

// GS2: the imperative zoom handle GlobeLens registers into a caller-supplied ref,
// so ⌘K "Globe: zoom in/out/reset" (hosted in TimelineCanvas) can drive the lens.
export type GlobeControls = {
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

// The world geometry + graticule are static — compute once at module load (lands
// in this lazy chunk, never the main bundle).
const land = feature(
  world,
  world.objects.countries as unknown as GeometryCollection,
) as unknown as FeatureCollection
const graticule = geoGraticule10()

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// Shortest-path interpolation for a longitude (handles the −180/180 seam).
function easeLng(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180
  return a + d * t
}
const markerRadius = (size: GraphNode['size']) => (size === 'large' ? 6 : size === 'small' ? 3.5 : 4.5)
const sizeRank = (size: GraphNode['size']) => (size === 'large' ? 2 : size === 'small' ? 0 : 1)

// GS3 floating-card de-overlap: a candidate card shows only if every already-shown
// card is far enough away on X OR sits on a different vertical band (a cheap AABB-ish
// test). Markers reproject as you zoom, so a fixed gap reveals more cards the further
// you zoom in — the zoom-gated declutter the PRD asks for.
const LABEL_GAP_X = 84
const LABEL_GAP_Y = 22

// GS4 dated axis + era band. The scrubber doubles as a time ruler: year ticks at a
// "nice" step (mirrors TimeRuler's algorithm, positioned in the scrubber's percentage
// space) and a ribbon of `period` spans above it.
const AXIS_MIN_PCT_GAP = 7 // min % between kept year labels (de-bunch a collapsed scale)
const ERA_ROW_H = 15 // px per era-band row
function instantOfYear(year: number): number {
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCFullYear(year)
  return d.getTime()
}
function yearLabel(year: number): string {
  return year <= 0 ? `${-year + 1} BCE` : `${year}`
}
// The marker's type glyph — mirrors the canvas/⌘K node icon language so a globe card
// reads the same as the node it stands for.
function markerIcon(n: GraphNode) {
  if (n.type === 'period') return Layers
  if (n.type === 'concept') return Lightbulb
  if (n.type === 'event') return Zap
  switch (n.subtype) {
    case 'person':
      return User
    case 'org':
      return Building2
    case 'place':
      return MapPin
    case 'work':
      return BookOpen
    default:
      return Box
  }
}

export type GlobeLensProps = {
  nodes: GraphNode[]
  pxPerDay: number
  collapseGaps: boolean
  selectedId: string | null
  rightInset: number // px the open detail dock occupies on the right; keeps the globe clear of it
  timelineId: string
  onMarkerClick: (id: string) => void
  onBackfill: () => void
  // GS1: while a story plays over the globe, `storyMode` is true (the reader is the
  // transport — suppresses the globe's own autoplay) and `storyFocus` is the node the
  // active beat is about. Its lat/lng (may be null = off-map beat) ease the globe's
  // rotation + zoom; its instant skips the cursor. null on the cover/end or when no
  // story is playing. Both optional → non-story callers are unaffected.
  storyMode?: boolean
  storyFocus?: { id: string; lat: number | null; lng: number | null; instant: number } | null
  // GS2: optional handle the lens populates with zoom methods while mounted, so an
  // outside surface (⌘K) can zoom it. Left untouched for callers that don't pass one.
  controlsRef?: MutableRefObject<GlobeControls | null>
}

export default function GlobeLens({
  nodes,
  pxPerDay,
  collapseGaps,
  selectedId,
  rightInset,
  timelineId,
  onMarkerClick,
  onBackfill,
  storyMode = false,
  storyFocus = null,
  controlsRef,
}: GlobeLensProps) {
  const located = useMemo(() => nodes.filter(isLocated), [nodes])
  const isEmpty = located.length === 0
  const coverage = useMemo(() => globeCoverage(nodes), [nodes])
  // The placeless narrative channel: nodes a geoScope says CANNOT be pinned
  // never get a marker, so they narrate as a caption while "active" instead of
  // silently vanishing from the story (see placelessCaption below).
  const placelessNodes = useMemo(
    () => nodes.filter(isPlaceless).sort((a, b) => a.startInstant - b.startInstant),
    [nodes],
  )

  // --- time extent + the non-linear (gap-collapsed) play scale ----------------
  const { instants, minInstant, maxInstant } = useMemo(() => {
    const xs = located.flatMap((n) => [n.startInstant, ...(n.endInstant != null ? [n.endInstant] : [])])
    return {
      instants: xs,
      minInstant: xs.length ? Math.min(...xs) : 0,
      maxInstant: xs.length ? Math.max(...xs) : 0,
    }
  }, [located])
  const scale = useMemo(() => makeTimeScale(instants, pxPerDay, collapseGaps), [instants, pxPerDay, collapseGaps])
  const maxX = useMemo(() => Math.max(scale.toX(maxInstant), 1), [scale, maxInstant])
  const pxPerSec = maxX / DESIRED_PLAY_SECONDS
  const spanYears = (maxInstant - minInstant) / MS_PER_YEAR
  const cursorPrecision: Precision = spanYears > 6 ? 'year' : spanYears > 0.5 ? 'month' : 'day'

  // located, sorted by start, for "which node is active at instant t" — via a ref so
  // the rAF loop reads the latest without re-subscribing every frame.
  const sortedLocated = useMemo(() => [...located].sort((a, b) => a.startInstant - b.startInstant), [located])
  const sortedRef = useRef(sortedLocated)
  sortedRef.current = sortedLocated
  const activeNodeAt = (t: number): GraphNode | null => {
    const s = sortedRef.current
    let found: GraphNode | null = null
    for (const n of s) {
      if (n.startInstant <= t) found = n
      else break
    }
    return found
  }

  // --- view state (survives a `nodes` prop change — G6 hot-update) -----------
  const [size, setSize] = useState({ w: 960, h: 640 })
  const [rotation, setRotation] = useState<[number, number]>(() => {
    if (!located.length) return [0, 20]
    const lng = located.reduce((s, n) => s + (n.lng as number), 0) / located.length
    const lat = located.reduce((s, n) => s + (n.lat as number), 0) / located.length
    return [lng, lat]
  })
  const [cursorInstant, setCursorInstant] = useState(() => minInstant)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  // GS2: a scale multiplier the projection reads (1 = whole sphere fits the pane).
  // Driven three ways — wheel/pinch + the +/− control + ⌘K (this file) — plus GS1's
  // per-beat "zoom to the place", all funnelled through the shared camera ease below
  // so programmatic moves glide and raw wheel snaps.
  const [zoom, setZoom] = useState(1)
  // Mirrors `zoom` for handlers that must read the live value without re-subscribing
  // (the native wheel listener's closure; the ⌘K control methods). Synced each render,
  // and written synchronously by the wheel handler so back-to-back wheels compound.
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  const xRef = useRef(0)
  const userRotatedRef = useRef(false)
  const scrubGestureRef = useRef(false)
  const playedRef = useRef(false)
  const openedAtRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // The shared camera ease: any source points it at a {rot, zoom} target and bumps
  // the nonce to (re)start the rAF; a null rot holds the current heading.
  const cameraTargetRef = useRef<{ rot: [number, number] | null; zoom: number }>({ rot: null, zoom: 1 })
  const easeRafRef = useRef(0)
  const [easeNonce, setEaseNonce] = useState(0)
  // Debounce wheel-zoom analytics to one event per gesture.
  const wheelAnalyticsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // GS3: the marker the pointer is hovering — shows its card even when the declutter
  // would otherwise hide it. (Keyboard focus would set this too; markers aren't
  // focusable yet — a later a11y pass.)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Cinematic empty state: the globe rests risen from the bottom edge (a planet over a
  // horizon) and slowly turns; when the first coordinate lands it glides up to center.
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  // Flipped true after the first paint so the entrance transition (below → resting
  // arc) plays; the resting→center rise then runs when `isEmpty` turns false.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Slow auto-rotation while empty (idle hero). Stops once a node lands (the centered
  // globe is static unless playing) or the user grabs it (userRotatedRef).
  useEffect(() => {
    if (!isEmpty || reducedMotion) return
    let raf = 0
    let last = 0
    const SPIN_DEG_PER_SEC = 7
    const step = (ts: number) => {
      if (last && !userRotatedRef.current) {
        const dt = (ts - last) / 1000
        setRotation((r) => [r[0] + SPIN_DEG_PER_SEC * dt, r[1]])
      }
      last = ts
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [isEmpty, reducedMotion])

  // Keep the cursor inside the extent under a live patch. Snapping UP to minInstant
  // matters when the globe goes empty→populated: the cursor (0 while empty) must jump
  // to the new earliest instant so the just-added node counts as "appeared" and shows
  // the moment the globe rises to center.
  useEffect(() => {
    if (cursorInstant > maxInstant) setCursorInstant(maxInstant)
    else if (cursorInstant < minInstant) setCursorInstant(minInstant)
    if (xRef.current > maxX) xRef.current = maxX
  }, [minInstant, maxInstant, maxX, cursorInstant])

  // --- analytics: opened / closed (one pair per lens session) ----------------
  // Latest open-time stats via a ref so the effect can stay mount-once.
  const openInfoRef = useRef({ count: nodes.length, located: coverage.located, pct: coverage.coveragePct })
  openInfoRef.current = { count: nodes.length, located: coverage.located, pct: coverage.coveragePct }
  useEffect(() => {
    openedAtRef.current = performance.now()
    const info = openInfoRef.current
    capture('globe_lens_opened', {
      timeline_id: timelineId,
      node_count: info.count,
      coordinated_count: info.located,
      coverage_pct: info.pct,
    })
    return () => {
      capture('globe_lens_closed', {
        timeline_id: timelineId,
        session_duration_ms: Math.round(performance.now() - openedAtRef.current),
        played: playedRef.current,
      })
    }
  }, [timelineId])

  // --- size tracking ----------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- the playback clock (rAF; advances x, eases rotation to the active node) -
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = 0
    const step = (ts: number) => {
      if (last) {
        const dt = (ts - last) / 1000
        xRef.current = Math.min(xRef.current + pxPerSec * speed * dt, maxX)
        const inst = scale.toInstant(xRef.current)
        setCursorInstant(inst)
        if (!userRotatedRef.current) {
          const active = activeNodeAt(inst)
          if (active) {
            setRotation((r) => [
              easeLng(r[0], active.lng as number, ROTATION_EASE),
              lerp(r[1], active.lat as number, ROTATION_EASE),
            ])
          }
        }
        if (xRef.current >= maxX) {
          setPlaying(false)
          return
        }
      }
      last = ts
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, pxPerSec, maxX, scale])

  // --- GS1: story mode hands the transport to the reader -----------------------
  // While a story plays over the globe the reader's Play is the only transport, so
  // suppress the globe's own playback clock — the two must not run at once.
  useEffect(() => {
    if (storyMode) setPlaying(false)
  }, [storyMode])

  // Skip the cursor to the beat's instant (the scrubber thumb jumps beat-to-beat
  // instead of sweeping) and re-arm camera-follow so each new beat re-grabs the
  // globe even if the user dragged it during the previous beat.
  useEffect(() => {
    if (!storyMode || !storyFocus) return
    setCursorInstant(storyFocus.instant)
    xRef.current = scale.toX(storyFocus.instant)
    userRotatedRef.current = false
  }, [storyMode, storyFocus?.id, storyFocus?.instant, scale])

  // --- the shared camera ease (GS2) -------------------------------------------
  // Every PROGRAMMATIC camera move (a story beat, a +/− zoom, a ⌘K zoom) funnels
  // through one rAF: it eases rotation toward the target heading (unless the user
  // grabbed the globe) and zoom toward the target scale, then stops. Raw wheel/drag
  // bypass it — they mutate immediately and cancel a running ease.
  function cancelEase() {
    if (easeRafRef.current) cancelAnimationFrame(easeRafRef.current)
    easeRafRef.current = 0
  }
  // Point the camera at a target and (re)start the eased follow. rot=null holds the
  // current heading (a zoom-only gesture, or an off-map story beat).
  function easeCameraTo(rot: [number, number] | null, nextZoom: number) {
    cameraTargetRef.current = { rot, zoom: clamp(nextZoom, ZOOM_MIN, ZOOM_MAX) }
    setEaseNonce((n) => n + 1)
  }
  // A deliberate zoom (the +/− control or ⌘K) eases toward the new scale and — like a
  // drag — flags "user took over" so an in-flight story-follow won't yank the camera
  // back until the next beat re-arms it (the cursor-skip effect clears the flag).
  function commitZoom(target: number) {
    userRotatedRef.current = true
    easeCameraTo(null, target)
    capture('globe_zoomed', { timeline_id: timelineId, via: 'button' })
  }

  useEffect(() => {
    if (easeNonce === 0) return // no camera move requested yet
    const { rot: rotTarget, zoom: zoomTarget } = cameraTargetRef.current
    if (reducedMotion) {
      if (rotTarget && !userRotatedRef.current) setRotation([rotTarget[0], rotTarget[1]])
      zoomRef.current = zoomTarget
      setZoom(zoomTarget)
      return
    }
    let curLng = rotation[0]
    let curLat = rotation[1]
    let curZoom = zoomRef.current
    const step = () => {
      let pending = false
      if (rotTarget && !userRotatedRef.current) {
        curLng = easeLng(curLng, rotTarget[0], ROTATION_EASE)
        curLat = lerp(curLat, rotTarget[1], ROTATION_EASE)
        setRotation([curLng, curLat])
        const dLng = Math.abs(((rotTarget[0] - curLng + 540) % 360) - 180)
        if (Math.abs(curLat - rotTarget[1]) > 0.05 || dLng > 0.05) pending = true
      }
      if (Math.abs(curZoom - zoomTarget) > 0.002) {
        curZoom = lerp(curZoom, zoomTarget, ROTATION_EASE)
        zoomRef.current = curZoom
        setZoom(curZoom)
        pending = true
      } else if (curZoom !== zoomTarget) {
        zoomRef.current = zoomTarget
        setZoom(zoomTarget)
      }
      easeRafRef.current = pending ? requestAnimationFrame(step) : 0
    }
    easeRafRef.current = requestAnimationFrame(step)
    return () => {
      if (easeRafRef.current) cancelAnimationFrame(easeRafRef.current)
      easeRafRef.current = 0
    }
    // Seeds from rotation/zoom once per move; listing them as deps would restart
    // the ease every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [easeNonce, reducedMotion])

  // GS1: each story beat points the shared ease at the beat's focus coords (+ a story
  // zoom), or holds the heading on an off-map beat; also fires when a story closes
  // (storyMode false) to ease zoom back to the whole-sphere fit.
  useEffect(() => {
    const rotTarget =
      storyMode && storyFocus && storyFocus.lat != null && storyFocus.lng != null
        ? ([storyFocus.lng, storyFocus.lat] as [number, number])
        : null
    easeCameraTo(rotTarget, rotTarget ? STORY_ZOOM : 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyMode, storyFocus?.id, storyFocus?.lat, storyFocus?.lng])

  // GS2: the native wheel/pinch listener. Attached imperatively with passive:false
  // because React's onWheel is passive (preventDefault there no-ops) — we must stop
  // the page from scrolling while the wheel drives zoom. Trackpad pinch arrives as
  // wheel + ctrlKey (coarser). Wheel applies immediately (no ease) and cancels any
  // running camera ease, like a drag.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelEase()
      userRotatedRef.current = true
      const k = e.ctrlKey ? PINCH_K : WHEEL_K
      const next = clamp(zoomRef.current * Math.exp(-e.deltaY * k), ZOOM_MIN, ZOOM_MAX)
      zoomRef.current = next
      setZoom(next)
      cameraTargetRef.current = { rot: null, zoom: next }
      if (wheelAnalyticsTimer.current) clearTimeout(wheelAnalyticsTimer.current)
      wheelAnalyticsTimer.current = setTimeout(
        () => capture('globe_zoomed', { timeline_id: timelineId, via: 'wheel' }),
        400,
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (wheelAnalyticsTimer.current) clearTimeout(wheelAnalyticsTimer.current)
    }
    // Reads live values via refs; the first-render closure is correct for the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // GS2: expose imperative zoom to ⌘K (TimelineCanvas hands the handle to the
  // command palette). Registered only while the globe is mounted; cleared on unmount.
  useEffect(() => {
    if (!controlsRef) return
    controlsRef.current = {
      zoomIn: () => commitZoom(zoomRef.current * ZOOM_STEP_IN),
      zoomOut: () => commitZoom(zoomRef.current * ZOOM_STEP_OUT),
      zoomReset: () => commitZoom(1),
    }
    return () => {
      controlsRef.current = null
    }
    // commitZoom closes over stable refs/setters + the per-mount timelineId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsRef])

  function togglePlay() {
    // capture lives OUTSIDE setPlaying so it never double-fires under a StrictMode
    // double-invoked updater; togglePlay runs from a click, so `playing` is current.
    const next = !playing
    if (next) {
      xRef.current = xRef.current >= maxX - 0.5 ? 0 : scale.toX(cursorInstant)
      userRotatedRef.current = false
      playedRef.current = true
      capture('globe_playback_started', { timeline_id: timelineId, speed })
    }
    setPlaying(next)
  }

  // --- scrubbing (click/drag the track) ---------------------------------------
  function seekFromClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1)
    xRef.current = frac * maxX
    setCursorInstant(scale.toInstant(xRef.current))
  }
  function onTrackPointerDown(e: React.PointerEvent) {
    setPlaying(false)
    scrubGestureRef.current = false
    seekFromClientX(e.clientX)
    const move = (ev: PointerEvent) => {
      if (!scrubGestureRef.current) {
        scrubGestureRef.current = true
        capture('globe_scrubbed', { timeline_id: timelineId })
      }
      seekFromClientX(ev.clientX)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // --- manual globe rotation (drag the sphere) --------------------------------
  function onGlobePointerDown(e: React.PointerEvent) {
    const start = { x: e.clientX, y: e.clientY, rot: rotation }
    userRotatedRef.current = true
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      // Direct manipulation: the surface follows the cursor (grab-and-pull), so drag
      // right spins the globe right and drag down tips it down — inverse of orbiting
      // the camera.
      setRotation([start.rot[0] - dx * DRAG_SENSITIVITY, clamp(start.rot[1] + dy * DRAG_SENSITIVITY, -90, 90)])
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // --- projection + static geometry paths -------------------------------------
  const viewW = Math.max(size.w - rightInset, 120)
  const projection = useMemo<GeoProjection>(() => {
    return geoOrthographic()
      .clipAngle(90)
      .rotate([-rotation[0], -rotation[1]])
      .translate([viewW / 2, size.h / 2])
      .scale((Math.min(viewW, size.h) / 2) * 0.92 * zoom)
  }, [rotation, viewW, size.h, zoom])

  const { spherePath, gratPath, landPaths } = useMemo(() => {
    const p = geoPath(projection)
    return {
      spherePath: p({ type: 'Sphere' }) ?? '',
      gratPath: p(graticule) ?? '',
      landPaths: land.features.map((f) => p(f) ?? ''),
    }
  }, [projection])

  // --- markers (appeared / active-span / past-span) ---------------------------
  // In story mode the highlighted (haloed + labelled) marker is the beat's focus
  // node; otherwise it's the user-selected node.
  const highlightId = storyMode && storyFocus ? storyFocus.id : selectedId
  const markers = useMemo(() => {
    // The projection's visible center: d3 rotate([λ,φ]) puts geographic point
    // [-λ,-φ] at the disc center, so center = -rotate(). The scalar projection()
    // does NOT clip the back hemisphere (only geoPath's stream pipeline does), so
    // we cull far-side markers by great-circle distance ourselves (PRD §5).
    const rot = projection.rotate()
    const center: [number, number] = [-rot[0], -rot[1]]
    const out: { n: GraphNode; x: number; y: number; active: boolean; past: boolean; selected: boolean }[] = []
    for (const n of located) {
      if (cursorInstant < n.startInstant) continue // not yet — appears when the cursor crosses it
      if (geoDistance([n.lng as number, n.lat as number], center) > Math.PI / 2) continue // back hemisphere
      const xy = projection([n.lng as number, n.lat as number])
      if (!xy) continue
      const isSpan = n.endInstant != null
      out.push({
        n,
        x: xy[0],
        y: xy[1],
        active: isSpan && cursorInstant <= (n.endInstant as number),
        past: isSpan && cursorInstant > (n.endInstant as number),
        selected: n.id === highlightId,
      })
    }
    // draw order: ordinary → active → selected on top
    out.sort((a, b) => Number(a.selected) - Number(b.selected) || Number(a.active) - Number(b.active))
    return out
  }, [located, cursorInstant, projection, highlightId])

  function handleMarker(n: GraphNode) {
    capture('globe_marker_clicked', { timeline_id: timelineId, node_id: n.id, node_type: n.type })
    onMarkerClick(n.id)
  }

  // The active placeless caption: spans speak while the cursor is inside them,
  // point nodes for a short x-window after they appear (then yield). Latest
  // start wins when several overlap. The caption pairs the node's title with
  // its `location` string (if the author gave one) or the scope's standard
  // explanation — the globe explains WHY there is no pin instead of hiding it.
  const placelessCaption = useMemo(() => {
    if (isEmpty || !placelessNodes.length) return null
    const curX = scale.toX(cursorInstant)
    const pointWindowPx = maxX * 0.06
    let current: GraphNode | null = null
    for (const n of placelessNodes) {
      if (n.startInstant > cursorInstant) break
      const active =
        n.endInstant != null
          ? cursorInstant <= n.endInstant
          : curX - scale.toX(n.startInstant) <= pointWindowPx
      if (active) current = n
    }
    return current
  }, [isEmpty, placelessNodes, cursorInstant, scale, maxX])

  // GS3: which markers show a floating type+title card. Always: the highlighted
  // (selected / story-focus) marker, active spans, and the hovered marker — few and
  // meaningful. Then the rest are revealed greedily (largest/earliest first), skipping
  // any that would overlap a shown card. Because `markers` reprojects on zoom, zooming
  // in spreads them apart and reveals more cards for free.
  const labels = useMemo(() => {
    const shown: { n: GraphNode; x: number; y: number; primary: boolean }[] = []
    const fits = (x: number, y: number) =>
      shown.every((s) => Math.abs(s.x - x) >= LABEL_GAP_X || Math.abs(s.y - y) >= LABEL_GAP_Y)
    const always = markers.filter((m) => m.selected || m.active || m.n.id === hoveredId)
    for (const m of always) shown.push({ n: m.n, x: m.x, y: m.y, primary: m.selected })
    const rest = markers
      .filter((m) => !(m.selected || m.active || m.n.id === hoveredId))
      .sort((a, b) => sizeRank(b.n.size) - sizeRank(a.n.size) || a.n.startInstant - b.n.startInstant)
    for (const m of rest) if (fits(m.x, m.y)) shown.push({ n: m.n, x: m.x, y: m.y, primary: false })
    return shown
  }, [markers, hoveredId])

  // GS4: year ticks for the scrubber's date axis — a "nice" step over the located
  // extent, positioned in the scrubber's percentage space (so gap-collapse is honored
  // exactly like the thumb). Mirrors TimeRuler's tick algorithm.
  const axisTicks = useMemo(() => {
    if (isEmpty) return [] as { year: number; pct: number }[]
    const minY = new Date(minInstant).getUTCFullYear()
    const maxY = new Date(maxInstant).getUTCFullYear()
    const span = Math.max(1, maxY - minY)
    const step = span > 200 ? 50 : span > 80 ? 20 : span > 30 ? 10 : span > 12 ? 5 : 1
    const out: { year: number; pct: number }[] = []
    let lastPct = -Infinity
    for (let year = Math.ceil(minY / step) * step; year <= maxY && out.length < 40; year += step) {
      const pct = (scale.toX(instantOfYear(year)) / maxX) * 100
      if (pct < -0.5 || pct > 100.5) continue
      if (pct - lastPct < AXIS_MIN_PCT_GAP) continue
      out.push({ year, pct })
      lastPct = pct
    }
    return out
  }, [isEmpty, minInstant, maxInstant, scale, maxX])

  // GS4: the era ribbon — `period` span nodes laid out in the same percentage space,
  // greedy-packed into ≤2 rows (later overlaps dropped for v1). 'era is period' per the
  // founder (resolves OQ-S4).
  const eraBand = useMemo(() => {
    const periods = nodes
      .filter((n) => n.type === 'period' && n.endInstant != null)
      .sort((a, b) => a.startInstant - b.startInstant)
    const rowEndX: number[] = []
    const segs: {
      id: string
      title: string
      left: number
      width: number
      row: number
      start: number
      end: number
    }[] = []
    for (const p of periods) {
      const x0 = scale.toX(p.startInstant)
      const x1 = scale.toX(p.endInstant as number)
      if (x1 <= x0) continue
      let row = rowEndX.findIndex((e) => e <= x0)
      if (row === -1) {
        if (rowEndX.length >= 2) continue // >2 rows: drop (v1)
        row = rowEndX.length
        rowEndX.push(x1)
      } else {
        rowEndX[row] = x1
      }
      segs.push({
        id: p.id,
        title: p.title,
        left: (x0 / maxX) * 100,
        width: Math.max(((x1 - x0) / maxX) * 100, 0.8),
        row,
        start: p.startInstant,
        end: p.endInstant as number,
      })
    }
    return { segs, rows: rowEndX.length }
  }, [nodes, scale, maxX])

  // Fraction against the TRUE extent, not the floored maxX — so a degenerate
  // sub-1px timeline (all nodes at ~one instant) doesn't pin the thumb at 0%.
  const trueExtentX = scale.toX(maxInstant)
  const thumbPct =
    trueExtentX >= 1 ? Math.min((scale.toX(cursorInstant) / trueExtentX) * 100, 100) : cursorInstant >= maxInstant ? 100 : 0

  // The rise: the globe content sits low (a planet over a horizon) while empty and
  // glides up to center once populated; on first mount it rises in from fully below.
  const [cx, cy] = projection.translate()
  const sphereR = projection.scale()
  const riseY = isEmpty ? size.h * 0.46 : 0
  const enterY = !reducedMotion && !mounted && isEmpty ? size.h : riseY
  const riseTransition = reducedMotion ? 'none' : 'transform 1100ms cubic-bezier(0.16, 1, 0.3, 1)'

  return (
    <div ref={containerRef} className="globe-lens" data-empty={isEmpty || undefined} data-testid="globe-lens">
      {!isEmpty && !coverage.sufficient && (
        <div className="globe-coverage-banner">
          <span>
            {coverage.located} of {coverage.total - coverage.placeless} placeable nodes are on the map
            {coverage.placeless > 0 ? ` · ${coverage.placeless} can’t be pinned` : ''}.
          </span>
          <button type="button" onClick={onBackfill}>
            Add more locations
          </button>
        </div>
      )}

      <svg
        ref={svgRef}
        className="globe-svg"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerDown={onGlobePointerDown}
        role="img"
        aria-label="Globe view of the timeline"
      >
        <defs>
          <radialGradient id="globe-atmosphere">
            <stop offset="60%" stopColor="var(--color-accent-primary)" stopOpacity="0" />
            <stop offset="84%" stopColor="var(--color-accent-primary)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-accent-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* The rise group: translated low while empty, glides to center when populated. */}
        <g className="globe-rise" style={{ transform: `translateY(${enterY}px)`, transition: riseTransition }}>
          <circle className="globe-atmosphere" cx={cx} cy={cy} r={sphereR * 1.16} fill="url(#globe-atmosphere)" />
          <path className="globe-sphere" d={spherePath} />
        <path className="globe-graticule" d={gratPath} />
        {landPaths.map((d, i) => (
          <path key={i} className="globe-land" d={d} />
        ))}
        {markers.map(({ n, x, y, active, past, selected }) => (
          <g
            key={n.id}
            className="globe-marker"
            transform={`translate(${x},${y})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => handleMarker(n)}
            onPointerEnter={() => setHoveredId(n.id)}
            onPointerLeave={() => setHoveredId((cur) => (cur === n.id ? null : cur))}
            style={{ cursor: 'pointer' }}
          >
            {(active || selected) && <circle className="globe-marker-halo" r={markerRadius(n.size) + 6} />}
            <circle
              className="globe-marker-dot"
              data-state={active ? 'active' : past ? 'past' : 'point'}
              data-selected={selected || undefined}
              r={markerRadius(n.size)}
            />
          </g>
        ))}
        {/* GS3: floating type+title cards over the decluttered marker set. Cards are
            presentational (pointer-events:none) so they never block a marker click;
            hover is driven by the marker <g> above. The PRIMARY (highlight) card's
            title keeps the legacy `globe-marker-label` hook so it stays singular. */}
        {labels.map(({ n, x, y, primary }) => {
          const Icon = markerIcon(n)
          const w = 168
          const h = 26
          return (
            <foreignObject
              key={`label-${n.id}`}
              className="globe-label-fo"
              x={x - w / 2}
              y={y - markerRadius(n.size) - h - 2}
              width={w}
              height={h}
            >
              <div className="globe-label" data-primary={primary || undefined}>
                <Icon className="globe-label-icon" size={12} />
                <span className={`globe-label-title${primary ? ' globe-marker-label' : ''}`}>{n.title}</span>
              </div>
            </foreignObject>
          )
        })}
        </g>
      </svg>

      {placelessCaption && (
        <div className="globe-placeless-caption" data-testid="globe-placeless-caption">
          <span className="globe-placeless-name">{placelessCaption.title}</span>
          <span className="globe-placeless-where">
            {placelessCaption.location ?? GEO_SCOPE_LABELS[placelessCaption.geoScope!]}
          </span>
        </div>
      )}

      {isEmpty ? (
        <div className="globe-empty" data-testid="globe-empty">
          <Globe className="globe-empty-icon" size={30} />
          <h3 className="globe-empty-title">No globe yet</h3>
          <p>
            None of this timeline’s nodes have map coordinates, so there’s nothing to plot yet. Build the globe by
            asking your connected Claude to give each node a place.
          </p>
          <button type="button" className="globe-empty-btn" onClick={onBackfill}>
            Create a globe
          </button>
        </div>
      ) : (
        <>
        {/* GS2: zoom controls — left-center, clear of the bottom scrubber/caption.
            Disabled at the clamp ends; ⌘K mirrors these via controlsRef. */}
        <div className="globe-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="globe-zoom-btn"
            aria-label="Zoom in"
            onClick={() => commitZoom(zoom * ZOOM_STEP_IN)}
            disabled={zoom >= ZOOM_MAX - 0.01}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="globe-zoom-btn"
            aria-label="Zoom out"
            onClick={() => commitZoom(zoom * ZOOM_STEP_OUT)}
            disabled={zoom <= ZOOM_MIN + 0.01}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="globe-zoom-btn"
            aria-label="Reset zoom"
            onClick={() => commitZoom(1)}
            disabled={zoom <= ZOOM_MIN + 0.01}
          >
            <Maximize size={15} />
          </button>
        </div>
        {/* Full-width transport: the bar spans the whole bottom edge regardless of
            an open detail/story dock — those panels float ABOVE it (bottom:
            var(--dock-bottom), well clear of the 16px-from-bottom bar), matching the
            timeline lens's full-width scrubber. rightInset still re-centers the
            GLOBE itself (viewW), just not this bar. */}
        <div className="globe-scrubber" data-story={storyMode || undefined} style={{ right: 16 }}>
        {/* While a story plays the reader's Play is the transport (GS1), so the
            globe's own play button + speed hide; the track stays as a read-only
            progress readout (a manual scrub still detaches until the next beat). */}
        {!storyMode && (
          <button
            type="button"
            className="globe-scrubber-btn"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
        )}
        {/* GS4: the transport reads as a dated timeline — an era/period ribbon, the
            scrub track with year ticks, and a year-label axis, all in one x-space. */}
        <div className="globe-timeline">
          {eraBand.segs.length > 0 && (
            <div className="globe-era-band" style={{ height: eraBand.rows * ERA_ROW_H }} aria-hidden>
              {eraBand.segs.map((s) => {
                const active = s.start <= cursorInstant && cursorInstant <= s.end
                return (
                  <div
                    key={s.id}
                    className="globe-era-seg"
                    data-active={active || undefined}
                    style={{ left: `${s.left}%`, width: `${s.width}%`, top: s.row * ERA_ROW_H }}
                    title={`${s.title} · ${formatInstantRange(s.start, s.end, 'year', true)}`}
                  >
                    <span className="globe-era-label">{s.title}</span>
                  </div>
                )
              })}
            </div>
          )}
          <div ref={trackRef} className="globe-track" onPointerDown={onTrackPointerDown}>
            {scale.collapsedRanges.map((r, i) => (
              <span
                key={i}
                className="globe-collapsed"
                style={{ left: `${(r.x0 / maxX) * 100}%`, width: `${((r.x1 - r.x0) / maxX) * 100}%` }}
              />
            ))}
            {axisTicks.map((t) => (
              <span key={t.year} className="globe-axis-tick" style={{ left: `${t.pct}%` }} />
            ))}
            <span className="globe-track-fill" style={{ width: `${thumbPct}%` }} />
            <span className="globe-thumb" style={{ left: `${thumbPct}%` }} />
          </div>
          <div className="globe-axis" aria-hidden>
            {axisTicks.map((t) => (
              <span key={t.year} className="globe-axis-label" style={{ left: `${t.pct}%` }}>
                {yearLabel(t.year)}
              </span>
            ))}
          </div>
        </div>
        <div className="globe-date">{formatInstant(cursorInstant, cursorPrecision)}</div>
        {!storyMode && (
          <div className="globe-speed" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className="globe-speed-btn"
                data-active={s === speed || undefined}
                aria-pressed={s === speed}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  )
}
