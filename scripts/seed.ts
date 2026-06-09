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
const DEMO_EMAIL = process.env.SYNEK_DEMO_EMAIL || 'demo@synek.app'
const DEMO_PASSWORD = process.env.SYNEK_DEMO_PASSWORD || 'demo-password-123'
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
    // The flagship seed and the NOW.0 de-risking experiment: the hero use case
    // ("visualize Stoicism while I use Claude") rendered as real content, so the
    // canvas is never a cold blank box. Portrait-rich (faces not boxes), BCE
    // dates, and a legible succession/influence story from Zeno to Marcus.
    id: 'stoicism',
    title: 'Stoicism',
    description: 'The Stoic tradition from the Painted Porch to the Roman emperors — Zeno to Marcus Aurelius.',
    build: ({ node, edge }) => {
      // --- The three Stoa eras (period bands) ---
      const earlyStoa = node({
        type: 'period',
        title: 'Early Stoa',
        summary: 'The founding generations in Athens — Zeno, Cleanthes, Chrysippus.',
        start: Y(-301),
        end: Y(-150),
      })
      const middleStoa = node({
        type: 'period',
        title: 'Middle Stoa',
        summary: 'Stoicism opens to other schools and reaches Rome.',
        start: Y(-150),
        end: Y(-30),
      })
      const romanStoa = node({
        type: 'period',
        title: 'Roman (Late) Stoa',
        summary: 'The imperial age — a slave, a statesman, and an emperor.',
        start: Y(-30),
        end: Y(180),
      })

      // --- Where it began ---
      const porch = node({
        type: 'entity',
        title: 'The Stoa Poikile',
        summary: 'The "Painted Porch" in the Athenian Agora where Zeno taught — the school takes its name from it.',
        start: Y(-301),
        end: Y(-150),
        metadata: {
          subtype: 'place',
          images: [img('Attica 06-13 Athens 22 View from Acropolis Hill - Museum of Ancient Agora.jpg', 'A reconstructed stoa in the Athenian Agora')],
        },
      })

      // --- The people (entity / person → portrait cards) ---
      const crates = node({
        type: 'entity',
        title: 'Crates of Thebes',
        summary: 'The Cynic philosopher whose teaching shaped the young Zeno.',
        start: Y(-365),
        end: Y(-285),
        metadata: { subtype: 'person', images: [img('Crates of Thebes Villa Farnesina.jpg', 'Crates of Thebes')] },
      })
      const zeno = node({
        type: 'entity',
        title: 'Zeno of Citium',
        summary: 'Founder of Stoicism.',
        start: Y(-334),
        end: Y(-262),
        metadata: { subtype: 'person', images: [img('Paolo Monti - Servizio fotografico (Napoli, 1969) - BEIC 6353768.jpg', 'Bust of Zeno of Citium, Naples')] },
      })
      const cleanthes = node({
        type: 'entity',
        title: 'Cleanthes',
        summary: 'Second head of the Stoa; author of the Hymn to Zeus.',
        start: Y(-330),
        end: Y(-230),
        metadata: { subtype: 'person', images: [img('Cleanthes from L. Annaei Senecae philosophi Opera, 1605, title page detail.png', 'Engraved portrait of Cleanthes')] },
      })
      const chrysippus = node({
        type: 'entity',
        title: 'Chrysippus',
        summary: 'Third head of the Stoa and its great systematizer.',
        start: Y(-279),
        end: Y(-206),
        metadata: {
          subtype: 'person',
          citations: [{ title: 'Diogenes Laërtius, Lives 7.183', url: 'https://en.wikipedia.org/wiki/Chrysippus', quote: 'If Chrysippus had not existed, neither would the Stoa.' }],
          images: [img('Chrysippos BM 1846.jpg', 'Bust of Chrysippus, British Museum')],
        },
      })
      const panaetius = node({
        type: 'entity',
        title: 'Panaetius',
        summary: 'Head of the Stoa who carried it into the Roman world.',
        start: Y(-185),
        end: Y(-110),
        metadata: { subtype: 'person', images: [img('Panaetius Nuremberg Chronicle.jpg', 'Woodcut of Panaetius')] },
      })
      const posidonius = node({
        type: 'entity',
        title: 'Posidonius',
        summary: 'Polymath of the Middle Stoa — philosophy, science, history.',
        start: Y(-135),
        end: Y(-51),
        metadata: { subtype: 'person', images: [img('Posidonio, replica augustea (23 ac.-14 dc ca) da originale del 100-50 ac. ca. 6142.JPG', 'Bust of Posidonius, Naples')] },
      })
      const seneca = node({
        type: 'entity',
        title: 'Seneca the Younger',
        summary: 'Statesman, dramatist, and Stoic letter-writer.',
        start: Y(-4),
        end: Y(65),
        metadata: { subtype: 'person', images: [img('Duble herma of Socrates and Seneca Antikensammlung Berlin 07.jpg', 'Double herm of Socrates and Seneca, Berlin')] },
      })
      const epictetus = node({
        type: 'entity',
        title: 'Epictetus',
        summary: 'Born a slave; taught that freedom lies in what is up to us.',
        start: Y(50),
        end: Y(135),
        metadata: { subtype: 'person', images: [img('Epicteti Enchiridion Latinis versibus adumbratum (Oxford 1715) frontispiece (cropped).jpg', 'Frontispiece portrait of Epictetus')] },
      })
      const marcus = node({
        type: 'entity',
        title: 'Marcus Aurelius',
        summary: 'Roman emperor and the last great Stoic.',
        start: Y(121),
        end: Y(180),
        metadata: { subtype: 'person', images: [img('MSR-ra-61-b-1-DM.jpg', 'Bust of Marcus Aurelius')] },
      })

      // --- The turning-point events ---
      const founding = node({
        type: 'event',
        title: 'Zeno founds the Stoa',
        summary: 'Zeno begins teaching at the Stoa Poikile in Athens (c. 301 BCE).',
        start: Y(-301),
        metadata: {
          citations: [{ title: 'Stoicism — Stanford Encyclopedia of Philosophy', url: 'https://plato.stanford.edu/entries/stoicism/' }],
        },
      })
      const systematized = node({
        type: 'event',
        title: 'Chrysippus systematizes the Stoa',
        summary: 'Stoic logic, physics, and ethics welded into one coherent system.',
        start: Y(-232),
      })
      const toRome = node({
        type: 'event',
        title: 'Stoicism reaches Rome',
        summary: 'Panaetius and the Scipionic Circle bring Stoicism to the Roman elite.',
        start: Y(-140),
      })

      // --- The surviving texts (entity / work) ---
      const letters = node({
        type: 'entity',
        title: 'Letters to Lucilius',
        summary: "Seneca's moral letters — Stoic practice in everyday life.",
        start: Y(64),
        metadata: { subtype: 'work' },
      })
      const discourses = node({
        type: 'entity',
        title: 'Discourses & Enchiridion',
        summary: "Epictetus' teaching, recorded by his student Arrian.",
        start: Y(108),
        metadata: {
          subtype: 'work',
          citations: [{ title: 'Discourses of Epictetus', url: 'https://en.wikipedia.org/wiki/Discourses_of_Epictetus' }],
          images: [img('The Discourses of Epictetus - Elizabeth Carter - 1759 - page 1.jpg', 'Title page of the Discourses (Carter, 1759)')],
        },
      })
      const meditations = node({
        type: 'entity',
        title: 'Meditations',
        summary: 'The private notebook of an emperor, written on campaign.',
        start: Y(175),
        metadata: {
          subtype: 'work',
          citations: [{ title: 'Meditations', url: 'https://en.wikipedia.org/wiki/Meditations' }],
          images: [img('Marcus Aurelius. De seipso, seu vita sua (Xylander, 1558).jpg', 'Title page of Meditations (Xylander, 1558)')],
        },
      })

      // --- The story: lineage, influence, and authorship ---
      edge(crates, zeno, 'influenced', 'Cynic teacher')
      edge(zeno, founding, 'caused')
      edge(founding, earlyStoa, 'caused')
      edge(zeno, cleanthes, 'succeeded', '2nd head')
      edge(cleanthes, chrysippus, 'succeeded', '3rd head')
      edge(chrysippus, systematized, 'caused')
      edge(chrysippus, panaetius, 'influenced')
      edge(panaetius, toRome, 'caused')
      edge(panaetius, posidonius, 'influenced', 'taught')
      edge(posidonius, seneca, 'influenced')
      edge(seneca, letters, 'caused', 'wrote')
      edge(epictetus, discourses, 'caused', 'recorded by Arrian')
      edge(epictetus, marcus, 'influenced', 'shaped the Meditations')
      edge(marcus, meditations, 'caused', 'wrote')
    },
  },
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
