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
const MAX_CITATION_CHECKS = 8
const MAX_WARNINGS = 12

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
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) })
    // Some hosts reject HEAD; retry as GET and discard the body.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(4000) })
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
    ...(await citationWarnings(ops)),
    ...laneDensityWarnings(graph.nodes, pxPerDay),
    ...outlierWarnings(graph.nodes),
  ]
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `…and ${warnings.length - MAX_WARNINGS} more warnings`]
  }
  return warnings
}
