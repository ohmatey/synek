import type { Graph } from '~/lib/db/graph'
import type { NodeRow } from '~/lib/db/schema'
import { BASE_PX_PER_DAY, MAX_PX_PER_DAY, clampPxPerDay, type TimelineViewSettings } from '~/lib/domain/types'
import { formatInstant } from '~/lib/domain/dates'
import type { Op } from './ops'

// Post-commit advisory checks for apply_patch. The building MCP client works
// blind — it never sees the rendered canvas — so the server tells it what the
// canvas knows: broken images, lanes too dense for the current scale, and
// outlier dates that stretch the axis. Warnings never fail or roll back a
// patch; they exist so the agent can fix the NEXT call (or call
// set_timeline_view).

const MS_PER_DAY = 86_400_000
const DAYS_PER_YEAR = 365.25

// Mirrors the canvas's fixed entity card / typical event pill footprint (px of
// base layout). Only used to predict row stacking, so rough is fine.
const APPROX_CARD_PX = 210
const H_GAP = 16
// Average same-lane spacing below which the lane reads as a deep stack.
const CRAMPED_AVG_GAP_PX = 110

const MAX_IMAGE_CHECKS = 12
const MAX_WARNINGS = 12

// --- image URLs (checked for THIS batch's ops only) ------------------------

async function checkImageUrl(url: string): Promise<string | null> {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) })
    // Some hosts reject HEAD; retry as GET and discard the body.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(4000) })
      void res.body?.cancel()
    }
    if (!res.ok) return `image URL ${url} returned HTTP ${res.status} — it will render broken; replace or drop it`
    const ct = res.headers.get('content-type') ?? ''
    if (ct && !ct.startsWith('image/')) {
      return `image URL ${url} serves "${ct}", not an image — it will render broken; replace or drop it`
    }
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return `could not verify image URL ${url} (${msg}) — make sure it loads publicly`
  }
}

async function imageWarnings(ops: Op[]): Promise<string[]> {
  const urls = new Set<string>()
  for (const op of ops) {
    if ((op.op === 'add_node' || op.op === 'update_node') && op.images) {
      for (const im of op.images) urls.add(im.url)
    }
  }
  const toCheck = [...urls].slice(0, MAX_IMAGE_CHECKS)
  const results = await Promise.all(toCheck.map(checkImageUrl))
  const warnings = results.filter((w): w is string => w != null)
  if (urls.size > MAX_IMAGE_CHECKS) {
    warnings.push(`only the first ${MAX_IMAGE_CHECKS} of ${urls.size} image URLs were verified`)
  }
  return warnings
}

// --- lane density (whole graph — the canvas packs the whole lane) ----------

function laneDensityWarnings(nodes: NodeRow[], pxPerDay: number): string[] {
  const byLane = new Map<string, NodeRow[]>()
  for (const n of nodes) {
    const lane = n.metadata?.lane
    if (!lane) continue
    const arr = byLane.get(lane) ?? []
    arr.push(n)
    byLane.set(lane, arr)
  }

  const warnings: string[] = []
  for (const [lane, arr] of byLane) {
    if (arr.length < 3) continue
    const xs = arr.map((n) => n.startInstant).sort((a, b) => a - b)
    const spanDays = (xs[xs.length - 1]! - xs[0]!) / MS_PER_DAY
    const avgGapPx = (spanDays * pxPerDay) / (arr.length - 1)
    if (avgGapPx >= CRAMPED_AVG_GAP_PX) continue
    const rows = Math.max(2, Math.ceil((APPROX_CARD_PX + H_GAP) / Math.max(avgGapPx, 1)))
    const suggested = clampPxPerDay(Number((pxPerDay * ((APPROX_CARD_PX + H_GAP) / Math.max(avgGapPx, 1))).toPrecision(2)))
    const fix =
      suggested > pxPerDay && suggested < MAX_PX_PER_DAY
        ? `set_timeline_view with pxPerDay ≈ ${suggested}`
        : 'splitting it into narrower lanes or trimming nodes'
    warnings.push(
      `lane "${lane}": ${arr.length} nodes average ~${Math.round(avgGapPx)}px apart at the current default scale ` +
        `(cards are ~${APPROX_CARD_PX}px) — they will stack ~${rows} rows deep; consider ${fix}`,
    )
  }
  return warnings
}

// --- axis outliers (whole graph) -------------------------------------------

// Events + periods define the timeline's "active span". An entity anchored far
// outside it (an org founded decades earlier, a person born a century before)
// stretches the axis into dead space — exactly what gap collapsing is for.
function outlierWarnings(nodes: NodeRow[]): string[] {
  const active: number[] = []
  for (const n of nodes) {
    if (n.type !== 'event' && n.type !== 'period') continue
    active.push(n.startInstant)
    if (n.endInstant != null) active.push(n.endInstant)
  }
  if (active.length < 2) return []
  const lo = Math.min(...active)
  const hi = Math.max(...active)
  const span = hi - lo
  if (span <= 0) return []

  const warnings: string[] = []
  for (const n of nodes) {
    if (n.type === 'event' || n.type === 'period') continue
    const overshoot = Math.max(lo - n.startInstant, n.startInstant - hi)
    if (overshoot <= span / 2) continue
    const years = Math.round(overshoot / MS_PER_DAY / DAYS_PER_YEAR)
    warnings.push(
      `"${n.title}" (${formatInstant(n.startInstant, 'year')}) sits ~${years}y outside the events' span ` +
        `(${formatInstant(lo, 'year')}–${formatInstant(hi, 'year')}) and stretches the axis with dead space — ` +
        `enable collapseGaps via set_timeline_view, or anchor the node nearer its relevance`,
    )
  }
  return warnings
}

// --- entry point ------------------------------------------------------------

export async function collectPatchWarnings(
  graph: Graph,
  ops: Op[],
  view: TimelineViewSettings | null,
): Promise<string[]> {
  const pxPerDay = view?.pxPerDay ?? BASE_PX_PER_DAY
  const warnings = [
    ...(await imageWarnings(ops)),
    ...laneDensityWarnings(graph.nodes, pxPerDay),
    ...outlierWarnings(graph.nodes),
  ]
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `…and ${warnings.length - MAX_WARNINGS} more warnings`]
  }
  return warnings
}
