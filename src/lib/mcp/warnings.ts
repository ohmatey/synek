import type { Graph } from '~/lib/db/graph'
import type { NodeRow } from '~/lib/db/schema'
import {
  BASE_PX_PER_DAY,
  DEFAULT_COLLAPSE_GAPS,
  MAX_PX_PER_DAY,
  clampPxPerDay,
  type TimelineViewSettings,
} from '~/lib/domain/types'
import { formatInstant } from '~/lib/domain/dates'
import { findDeadZones } from '~/lib/domain/dead-zones'
import { safeFetch, SsrfError } from '~/lib/net/ssrf'
import { activeSpan, intervalDistance } from './graph-shape'
import type { Op, OpResult } from './ops'

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
const MAX_CITATION_CHECKS = 8
const MAX_WARNINGS = 12

// Connected-but-distant thresholds: an edge whose endpoints' time intervals sit
// more than half the active span apart always warns; above 30% it warns only
// when a dead zone separates them (endpoints in different clusters of activity
// — the signal that survives the canvas's sparse-time compression).
const LONG_EDGE_SPAN_FRACTION = 0.5
const LONG_EDGE_DEADZONE_FRACTION = 0.3
const MAX_CONNECTED_DISTANCE_WARNINGS = 3

// --- URL verification (images + citation links) ----------------------------
//
// Three-way verdicts, not pass/fail: a 429 from Wikimedia (rate limit) or a 403
// from a publisher (bot blocking) says nothing about whether the URL renders in
// the user's browser — only 404/410 (and, for images, a non-image content-type)
// are conclusive. Treating transient statuses as "broken" produced a wall of
// false positives in practice (parallel HEADs to one host triggered the very
// rate limit being reported), so checks to the same host are paced ~300ms apart
// and conclusive verdicts are cached across patches.

type UrlVerdict = { status: 'ok' | 'broken' | 'unverified'; detail?: string }

const VERDICT_TTL_MS = 10 * 60_000
const SAME_HOST_GAP_MS = 300
const verdictCache = new Map<string, { verdict: UrlVerdict; at: number }>()

async function fetchVerdict(url: string, expectImage: boolean): Promise<UrlVerdict> {
  try {
    // safeFetch is the SSRF chokepoint: rejects non-routable/internal targets
    // (and redirects to them) before any connection. http is allowed here —
    // legacy citation/image sources legitimately use it; the IP-range check,
    // not the scheme, is the SSRF defense. See lib/net/ssrf.ts + ADR 0002.
    let res = await safeFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) }, { allowHttp: true })
    // Some hosts reject HEAD; retry as GET and discard the body.
    if (res.status === 405 || res.status === 501) {
      res = await safeFetch(url, { signal: AbortSignal.timeout(4000) }, { allowHttp: true })
      void res.body?.cancel()
    }
    if (res.status === 404 || res.status === 410) {
      return { status: 'broken', detail: `returned HTTP ${res.status}` }
    }
    if (res.status === 429) {
      return { status: 'unverified', detail: 'the host rate-limited the check (HTTP 429) — likely fine; re-checked on a later patch' }
    }
    if (res.status === 401 || res.status === 403) {
      return { status: 'unverified', detail: `the host blocked the check (HTTP ${res.status}) — may still load in a browser` }
    }
    if (!res.ok) {
      return { status: 'unverified', detail: `returned HTTP ${res.status} — could not verify` }
    }
    if (expectImage) {
      const ct = res.headers.get('content-type') ?? ''
      if (ct && !ct.startsWith('image/')) {
        return { status: 'broken', detail: `serves "${ct}", not an image` }
      }
    }
    return { status: 'ok' }
  } catch (e) {
    if (e instanceof SsrfError) {
      // A URL we refused to fetch for safety. A non-routable/internal target is
      // conclusively bad (treat as broken so the agent removes it); a name we
      // simply couldn't resolve is inconclusive (transient DNS → unverified).
      if (e.reason === 'unresolved') {
        return { status: 'unverified', detail: 'could not be resolved — re-checked on a later patch' }
      }
      const detail =
        e.reason === 'blocked'
          ? 'points at a non-routable or internal address and was blocked'
          : e.reason === 'protocol'
            ? 'uses a disallowed URL scheme and was not fetched'
            : e.reason === 'credentials'
              ? 'embeds credentials in the URL and was not fetched'
              : e.reason === 'redirects'
                ? 'redirected too many times and was not fetched'
                : 'is not a valid URL'
      return { status: 'broken', detail }
    }
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return { status: 'unverified', detail: `could not be checked (${msg})` }
  }
}

// Verify a set of URLs: conclusive verdicts come from cache when fresh; live
// checks run host-by-host in parallel but sequentially (with a small gap)
// WITHIN a host, so the validator doesn't trigger the rate limit it reports.
async function verifyUrls(urls: string[], expectImage: boolean): Promise<Map<string, UrlVerdict>> {
  const out = new Map<string, UrlVerdict>()
  const toFetch: string[] = []
  const now = Date.now()
  for (const url of urls) {
    const hit = verdictCache.get(url)
    if (hit && hit.verdict.status !== 'unverified' && now - hit.at < VERDICT_TTL_MS) out.set(url, hit.verdict)
    else toFetch.push(url)
  }
  const byHost = new Map<string, string[]>()
  for (const url of toFetch) {
    let host = ''
    try {
      host = new URL(url).host
    } catch {
      out.set(url, { status: 'broken', detail: 'is not a valid URL' })
      continue
    }
    byHost.set(host, [...(byHost.get(host) ?? []), url])
  }
  await Promise.all(
    [...byHost.values()].map(async (hostUrls) => {
      for (let i = 0; i < hostUrls.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, SAME_HOST_GAP_MS))
        const url = hostUrls[i]!
        const verdict = await fetchVerdict(url, expectImage)
        verdictCache.set(url, { verdict, at: Date.now() })
        out.set(url, verdict)
      }
    }),
  )
  return out
}

// Image URLs that are conclusively broken → hard warnings; unverifiable ones get
// a soft note. Exported for write_story (story covers + beat images go through
// the same gate).
export async function imageUrlWarnings(urls: string[], label = 'image URL'): Promise<string[]> {
  const unique = [...new Set(urls)]
  const toCheck = unique.slice(0, MAX_IMAGE_CHECKS)
  const verdicts = await verifyUrls(toCheck, true)
  const warnings: string[] = []
  for (const [url, v] of verdicts) {
    if (v.status === 'broken') warnings.push(`${label} ${url} ${v.detail} — it will render broken; replace or drop it`)
    else if (v.status === 'unverified') warnings.push(`${label} ${url} ${v.detail}`)
  }
  if (unique.length > MAX_IMAGE_CHECKS) {
    warnings.push(`only the first ${MAX_IMAGE_CHECKS} of ${unique.length} image URLs were verified`)
  }
  return warnings
}

async function imageWarnings(ops: Op[]): Promise<string[]> {
  const urls: string[] = []
  for (const op of ops) {
    if ((op.op === 'add_node' || op.op === 'update_node') && op.images) {
      for (const im of op.images) urls.push(im.url)
    }
  }
  return imageUrlWarnings(urls)
}

// --- citations (checked for THIS batch's ops only) --------------------------
//
// Two complementary checks: links that ARE provided must resolve (a fabricated
// citation URL is worse than none), and a batch whose citations are mostly
// link-less gets a nudge — title-only is right for print sources, but stable
// links exist for most web-era material.

async function citationWarnings(ops: Op[]): Promise<string[]> {
  const withUrl: string[] = []
  let linkless = 0
  let total = 0
  for (const op of ops) {
    if ((op.op === 'add_node' || op.op === 'update_node') && op.citations) {
      for (const c of op.citations) {
        total++
        if (c.url) withUrl.push(c.url)
        else linkless++
      }
    }
  }
  const warnings: string[] = []
  const verdicts = await verifyUrls([...new Set(withUrl)].slice(0, MAX_CITATION_CHECKS), false)
  for (const [url, v] of verdicts) {
    if (v.status === 'broken') {
      warnings.push(`citation URL ${url} ${v.detail} — readers will hit a dead link; fix it or cite title-only`)
    }
  }
  if (total >= 4 && linkless / total > 0.5) {
    warnings.push(
      `${linkless} of ${total} citations in this patch have no URL — add stable links (Wikipedia, archive.org, ` +
        'publisher pages) where they exist; title-only is fine for print sources',
    )
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

// Events + periods define the timeline's "active span". A node whose whole time
// interval sits far outside it (a defunct org, a person who died a century
// before) stretches the axis into dead space — exactly what gap collapsing is
// for.
//
// Which is why this is GATED on the effective collapseGaps: with compression on
// (`DEFAULT_COLLAPSE_GAPS`, or the timeline's saved viewSettings) the canvas
// already shrinks that stretch to a 72–144px axis break, so there is no dead
// space left to report and the advisory would be recommending a remedy that is
// already in place. It fired on every patch of timelines that had done nothing
// wrong — permanent noise in the one channel a blind MCP writer reads, drowning
// the warnings that matter. The underlying facts stay visible either way:
// get_layout_report reports `axis.deadZones` and `axis.view.collapseGaps` as
// structured fields.
function outlierWarnings(nodes: NodeRow[], collapseGaps: boolean): string[] {
  if (collapseGaps) return []

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
    // Measured between the node's time INTERVAL and the active span, the same
    // rule `intervalDistance` uses for long edges — an entity dated 2015–2026
    // against a 2026 span fills that stretch with its own card, so there is no
    // dead space to report, and one whose span CONTAINS the active period
    // overshoots by 0. Only the empty run between the node's nearest edge and
    // the span counts.
    const nodeEnd = n.endInstant ?? n.startInstant
    const overshoot = Math.max(0, lo - nodeEnd, n.startInstant - hi)
    if (overshoot <= span / 2) continue
    const years = Math.round(overshoot / MS_PER_DAY / DAYS_PER_YEAR)
    // Show the whole interval, so the distance quoted below is measured from a
    // date the reader can see (for a span it comes from the near edge, not the
    // start).
    const when =
      n.endInstant != null
        ? `${formatInstant(n.startInstant, 'year')}–${formatInstant(n.endInstant, 'year')}`
        : formatInstant(n.startInstant, 'year')
    // Re-dating is only ever advice for a `concept`, whose position on the axis
    // is an editorial placement. An `entity`'s start IS its real founding/birth
    // date, so "anchor it nearer its relevance" asks the writer to falsify the
    // data to flatter the layout — never suggest it.
    const fix =
      n.type === 'entity'
        ? 'turn collapseGaps back on with set_timeline_view so the stretch compresses. Do NOT re-date the node — ' +
          "an entity's start is its real founding/birth date and moving it would falsify the data; if its early " +
          "history is not part of this timeline's story, drop the anchor instead"
        : 'turn collapseGaps back on with set_timeline_view so the stretch compresses, or anchor the node nearer ' +
          'its relevance'
    warnings.push(
      `"${n.title}" (${when}) sits ~${years}y outside the events' span ` +
        `(${formatInstant(lo, 'year')}–${formatInstant(hi, 'year')}) and stretches the axis with dead space ` +
        `because collapseGaps is off for this timeline — ${fix}`,
    )
  }
  return warnings
}

// --- connected-but-distant edges (THIS batch's edges/moved nodes only) ------
//
// An edge is a claim that two nodes share a story, so endpoints far apart on
// the axis usually mean a date typo, a missing lane grouping, or a missing
// bridging node. Batch-scoped on purpose: whole-graph sprawl belongs in
// get_layout_report's `grouping` section — re-warning about the same old edge
// on every patch is noise the agent learns to ignore. Distance is measured
// between the nodes' time INTERVALS (an entity spanning 1900–2020 overlaps a
// 2015 event → distance 0, no warning).
function connectedDistanceWarnings(graph: Graph, ops: Op[], results?: OpResult[]): string[] {
  if (!results || graph.nodes.length < 4) return []
  const span = activeSpan(graph.nodes)
  if (!span) return []

  // What this batch touched: edges added/updated, plus nodes added or re-dated
  // (a pure summary edit doesn't re-trigger its edges).
  const edgeIds = new Set<string>()
  const nodeIds = new Set<string>()
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    const r = results[i]
    if (!r || !('id' in r)) continue
    if (op.op === 'add_edge' || op.op === 'update_edge') edgeIds.add(r.id)
    else if (op.op === 'add_node') nodeIds.add(r.id)
    else if (op.op === 'update_node' && (op.start != null || op.end != null)) nodeIds.add(r.id)
  }
  if (edgeIds.size === 0 && nodeIds.size === 0) return []

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const zones = findDeadZones(
    graph.nodes.flatMap((n) => [n.startInstant, ...(n.endInstant != null ? [n.endInstant] : [])]),
  )

  const hits: { text: string; dist: number }[] = []
  const seen = new Set<string>()
  for (const e of graph.edges) {
    if (!(edgeIds.has(e.id) || nodeIds.has(e.sourceId) || nodeIds.has(e.targetId))) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const a = byId.get(e.sourceId)
    const b = byId.get(e.targetId)
    if (!a || !b) continue
    const dist = intervalDistance(a, b)
    if (dist <= 0) continue
    // The empty stretch between the two intervals — a dead zone inside it means
    // the endpoints sit in different clusters of activity.
    const gapLo = Math.min(a.endInstant ?? a.startInstant, b.endInstant ?? b.startInstant)
    const gapHi = Math.max(a.startInstant, b.startInstant)
    const crossesDeadZone = zones.some((z) => z.fromInstant >= gapLo && z.toInstant <= gapHi)
    const frac = dist / span.span
    if (frac <= LONG_EDGE_DEADZONE_FRACTION) continue
    if (frac <= LONG_EDGE_SPAN_FRACTION && !crossesDeadZone) continue

    const years = Math.round(dist / MS_PER_DAY / DAYS_PER_YEAR)
    const pct = Math.round(frac * 100)
    const sameLane = a.metadata?.lane != null && a.metadata.lane === b.metadata?.lane
    const where = crossesDeadZone ? ', with a dead zone between them' : ''
    const fix = sameLane
      ? `they share lane "${a.metadata!.lane}" but jump most of the axis — verify the dates, or add an intermediate node so the thread reads as a sequence`
      : 'if they belong to one narrative thread, give both the same lane, add an intermediate bridging node, or double-check the dates'
    hits.push({
      dist,
      text:
        `"${a.title}" and "${b.title}" are connected (${e.kind}) but ~${years}y apart — about ${pct}% of the ` +
        `timeline's span${where}. ${fix}. A deliberate deep-history reach is fine — keep it, prefer ` +
        `\`influenced\`, and give the edge a label so readers know it's intentional.`,
    })
  }

  hits.sort((x, y) => y.dist - x.dist)
  const warnings = hits.slice(0, MAX_CONNECTED_DISTANCE_WARNINGS).map((h) => h.text)
  if (hits.length > MAX_CONNECTED_DISTANCE_WARNINGS) {
    warnings.push(
      `…and ${hits.length - MAX_CONNECTED_DISTANCE_WARNINGS} more long-reach edges in this batch — ` +
        `call get_layout_report and check the \`grouping\` section`,
    )
  }
  return warnings
}

// --- coordinates (checked for THIS batch's ops only) -----------------------
//
// The globe lens plots a node only when it carries BOTH lat and lng. Two cheap,
// batch-scoped, false-positive-free checks: a brand-new node given exactly one
// coordinate (it can't be plotted), and the classic "null island" (0, 0) that
// usually means a geocoding lookup failed. Range is already a hard zod error,
// so it never reaches here. No ocean/landmass check in v1 (that needs the
// server to carry the world TopoJSON — deferred).
function coordinateWarnings(ops: Op[]): string[] {
  const warnings: string[] = []
  for (const op of ops) {
    if (op.op !== 'add_node' && op.op !== 'update_node') continue
    const { lat, lng } = op
    const label = op.op === 'add_node' ? `"${op.title}"` : op.title ? `"${op.title}"` : `node ${op.id}`
    // Coordinates and the placeless marker contradict each other within one op —
    // the coordinates were kept and geoScope was ignored.
    if (op.geoScope != null && (lat != null || lng != null)) {
      warnings.push(
        `${label}: both coordinates and geoScope "${op.geoScope}" were supplied — they are mutually exclusive ` +
          '(a node is either pinned or placeless). The coordinates were kept and geoScope was ignored; ' +
          'if the node really cannot be pinned, re-send geoScope with lat/lng null.',
      )
    }
    if (lat === 0 && lng === 0) {
      warnings.push(
        `${label}: coordinates (0, 0) look like a geocoding failure ("null island" in the Gulf of Guinea) — ` +
          'double-check the lat/lng for this place',
      )
      continue
    }
    // A NEW node needs both coordinates to land on the globe; a lone one is dropped.
    if (op.op === 'add_node') {
      const hasLat = lat != null
      const hasLng = lng != null
      if (hasLat !== hasLng) {
        warnings.push(
          `${label}: only ${hasLat ? 'lat' : 'lng'} was supplied — the globe needs BOTH lat and lng to plot a ` +
            'node, so this coordinate will not place it. Supply the matching value.',
        )
      }
    }
  }
  return warnings
}

// --- entry point ------------------------------------------------------------

export async function collectPatchWarnings(
  graph: Graph,
  ops: Op[],
  view: TimelineViewSettings | null,
  results?: OpResult[],
): Promise<string[]> {
  const pxPerDay = view?.pxPerDay ?? BASE_PX_PER_DAY
  // The effective server-side value — the same one get_layout_report reports as
  // `axis.view.collapseGaps`. A device-local override (ScalePref.chosen) isn't
  // visible here, and shouldn't be: advisories describe the timeline's saved
  // view, which is what every other reader opens it with.
  const collapseGaps = view?.collapseGaps ?? DEFAULT_COLLAPSE_GAPS
  // Batch-scoped checks first so targeted feedback survives the truncation
  // below ahead of the whole-graph repeats.
  const warnings = [
    ...(await imageWarnings(ops)),
    ...(await citationWarnings(ops)),
    ...coordinateWarnings(ops),
    ...connectedDistanceWarnings(graph, ops, results),
    ...laneDensityWarnings(graph.nodes, pxPerDay),
    ...outlierWarnings(graph.nodes, collapseGaps),
  ]
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `…and ${warnings.length - MAX_WARNINGS} more warnings`]
  }
  return warnings
}
