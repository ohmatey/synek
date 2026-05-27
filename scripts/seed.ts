// Dev-only seed: populates a set of example timelines so the canvas has real
// graphs to verify against without a live AI turn. Run under Node (better-sqlite3
// needs the Node ABI): `bunx tsx scripts/seed.ts`. Idempotent — each timeline has
// a stable id and is reset (delete cascades) before being re-seeded.
//
// Seed one timeline by id: `bunx tsx scripts/seed.ts observability`
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { timelines, nodes, edges, user, type NodeMetadata } from '../src/lib/db/schema'
import type { EdgeKind, NodeType, Precision } from '../src/lib/domain/types'
import { auth } from '../src/lib/auth'
import { seedImageUrl } from './seed-images'

// The demo account that owns the seeded (public) timelines, so the open-canvas
// demo and the URL-based viewer work without login, and logging in as demo shows
// them in the owner list. Overridable via env.
const DEMO_EMAIL = process.env.STRATA_DEMO_EMAIL || 'demo@strata.app'
const DEMO_PASSWORD = process.env.STRATA_DEMO_PASSWORD || 'demo-password-123'
const DEMO_NAME = 'Demo'

// Create the demo user if absent (idempotent) and return its id. Uses Better
// Auth's API so the password is hashed the same way the app expects.
async function ensureDemoUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME } })
  } catch {
    // already exists — fine
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, DEMO_EMAIL)).get()
  if (!row) throw new Error(`Could not create or find the demo user (${DEMO_EMAIL})`)
  return row.id
}

// Year → sortable epoch-ms instant. Handles BCE/ancient years (negative ok).
const Y = (y: number, m = 0, d = 1) => {
  const dt = new Date(Date.UTC(2000, m, d))
  dt.setUTCFullYear(y)
  return dt.getTime()
}

// Images resolve to LOCAL paths under public/seed/ (offline-safe) — run
// `bun run cache:images` to download them. `file` is the Wikimedia Commons
// source name (the canonical list + remote source live in ./seed-images.ts).
const img = (file: string, alt: string): NonNullable<NodeMetadata['images']>[number] => ({
  url: seedImageUrl(file),
  alt,
  show: true,
})

// Per-timeline builder: every node/edge is scoped to `tl`, so the same helper
// names can be reused across timelines without collisions.
function builder(tl: string) {
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
        timelineId: tl,
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

  function edge(sourceId: string, targetId: string, kind: EdgeKind, label?: string) {
    db.insert(edges).values({ id: randomUUID(), timelineId: tl, sourceId, targetId, kind, label: label ?? null }).run()
  }

  return { node, edge }
}

type Seeder = {
  id: string
  title: string
  description: string
  build: (b: ReturnType<typeof builder>) => void
}

const SEEDS: Seeder[] = [
  {
    id: 'observability',
    title: 'Observability tooling',
    description: 'How cloud-native monitoring and tracing evolved.',
    build: ({ node, edge }) => {
      const era = node({
        type: 'period',
        title: 'Cloud-native era',
        start: Y(2013),
        end: Y(2024),
        metadata: { images: [img('Kubernetes logo without workmark.svg', 'Kubernetes logo')] },
      })
      const newRelic = node({
        type: 'entity',
        title: 'New Relic',
        start: Y(2008),
        end: Y(2024),
        summary: 'APM pioneer.',
        metadata: { subtype: 'org', images: [img('New Relic logo.svg', 'New Relic logo')] },
      })
      const datadog = node({
        type: 'entity',
        title: 'Datadog',
        start: Y(2010),
        end: Y(2024),
        metadata: { subtype: 'org', images: [img('Grafana dashboard.png', 'Monitoring dashboard')] },
      })
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
          images: [img('Prometheus software logo.svg', 'Prometheus logo')],
        },
      })
      const grafana = node({
        type: 'event',
        title: 'Grafana founded',
        start: Y(2014),
        metadata: { images: [img('Grafana logo.svg', 'Grafana logo')] },
      })
      const otel = node({
        type: 'event',
        title: 'OpenTelemetry merger',
        start: Y(2019),
        summary: 'OpenTracing + OpenCensus merge.',
        metadata: { images: [img('Opentelemetry-logo.svg', 'OpenTelemetry logo')] },
      })
      // Three events on the SAME year — exercises lane-collision spreading.
      node({ type: 'event', title: 'Loki launched', start: Y(2018), metadata: { images: [img('Grafana logo.svg', 'Grafana Loki')] } })
      node({ type: 'event', title: 'Tempo launched', start: Y(2018), metadata: { images: [img('Grafana logo.svg', 'Grafana Tempo')] } })
      node({ type: 'event', title: 'Cortex 1.0', start: Y(2018), metadata: { images: [img('Cortex Logo.svg', 'Cortex logo')] } })

      edge(newRelic, datadog, 'competed_with')
      edge(prometheus, otel, 'influenced')
      edge(prometheus, grafana, 'influenced')
      edge(era, datadog, 'caused', 'enabled')
    },
  },
  {
    id: 'deep-learning',
    title: 'The rise of deep learning',
    description: 'Key milestones from the AI winter through the transformer era.',
    build: ({ node, edge }) => {
      node({
        type: 'period',
        title: 'Second AI winter',
        start: Y(1987),
        end: Y(1993),
        metadata: { images: [img('Artificial neural network.svg', 'Neural network diagram')] },
      })
      const backprop = node({
        type: 'event',
        title: 'Backpropagation popularized',
        start: Y(1986),
        summary: 'Rumelhart, Hinton & Williams.',
        metadata: { images: [img('Geoffrey Hinton at UBC.jpg', 'Geoffrey Hinton')] },
      })
      const alexnet = node({
        type: 'event',
        title: 'AlexNet wins ImageNet',
        start: Y(2012),
        summary: 'Deep CNN crushes the ImageNet benchmark, kicking off the deep-learning boom.',
        metadata: {
          citations: [{ title: 'ImageNet Classification with Deep CNNs', url: 'https://papers.nips.cc/paper/4824' }],
          images: [img('AlexNet block diagram.svg', 'AlexNet CNN architecture')],
        },
      })
      const seq2seq = node({
        type: 'event',
        title: 'Seq2Seq + attention',
        start: Y(2014),
        metadata: { images: [img('Recurrent neural network unfold.svg', 'Unfolded recurrent neural network')] },
      })
      const transformer = node({
        type: 'event',
        title: '"Attention Is All You Need"',
        start: Y(2017),
        summary: 'The transformer architecture.',
        metadata: {
          citations: [{ title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' }],
          images: [img('Transformer, full architecture.png', 'Transformer architecture diagram')],
        },
      })
      const gpt = node({ type: 'event', title: 'GPT released', start: Y(2018), metadata: { images: [img('OpenAI Logo.svg', 'OpenAI logo')] } })
      const bert = node({ type: 'event', title: 'BERT released', start: Y(2018), metadata: { images: [img('Google 2015 logo.svg', 'Google logo')] } })
      const era = node({
        type: 'period',
        title: 'Foundation-model era',
        start: Y(2018),
        end: Y(2024),
        metadata: { images: [img('ChatGPT logo.svg', 'ChatGPT logo')] },
      })

      edge(backprop, alexnet, 'influenced')
      edge(alexnet, era, 'caused')
      edge(seq2seq, transformer, 'influenced')
      edge(transformer, gpt, 'influenced')
      edge(transformer, bert, 'influenced')
      edge(gpt, bert, 'competed_with')
    },
  },
  {
    id: 'space-race',
    title: 'The Space Race',
    description: 'Cold War spaceflight milestones, 1957–1972.',
    build: ({ node, edge }) => {
      const cold = node({
        type: 'period',
        title: 'Cold War',
        start: Y(1947),
        end: Y(1991),
        metadata: { images: [img('Cold War alliances mid-1975.svg', 'Cold War alliances map')] },
      })
      const sputnik = node({
        type: 'event',
        title: 'Sputnik 1',
        start: Y(1957, 9, 4),
        precision: 'day',
        summary: 'First artificial satellite.',
        metadata: { images: [img('Sputnik asm.jpg', 'Sputnik 1 replica')] },
      })
      const gagarin = node({
        type: 'event',
        title: 'Gagarin orbits Earth',
        start: Y(1961, 3, 12),
        precision: 'day',
        metadata: { images: [img('Yuri Gagarin (1961) - Restoration.jpg', 'Yuri Gagarin')] },
      })
      const apollo = node({
        type: 'period',
        title: 'Apollo program',
        start: Y(1961),
        end: Y(1972),
        metadata: { images: [img('Apollo 11 insignia.png', 'Apollo 11 mission insignia')] },
      })
      const moon = node({
        type: 'event',
        title: 'Apollo 11 Moon landing',
        start: Y(1969, 6, 20),
        precision: 'day',
        summary: 'First crewed lunar landing.',
        metadata: {
          citations: [{ title: 'NASA — Apollo 11', url: 'https://www.nasa.gov/mission/apollo-11/' }],
          images: [img('Aldrin Apollo 11 original.jpg', 'Buzz Aldrin on the Moon')],
        },
      })
      const nasa = node({
        type: 'entity',
        title: 'NASA',
        start: Y(1958),
        end: Y(2024),
        metadata: { subtype: 'org', images: [img('NASA logo.svg', 'NASA logo')] },
      })

      edge(cold, sputnik, 'caused')
      edge(sputnik, gagarin, 'succeeded', 'escalation')
      edge(gagarin, apollo, 'influenced')
      edge(apollo, moon, 'caused')
      edge(nasa, moon, 'caused')
    },
  },
  {
    id: 'roman-republic',
    title: 'Fall of the Roman Republic',
    description: 'Exercises BCE/ancient fuzzy dates.',
    build: ({ node, edge }) => {
      const republic = node({
        type: 'period',
        title: 'Roman Republic',
        start: Y(-509),
        end: Y(-27),
        metadata: { images: [img('Maccari-Cicero.jpg', 'Cicero denounces Catiline in the Senate')] },
      })
      const caesar = node({
        type: 'entity',
        title: 'Julius Caesar',
        start: Y(-100),
        end: Y(-44),
        metadata: { subtype: 'person', images: [img('Gaius Iulius Caesar (Vatican Museum).jpg', 'Bust of Julius Caesar')] },
      })
      const rubicon = node({
        type: 'event',
        title: 'Caesar crosses the Rubicon',
        start: Y(-49),
        summary: 'Civil war begins.',
        metadata: { images: [img('Gaius Iulius Caesar (Vatican Museum).jpg', 'Julius Caesar')] },
      })
      const ides = node({
        type: 'event',
        title: 'Assassination of Caesar',
        start: Y(-44, 2, 15),
        precision: 'day',
        metadata: { images: [img('Vincenzo Camuccini - La morte di Cesare.jpg', 'The Death of Caesar (Camuccini)')] },
      })
      const empire = node({
        type: 'event',
        title: 'Augustus becomes emperor',
        start: Y(-27),
        summary: 'The Republic becomes the Empire.',
        metadata: { images: [img('Statue-Augustus.jpg', 'Augustus of Prima Porta')] },
      })

      edge(republic, rubicon, 'caused')
      edge(rubicon, ides, 'caused')
      edge(ides, empire, 'caused')
      edge(caesar, rubicon, 'caused')
    },
  },
  {
    // Image-dense fixture: historical figures (entity nodes) each with a
    // portrait — the primary canvas to develop person/entity cards against,
    // and the visual anchor for the e2e canvas spec.
    id: 'figures',
    title: 'Figures of science',
    description: 'Portrait-rich entities for developing visual entity cards.',
    build: ({ node, edge }) => {
      const leonardo = node({
        type: 'entity',
        title: 'Leonardo da Vinci',
        start: Y(1452),
        end: Y(1519),
        summary: 'Polymath of the High Renaissance.',
        metadata: { subtype: 'person', images: [img('Francesco Melzi - Portrait of Leonardo - WGA14795.jpg', 'Portrait of Leonardo da Vinci')] },
      })
      const newton = node({
        type: 'entity',
        title: 'Isaac Newton',
        start: Y(1643),
        end: Y(1727),
        summary: 'Laws of motion and universal gravitation.',
        metadata: { subtype: 'person', images: [img('GodfreyKneller-IsaacNewton-1689.jpg', 'Portrait of Isaac Newton')] },
      })
      const darwin = node({
        type: 'entity',
        title: 'Charles Darwin',
        start: Y(1809),
        end: Y(1882),
        summary: 'Theory of evolution by natural selection.',
        metadata: { subtype: 'person', images: [img('Charles Darwin seated crop.jpg', 'Photograph of Charles Darwin')] },
      })
      const lovelace = node({
        type: 'entity',
        title: 'Ada Lovelace',
        start: Y(1815),
        end: Y(1852),
        summary: 'First algorithm intended for a machine.',
        metadata: { subtype: 'person', images: [img('Ada Lovelace portrait.jpg', 'Portrait of Ada Lovelace')] },
      })
      const curie = node({
        type: 'entity',
        title: 'Marie Curie',
        start: Y(1867),
        end: Y(1934),
        summary: 'Pioneer of radioactivity; two Nobel Prizes.',
        metadata: { subtype: 'person', images: [img('Marie Curie c. 1920s.jpg', 'Photograph of Marie Curie')] },
      })
      const einstein = node({
        type: 'entity',
        title: 'Albert Einstein',
        start: Y(1879),
        end: Y(1955),
        summary: 'Relativity; reshaped modern physics.',
        metadata: { subtype: 'person', images: [img('Einstein 1921 by F Schmutzer - restoration.jpg', 'Photograph of Albert Einstein')] },
      })

      edge(newton, darwin, 'influenced')
      edge(newton, einstein, 'influenced')
      edge(lovelace, curie, 'succeeded')
    },
  },
]

function seed(s: Seeder, ownerId: string) {
  db.delete(timelines).where(eq(timelines.id, s.id)).run() // cascades nodes/edges/patches
  // Owned by the demo account and public, so the seeded timelines are viewable by
  // URL without login (and appear in demo's list when signed in).
  db.insert(timelines).values({ id: s.id, title: s.title, description: s.description, ownerId, isPublic: true }).run()
  s.build(builder(s.id))
  const count = db.select().from(nodes).where(eq(nodes.timelineId, s.id)).all().length
  console.log(`  ✓ ${s.id.padEnd(16)} "${s.title}" — ${count} nodes`)
}

async function main() {
  const only = process.argv[2]
  const targets = only ? SEEDS.filter((s) => s.id === only) : SEEDS

  if (only && targets.length === 0) {
    console.error(`No seed with id "${only}". Available: ${SEEDS.map((s) => s.id).join(', ')}`)
    process.exit(1)
  }

  const ownerId = await ensureDemoUser()
  console.log(`Demo user: ${DEMO_EMAIL}`)
  console.log(`Seeding ${targets.length} timeline(s):`)
  for (const s of targets) seed(s, ownerId)
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
