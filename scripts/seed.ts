// Dev-only seed: populates a `demo` timeline so the canvas has nodes to verify
// against without a live AI turn. Run under Node (better-sqlite3 needs the Node
// ABI): `bunx tsx scripts/seed.ts`. Idempotent — re-running resets `demo`.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { timelines, nodes, edges, type NodeMetadata } from '../src/lib/db/schema'
import type { NodeType, Precision } from '../src/lib/domain/types'

const TL = 'demo'
const Y = (y: number, m = 0, d = 1) => {
  const dt = new Date(Date.UTC(2000, m, d))
  dt.setUTCFullYear(y)
  return dt.getTime()
}

db.delete(timelines).where(eq(timelines.id, TL)).run() // cascades nodes/edges/patches
db.insert(timelines).values({ id: TL, title: 'Observability tooling' }).run()

function node(o: {
  type: NodeType
  title: string
  summary?: string
  start: number
  end?: number | null
  precision?: Precision
  metadata?: NodeMetadata
}): string {
  const id = randomUUID()
  db.insert(nodes)
    .values({
      id,
      timelineId: TL,
      type: o.type,
      title: o.title,
      summary: o.summary ?? null,
      startInstant: o.start,
      endInstant: o.end ?? null,
      precision: o.precision ?? 'year',
      metadata: o.metadata ?? null,
    })
    .run()
  return id
}

const era = node({ type: 'period', title: 'Cloud-native era', start: Y(2013), end: Y(2024) })
const newRelic = node({ type: 'entity', title: 'New Relic', start: Y(2008), end: Y(2024), summary: 'APM pioneer.' })
const datadog = node({ type: 'entity', title: 'Datadog', start: Y(2010), end: Y(2024) })
const prometheus = node({
  type: 'event',
  title: 'Prometheus released',
  start: Y(2012),
  summary: 'SoundCloud open-sources Prometheus.',
  metadata: {
    citations: [
      { title: 'Prometheus history', url: 'https://prometheus.io/docs/introduction/overview/', quote: 'Started at SoundCloud in 2012.' },
      { title: 'CNCF graduation', url: 'https://www.cncf.io/projects/prometheus/' },
    ],
  },
})
const grafana = node({ type: 'event', title: 'Grafana founded', start: Y(2014) })
const otel = node({ type: 'event', title: 'OpenTelemetry merger', start: Y(2019), summary: 'OpenTracing + OpenCensus merge.' })
// Three events on the SAME year — exercises lane-collision spreading.
node({ type: 'event', title: 'Loki launched', start: Y(2018) })
node({ type: 'event', title: 'Tempo launched', start: Y(2018) })
node({ type: 'event', title: 'Cortex 1.0', start: Y(2018) })

function edge(sourceId: string, targetId: string, kind: 'caused' | 'succeeded' | 'influenced' | 'acquired' | 'competed_with', label?: string) {
  db.insert(edges).values({ id: randomUUID(), timelineId: TL, sourceId, targetId, kind, label: label ?? null }).run()
}

edge(newRelic, datadog, 'competed_with')
edge(prometheus, otel, 'influenced')
edge(prometheus, grafana, 'influenced')
edge(era, datadog, 'caused', 'enabled')

console.log('Seeded `demo` timeline with', db.select().from(nodes).where(eq(nodes.timelineId, TL)).all().length, 'nodes')
