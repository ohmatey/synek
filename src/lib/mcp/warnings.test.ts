import { describe, test, expect } from 'bun:test'
import type { NodeRow } from '~/lib/db/schema'
import type { Graph } from '~/lib/db/graph'
import { DEFAULT_COLLAPSE_GAPS, type TimelineViewSettings } from '~/lib/domain/types'
import { collectPatchWarnings } from './warnings'

// Coverage for the axis-outlier advisory's collapseGaps gate. Driven through
// the real entry point rather than the private helper so the effective-value
// resolution (saved viewSettings → DEFAULT_COLLAPSE_GAPS) is covered too.
//
// An empty `ops` list makes no network calls (the image/citation verifiers get
// nothing to fetch), so this stays a pure unit test.

function instant(year: number, month = 0): number {
  return Date.UTC(year, month, 1)
}

function node(over: Partial<NodeRow> & Pick<NodeRow, 'id' | 'type' | 'title' | 'startInstant'>): NodeRow {
  return {
    timelineId: 't1',
    entityId: null,
    summary: null,
    endInstant: null,
    precision: 'year',
    laneHint: null,
    metadata: null,
    createdAt: new Date(0),
    ...over,
  } as NodeRow
}

// The reported repro, minimized: entity anchors at their real founding years,
// every event clustered in one much later year.
const techRadar: Graph = {
  nodes: [
    node({ id: 'e1', type: 'entity', title: 'OpenAI', startInstant: instant(2015) }),
    node({ id: 'e2', type: 'entity', title: 'Anthropic', startInstant: instant(2021) }),
    node({ id: 'ev1', type: 'event', title: 'Model release', startInstant: instant(2026) }),
    node({ id: 'ev2', type: 'event', title: 'Funding round', startInstant: instant(2026, 6) }),
  ],
  edges: [],
}

const view = (over: Partial<TimelineViewSettings> = {}): TimelineViewSettings => ({
  pxPerDay: 4,
  collapseGaps: true,
  ...over,
})

const axisWarnings = (w: string[]) => w.filter((s) => s.includes('stretches the axis'))

describe('axis-outlier advisory — collapseGaps gate', () => {
  test('stays silent when the timeline has collapseGaps on', async () => {
    const warnings = await collectPatchWarnings(techRadar, [], view({ collapseGaps: true }))
    expect(axisWarnings(warnings)).toEqual([])
  })

  test('stays silent when the timeline has no saved view and the default is on', async () => {
    expect(DEFAULT_COLLAPSE_GAPS).toBe(true)
    const warnings = await collectPatchWarnings(techRadar, [], null)
    expect(axisWarnings(warnings)).toEqual([])
  })

  test('fires once per outlier when collapseGaps is explicitly off', async () => {
    const warnings = axisWarnings(await collectPatchWarnings(techRadar, [], view({ collapseGaps: false })))
    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).toContain('"OpenAI" (2015)')
    expect(warnings.join('\n')).toContain('"Anthropic" (2021)')
    for (const w of warnings) {
      expect(w).toContain('collapseGaps is off for this timeline')
      expect(w).toContain('set_timeline_view')
    }
  })

  test('never proposes re-dating an entity — its start is a real founding date', async () => {
    const [warning] = axisWarnings(
      await collectPatchWarnings(
        { nodes: techRadar.nodes.filter((n) => n.id !== 'e2'), edges: [] },
        [],
        view({ collapseGaps: false }),
      ),
    )
    expect(warning).toContain('Do NOT re-date the node')
    expect(warning).not.toContain('anchor the node nearer its relevance')
  })

  test('still offers re-dating for a concept, whose axis position is editorial', async () => {
    const graph: Graph = {
      nodes: [
        node({ id: 'c1', type: 'concept', title: 'Connectionism', startInstant: instant(1958) }),
        ...techRadar.nodes.filter((n) => n.type === 'event'),
      ],
      edges: [],
    }
    const [warning] = axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))
    expect(warning).toContain('"Connectionism" (1958)')
    expect(warning).toContain('anchor the node nearer its relevance')
    expect(warning).not.toContain('Do NOT re-date')
  })

  test('a span reaching into the active period is not dead space', async () => {
    // Founded 2015 but still going: the entity card physically occupies the
    // stretch between its founding and the events, so nothing is empty.
    const graph: Graph = {
      nodes: [
        node({
          id: 'e1',
          type: 'entity',
          title: 'OpenAI',
          startInstant: instant(2015),
          endInstant: instant(2026, 6),
        }),
        ...techRadar.nodes.filter((n) => n.type === 'event'),
      ],
      edges: [],
    }
    expect(axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))).toEqual([])
  })

  test('a span that CONTAINS the active period never warns', async () => {
    const graph: Graph = {
      nodes: [
        node({
          id: 'e1',
          type: 'entity',
          title: 'IBM',
          startInstant: instant(1911),
          endInstant: instant(2050),
        }),
        ...techRadar.nodes.filter((n) => n.type === 'event'),
      ],
      edges: [],
    }
    expect(axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))).toEqual([])
  })

  test('a span that ends far short still warns, measured from its near edge', async () => {
    const graph: Graph = {
      nodes: [
        node({
          id: 'e1',
          type: 'entity',
          title: 'Digital Equipment Corporation',
          startInstant: instant(1957),
          endInstant: instant(1998),
        }),
        ...techRadar.nodes.filter((n) => n.type === 'event'),
      ],
      edges: [],
    }
    const [warning] = axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))
    // The whole interval is shown, and the distance is the empty run from its
    // END (1998 → 2026 = 28y), not from its start (which would read 69y).
    expect(warning).toContain('"Digital Equipment Corporation" (1957–1998)')
    expect(warning).toContain('~28y outside')
  })

  test('a node inside the active span never warns, gate open or closed', async () => {
    const graph: Graph = {
      nodes: [
        node({ id: 'e1', type: 'entity', title: 'Anthropic', startInstant: instant(2026, 3) }),
        ...techRadar.nodes.filter((n) => n.type === 'event'),
      ],
      edges: [],
    }
    expect(axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))).toEqual([])
    expect(axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: true })))).toEqual([])
  })
})

// The real reported repro: 21 events packed into a 78-day window (May 21 – Aug
// 7 2026) with 6 founding-date entity anchors. A purely relative test
// (overshoot > span/2) degenerates here — span/2 is ~39 days, so any anchor
// more than ~6 weeks older than the cluster fired, including one founded
// barely a year before. The absolute floor (OUTLIER_FLOOR_YEARS) exists to
// stop that inversion: the tighter a timeline's focus, the more aggressively
// a purely relative rule flags legitimate founding anchors.
const tightCluster = [
  node({ id: 'ev1', type: 'event', title: 'Model release', startInstant: Date.UTC(2026, 4, 21) }),
  node({ id: 'ev2', type: 'event', title: 'Funding round', startInstant: Date.UTC(2026, 7, 7) }),
]

describe('axis-outlier advisory — absolute floor for tight clusters', () => {
  test('an anchor about a year older than a 78-day cluster does not warn', async () => {
    const graph: Graph = {
      nodes: [
        node({ id: 'tml', type: 'entity', title: 'Thinking Machines Lab', startInstant: Date.UTC(2025, 4, 1) }),
        ...tightCluster,
      ],
      edges: [],
    }
    expect(axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))).toEqual([])
  })

  test('a genuinely distant anchor still warns against the same tight cluster', async () => {
    const graph: Graph = {
      nodes: [
        node({ id: 'old', type: 'entity', title: 'IBM', startInstant: Date.UTC(1995, 0, 1) }),
        ...tightCluster,
      ],
      edges: [],
    }
    const [warning] = axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))
    expect(warning).toContain('"IBM"')
  })

  test('a sub-year active span renders at month precision, not "(2026–2026)"', async () => {
    const graph: Graph = {
      nodes: [
        node({ id: 'old', type: 'entity', title: 'IBM', startInstant: Date.UTC(1995, 0, 1) }),
        ...tightCluster,
      ],
      edges: [],
    }
    const [warning] = axisWarnings(await collectPatchWarnings(graph, [], view({ collapseGaps: false })))
    expect(warning).not.toContain('(2026–2026)')
    expect(warning).toContain('(May 2026–Aug 2026)')
  })
})
