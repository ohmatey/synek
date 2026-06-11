import { test, expect } from '@playwright/test'

// One pass per seeded timeline (scripts/seed.ts): asserts the whole graph
// renders — exact node count, the per-type cards (period / event / org / person),
// citation badges, edge count, and that every seed image resolves to its Wikimedia
// Commons URL (the seed renders remote, no local download — see seed-images.ts).
// Counts mirror the seed exactly, so a drift in either side fails.
type Expected = {
  id: string
  title: string
  nodeCount: number
  edgeCount: number
  periodEdges: number // edges touching a period node — hidden until an endpoint is selected
  periods: number
  events: number
  orgs: number // org entities → .sf-entity-org (each with a .sf-logo)
  persons: number // person entities → .sf-person (each with a portrait)
  cites: number // nodes carrying a citation badge → .sf-cite
  sample: string[] // representative node titles that must be visible
}

const TIMELINES: Expected[] = [
  {
    id: 'observability',
    title: 'Observability tooling',
    nodeCount: 9,
    edgeCount: 4,
    periodEdges: 1,
    periods: 1,
    events: 6,
    orgs: 2,
    persons: 0,
    cites: 1,
    sample: ['Cloud-native era', 'New Relic', 'Datadog', 'Prometheus released', 'Loki launched', 'Tempo launched', 'Cortex 1.0'],
  },
  {
    id: 'deep-learning',
    title: 'The rise of deep learning',
    nodeCount: 8,
    edgeCount: 6,
    periodEdges: 1,
    periods: 2,
    events: 6,
    orgs: 0,
    persons: 0,
    cites: 2,
    sample: ['Second AI winter', 'Foundation-model era', 'AlexNet wins ImageNet', 'Attention Is All You Need', 'GPT released', 'BERT released'],
  },
  {
    id: 'space-race',
    title: 'The Space Race',
    nodeCount: 6,
    edgeCount: 5,
    periodEdges: 3,
    periods: 2,
    events: 3,
    orgs: 1,
    persons: 0,
    cites: 1,
    sample: ['Cold War', 'Apollo program', 'Sputnik 1', 'Gagarin orbits Earth', 'Apollo 11 Moon landing', 'NASA'],
  },
  {
    id: 'roman-republic',
    title: 'Fall of the Roman Republic',
    nodeCount: 5,
    edgeCount: 4,
    periodEdges: 1,
    periods: 1,
    events: 3,
    orgs: 0,
    persons: 1,
    cites: 0,
    sample: ['Roman Republic', 'Julius Caesar', 'Caesar crosses the Rubicon', 'Assassination of Caesar', 'Augustus becomes emperor'],
  },
  {
    id: 'figures',
    title: 'Figures of science',
    nodeCount: 6,
    edgeCount: 3,
    periodEdges: 0,
    periods: 0,
    events: 0,
    orgs: 0,
    persons: 6,
    cites: 0,
    sample: ['Leonardo da Vinci', 'Isaac Newton', 'Charles Darwin', 'Ada Lovelace', 'Marie Curie', 'Albert Einstein'],
  },
]

for (const tl of TIMELINES) {
  test(`seed: ${tl.id} renders its full graph`, async ({ page }) => {
    await page.goto(`/timelines/${tl.id}`)

    // Title (scoped to the app bar — the switcher menu also lists titles).
    await expect(page.getByTestId('timeline-name')).toHaveText(tl.title)

    // Every seed node renders (React Flow keeps off-screen nodes in the DOM).
    await expect(page.locator('.react-flow__node')).toHaveCount(tl.nodeCount)

    // Per-type cards match the seed exactly.
    await expect(page.locator('.sf-period')).toHaveCount(tl.periods)
    await expect(page.locator('.sf-event')).toHaveCount(tl.events)
    await expect(page.locator('.sf-entity-org')).toHaveCount(tl.orgs)
    await expect(page.locator('.sf-person')).toHaveCount(tl.persons)

    // Citation badges. Edges touching a period node are hidden by default, so
    // only the non-period edges render until a node is selected.
    await expect(page.locator('.sf-cite')).toHaveCount(tl.cites)
    await expect(page.locator('.react-flow__edge')).toHaveCount(tl.edgeCount - tl.periodEdges)

    // Org logos / person portraits are present where expected.
    await expect(page.locator('.sf-logo')).toHaveCount(tl.orgs)
    await expect(page.locator('.sf-person-portrait')).toHaveCount(tl.persons)

    // Every node carries exactly one seed image, all resolving to a Wikimedia
    // Commons URL (the seed renders remote — see scripts/seed-images.ts).
    await expect(page.locator('img[src*="commons.wikimedia.org"]')).toHaveCount(tl.nodeCount)

    // Representative nodes are visible.
    for (const title of tl.sample) {
      await expect(page.getByText(title, { exact: false }).first()).toBeVisible()
    }
  })
}
