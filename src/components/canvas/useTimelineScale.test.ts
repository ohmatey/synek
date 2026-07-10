import { describe, test, expect } from 'bun:test'
import { makeTimeScale, instantToX, collapseFromPref, type ScalePref } from './useTimelineScale'
import { DEFAULT_COLLAPSE_GAPS } from '~/lib/domain/types'

// Pure-function coverage of the cluster-aware sparse-time compression
// (makeTimeScale) — the axis math every canvas surface shares.

const MS_PER_DAY = 86_400_000
const PX_PER_DAY = 0.5

const year = (y: number) => Date.UTC(y, 0, 1)
const years = (ys: number[]) => ys.map(year)

// Compressed-gap bounds from the implementation (COLLAPSED_PX / COLLAPSED_MAX_PX).
const MIN_COMPRESSED = 72
const MAX_COMPRESSED = 144

describe('makeTimeScale — linear mode', () => {
  test('collapseGaps off is pure linear', () => {
    const anchors = years([1900, 1950, 2000])
    const s = makeTimeScale(anchors, PX_PER_DAY, false)
    for (const a of anchors) expect(s.toX(a)).toBe(instantToX(a, anchors[0]!, PX_PER_DAY))
    expect(s.collapsedRanges).toEqual([])
  })

  test('fewer than 3 anchors stays linear even with collapseGaps on', () => {
    // A lone period's start+end pair must not render as one compressed bar.
    const anchors = years([1000, 2000])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    expect(s.toX(anchors[1]!)).toBe(instantToX(anchors[1]!, anchors[0]!, PX_PER_DAY))
    expect(s.collapsedRanges).toEqual([])
  })
})

describe('makeTimeScale — cluster-aware compression', () => {
  test('an all-dense timeline maps identically to linear (default-ON is invisible)', () => {
    const anchors = years([2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    for (const a of anchors) expect(s.toX(a)).toBeCloseTo(instantToX(a, anchors[0]!, PX_PER_DAY), 6)
    expect(s.collapsedRanges).toEqual([])
  })

  test('sparse stretches between clusters compress, including around a stray anchor', () => {
    // Cluster (1900–1905), a stray 1940, cluster (1980–1985): the gaps on BOTH
    // sides of the stray compress — the upgrade over the old single-empty-gap rule.
    const anchors = years([1900, 1901, 1902, 1903, 1904, 1905, 1940, 1980, 1981, 1982, 1983, 1984, 1985])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    expect(s.collapsedRanges.length).toBe(2)
    for (const r of s.collapsedRanges) {
      const w = r.x1 - r.x0
      expect(w).toBeGreaterThanOrEqual(MIN_COMPRESSED)
      expect(w).toBeLessThanOrEqual(MAX_COMPRESSED)
    }
    // The stray keeps a distinct, ordered x strictly between the clusters.
    expect(s.toX(year(1940))).toBeGreaterThan(s.toX(year(1905)))
    expect(s.toX(year(1980))).toBeGreaterThan(s.toX(year(1940)))
    // Intra-cluster spacing is preserved exactly.
    const clusterGap = s.toX(year(1901)) - s.toX(year(1900))
    expect(clusterGap).toBeCloseTo(((year(1901) - year(1900)) / MS_PER_DAY) * PX_PER_DAY, 6)
  })

  test('uniformly sparse under the cap stays honest linear (node every 20y)', () => {
    const anchors = years([1900, 1920, 1940, 1960, 1980, 2000])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    expect(s.collapsedRanges).toEqual([])
    expect(s.toX(year(2000))).toBeCloseTo(instantToX(year(2000), year(1900), PX_PER_DAY), 6)
  })

  test('uniformly sparse over the cap compresses every gap (node every 50y)', () => {
    const anchors = years([1800, 1850, 1900, 1950, 2000])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    expect(s.collapsedRanges.length).toBe(anchors.length - 1)
  })

  test('compression never expands the axis', () => {
    const anchors = years([1000, 1001, 1500, 1990, 1991, 1992])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    const linearEnd = instantToX(anchors[anchors.length - 1]!, anchors[0]!, PX_PER_DAY)
    expect(s.toX(anchors[anchors.length - 1]!)).toBeLessThanOrEqual(linearEnd)
  })

  test('collapsedRanges are ordered and non-overlapping', () => {
    const anchors = years([-500, -499, 800, 801, 1900, 1901, 1902])
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    expect(s.collapsedRanges.length).toBeGreaterThan(0)
    for (let i = 1; i < s.collapsedRanges.length; i++) {
      expect(s.collapsedRanges[i]!.x0).toBeGreaterThanOrEqual(s.collapsedRanges[i - 1]!.x1)
    }
  })
})

describe('makeTimeScale — invertibility', () => {
  test('toInstant is the exact inverse of toX, BCE included, and toX is strictly monotonic', () => {
    const anchors = [
      year(-2500),
      year(-2499),
      year(-2450),
      year(-800),
      year(-799),
      year(1969),
      year(1970),
      year(1971),
      year(2024),
    ]
    const s = makeTimeScale(anchors, PX_PER_DAY, true)
    let prevX = -Infinity
    for (const a of anchors) {
      const x = s.toX(a)
      expect(x).toBeGreaterThan(prevX)
      prevX = x
      // Round-trip within a ms-per-px of tolerance (float math over huge ranges).
      expect(Math.abs(s.toInstant(x) - a)).toBeLessThan(MS_PER_DAY)
    }
    // Off-anchor probes round-trip too (inside a compressed segment and beyond the ends).
    for (const probe of [year(-1500), year(1000), year(2100)]) {
      expect(Math.abs(s.toInstant(s.toX(probe)) - probe)).toBeLessThan(MS_PER_DAY)
    }
  })
})

describe('collapseFromPref — default-ON gating', () => {
  const pref = (over: Partial<ScalePref>): ScalePref => ({
    pxPerDay: PX_PER_DAY,
    collapseGaps: false,
    autoRefresh: true,
    speak: false,
    autoPlay: true,
    ...over,
  })

  test('no pref → the default', () => {
    expect(collapseFromPref(null)).toBe(DEFAULT_COLLAPSE_GAPS)
  })

  test('ambient (not chosen) pref never freezes the old default', () => {
    expect(collapseFromPref(pref({ collapseGaps: false, chosen: false }))).toBe(DEFAULT_COLLAPSE_GAPS)
  })

  test('an explicit user choice wins in both directions', () => {
    expect(collapseFromPref(pref({ collapseGaps: false, chosen: true }))).toBe(false)
    expect(collapseFromPref(pref({ collapseGaps: true, chosen: true }))).toBe(true)
  })
})
