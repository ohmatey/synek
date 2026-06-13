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
import type { EdgeKind, ImageAspect, NodeType, Precision, StoryImage, StoryImageLayout } from '../src/lib/domain/types'
import { auth } from '../src/lib/auth'
import { writeStory, type NewStory, type NewStorySegment } from '../src/lib/db/stories'
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

// Images render directly from their public Wikimedia Commons URL (no download).
// `file` is the Commons source name; `seedImageUrl` resolves it to a remote URL
// (the canonical list lives in ./seed-images.ts; `bun run cache:images` can still
// mirror them locally for an offline setup).
// `aspect` frames the image on the card: 'portrait' for tall subjects (busts,
// headshots, standing statues, book title pages) and 'landscape' for wide ones
// (scenes, logos, diagrams, maps). Omit → landscape (the default).
const img = (
  file: string,
  alt: string,
  aspect?: ImageAspect,
): NonNullable<NodeMetadata['images']>[number] => ({
  url: seedImageUrl(file),
  alt,
  show: true,
  ...(aspect ? { aspect } : {}),
})

// Story cover / beat image (`StoryImage` shape — no `show`, adds `layout`; layout is
// ignored on a cover). Same remote-Commons sourcing as `img`.
const storyImg = (
  file: string,
  alt: string,
  opts?: { aspect?: ImageAspect; layout?: StoryImageLayout },
): StoryImage => ({
  url: seedImageUrl(file),
  alt,
  ...(opts?.aspect ? { aspect: opts.aspect } : {}),
  ...(opts?.layout ? { layout: opts.layout } : {}),
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

  // Attach a story to a moment (node). Mirrors what an MCP client does via the
  // write_story tool — stories are separate from the graph Patch stack — so the
  // seeded canvas has a real tap-through story to play (and tests to view).
  function story(momentId: string, meta: NewStory, beats: NewStorySegment[]) {
    writeStory(momentId, meta, beats)
  }

  return { node, edge, story }
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
    build: ({ node, edge, story }) => {
      // --- The three Stoa eras (period bands) ---
      const earlyStoa = node({
        type: 'period',
        title: 'Early Stoa',
        summary: 'The founding generations in Athens — Zeno, Cleanthes, Chrysippus.',
        start: Y(-301),
        end: Y(-150),
        metadata: { location: 'Athens', lat: 37.9755, lng: 23.722 },
      })
      const middleStoa = node({
        type: 'period',
        title: 'Middle Stoa',
        summary: 'Stoicism opens to other schools and reaches Rome.',
        start: Y(-150),
        end: Y(-30),
        metadata: { location: 'Rhodes', lat: 36.43, lng: 28.22 },
      })
      const romanStoa = node({
        type: 'period',
        title: 'Roman (Late) Stoa',
        summary: 'The imperial age — a slave, a statesman, and an emperor.',
        start: Y(-30),
        end: Y(180),
        metadata: { location: 'Rome', lat: 41.89, lng: 12.49 },
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
          location: 'Athenian Agora, Athens',
          lat: 37.9755,
          lng: 23.722,
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
        metadata: { subtype: 'person', location: 'Thebes, Greece', lat: 38.32, lng: 23.32, images: [img('Crates of Thebes Villa Farnesina.jpg', 'Crates of Thebes', 'portrait')] },
      })
      const zeno = node({
        type: 'entity',
        title: 'Zeno of Citium',
        summary: 'Founder of Stoicism.',
        start: Y(-334),
        end: Y(-262),
        metadata: { subtype: 'person', location: 'Citium, Cyprus', lat: 34.92, lng: 33.63, images: [img('Paolo Monti - Servizio fotografico (Napoli, 1969) - BEIC 6353768.jpg', 'Bust of Zeno of Citium, Naples', 'portrait')] },
      })
      const cleanthes = node({
        type: 'entity',
        title: 'Cleanthes',
        summary: 'Second head of the Stoa; author of the Hymn to Zeus.',
        start: Y(-330),
        end: Y(-230),
        metadata: { subtype: 'person', location: 'Assos, Anatolia', lat: 39.49, lng: 26.34, images: [img('Cleanthes from L. Annaei Senecae philosophi Opera, 1605, title page detail.png', 'Engraved portrait of Cleanthes', 'portrait')] },
      })
      const chrysippus = node({
        type: 'entity',
        title: 'Chrysippus',
        summary: 'Third head of the Stoa and its great systematizer.',
        start: Y(-279),
        end: Y(-206),
        metadata: {
          subtype: 'person',
          location: 'Soli, Cilicia',
          lat: 36.75,
          lng: 34.55,
          citations: [{ title: 'Diogenes Laërtius, Lives 7.183', url: 'https://en.wikipedia.org/wiki/Chrysippus', quote: 'If Chrysippus had not existed, neither would the Stoa.' }],
          images: [img('Chrysippos BM 1846.jpg', 'Bust of Chrysippus, British Museum', 'portrait')],
        },
      })
      const panaetius = node({
        type: 'entity',
        title: 'Panaetius',
        summary: 'Head of the Stoa who carried it into the Roman world.',
        start: Y(-185),
        end: Y(-110),
        metadata: { subtype: 'person', location: 'Rhodes', lat: 36.43, lng: 28.22, images: [img('Panaetius Nuremberg Chronicle.jpg', 'Woodcut of Panaetius', 'portrait')] },
      })
      const posidonius = node({
        type: 'entity',
        title: 'Posidonius',
        summary: 'Polymath of the Middle Stoa — philosophy, science, history.',
        start: Y(-135),
        end: Y(-51),
        metadata: { subtype: 'person', location: 'Apamea, Syria', lat: 35.42, lng: 36.40, images: [img('Posidonio, replica augustea (23 ac.-14 dc ca) da originale del 100-50 ac. ca. 6142.JPG', 'Bust of Posidonius, Naples', 'portrait')] },
      })
      const seneca = node({
        type: 'entity',
        title: 'Seneca the Younger',
        summary: 'Statesman, dramatist, and Stoic letter-writer.',
        start: Y(-4),
        end: Y(65),
        metadata: { subtype: 'person', location: 'Córdoba, Hispania', lat: 37.88, lng: -4.78, images: [img('Duble herma of Socrates and Seneca Antikensammlung Berlin 07.jpg', 'Double herm of Socrates and Seneca, Berlin', 'portrait')] },
      })
      const epictetus = node({
        type: 'entity',
        title: 'Epictetus',
        summary: 'Born a slave; taught that freedom lies in what is up to us.',
        start: Y(50),
        end: Y(135),
        metadata: { subtype: 'person', location: 'Hierapolis, Phrygia', lat: 37.92, lng: 29.13, images: [img('Epicteti Enchiridion Latinis versibus adumbratum (Oxford 1715) frontispiece (cropped).jpg', 'Frontispiece portrait of Epictetus', 'portrait')] },
      })
      const marcus = node({
        type: 'entity',
        title: 'Marcus Aurelius',
        summary: 'Roman emperor and the last great Stoic.',
        start: Y(121),
        end: Y(180),
        metadata: { subtype: 'person', location: 'Rome', lat: 41.89, lng: 12.49, images: [img('MSR-ra-61-b-1-DM.jpg', 'Bust of Marcus Aurelius', 'portrait')] },
      })

      // --- The turning-point events ---
      const founding = node({
        type: 'event',
        title: 'Zeno founds the Stoa',
        summary: 'Zeno begins teaching at the Stoa Poikile in Athens (c. 301 BCE).',
        start: Y(-301),
        metadata: {
          location: 'Athens',
          lat: 37.9755,
          lng: 23.722,
          citations: [{ title: 'Stoicism — Stanford Encyclopedia of Philosophy', url: 'https://plato.stanford.edu/entries/stoicism/' }],
        },
      })
      const systematized = node({
        type: 'event',
        title: 'Chrysippus systematizes the Stoa',
        summary: 'Stoic logic, physics, and ethics welded into one coherent system.',
        start: Y(-232),
        metadata: { location: 'Athens', lat: 37.9755, lng: 23.722 },
      })
      const toRome = node({
        type: 'event',
        title: 'Stoicism reaches Rome',
        summary: 'Panaetius and the Scipionic Circle bring Stoicism to the Roman elite.',
        start: Y(-140),
        metadata: { location: 'Rome', lat: 41.89, lng: 12.49 },
      })

      // --- The surviving texts (entity / work) ---
      const letters = node({
        type: 'entity',
        title: 'Letters to Lucilius',
        summary: "Seneca's moral letters — Stoic practice in everyday life.",
        start: Y(64),
        metadata: { subtype: 'work', location: 'Rome', lat: 41.89, lng: 12.49 },
      })
      const discourses = node({
        type: 'entity',
        title: 'Discourses & Enchiridion',
        summary: "Epictetus' teaching, recorded by his student Arrian.",
        start: Y(108),
        metadata: {
          subtype: 'work',
          location: 'Nicopolis, Epirus',
          lat: 39.0,
          lng: 20.73,
          citations: [{ title: 'Discourses of Epictetus', url: 'https://en.wikipedia.org/wiki/Discourses_of_Epictetus' }],
          images: [img('The Discourses of Epictetus - Elizabeth Carter - 1759 - page 1.jpg', 'Title page of the Discourses (Carter, 1759)', 'portrait')],
        },
      })
      const meditations = node({
        type: 'entity',
        title: 'Meditations',
        summary: 'The private notebook of an emperor, written on campaign.',
        start: Y(175),
        metadata: {
          subtype: 'work',
          location: 'Carnuntum, Danube frontier',
          lat: 48.11,
          lng: 16.85,
          citations: [{ title: 'Meditations', url: 'https://en.wikipedia.org/wiki/Meditations' }],
          images: [img('Marcus Aurelius. De seipso, seu vita sua (Xylander, 1558).jpg', 'Title page of Meditations (Xylander, 1558)', 'portrait')],
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

      // A cross-globe story: the Stoa's journey across the ancient Mediterranean.
      // Each beat focuses a node in a different place, so playing it on the globe
      // sweeps Cyprus → Anatolia → Cilicia → Syria → Iberia → Rome (GS1).
      story(
        zeno,
        {
          title: 'From a shipwreck to the throne',
          hook: 'How a Cypriot merchant’s lost cargo became an emperor’s creed.',
          depthTier: 'deep',
          estimatedMinutes: 4,
          coverImage: storyImg(
            'Attica 06-13 Athens 22 View from Acropolis Hill - Museum of Ancient Agora.jpg',
            'The Athenian Agora, where the Stoa stood',
          ),
        },
        [
          {
            bodyText:
              'Zeno of Citium was a merchant until the sea took everything — a cargo of Phoenician purple lost in a wreck near Athens. Stranded, he wandered into a bookshop, read of Socrates, asked where such men were found, and never went home.',
            kind: 'narration',
            settingNote: 'A bookshop off the Athenian Agora, c. 312 BCE',
            focusNodeId: zeno,
          },
          {
            bodyText:
              'His successor Cleanthes was a water-carrier who hauled buckets by night to pay for study by day. From Assos on the Anatolian coast he came to Athens and kept the school alive on stubbornness and a Hymn to Zeus.',
            kind: 'narration',
            focusNodeId: cleanthes,
          },
          {
            bodyText:
              'Then came Chrysippus of Soli in Cilicia, a long-distance runner turned logician, who welded Stoic logic, physics, and ethics into a single system. “If Chrysippus had not existed,” they said, “neither would the Stoa.”',
            kind: 'narration',
            focusNodeId: chrysippus,
          },
          {
            bodyText:
              'From Syria came Posidonius, who settled on Rhodes and measured the world — tides, the sun, the size of the Earth — arguing one reason ran through all of it. A young Roman named Cicero crossed the sea to hear him.',
            kind: 'narration',
            focusNodeId: posidonius,
          },
          {
            bodyText:
              'The school reached Rome through men like Seneca, born in Córdoba in Hispania, who tutored an emperor, grew immensely rich, and wrote letters on how to live and die well — then was ordered by Nero to do exactly the latter.',
            kind: 'narration',
            focusNodeId: seneca,
          },
          {
            bodyText:
              'It ended on a frozen frontier. Marcus Aurelius, master of the known world, wrote private notes to himself by lamplight on the Danube — reminders to be just, to expect ingratitude, to remember he would die. We call them the Meditations.',
            kind: 'narration',
            focusNodeId: marcus,
          },
        ],
      )
    },
  },
  {
    id: 'observability',
    title: 'Observability tooling',
    description: 'How cloud-native monitoring and tracing evolved — and where it was built.',
    build: ({ node, edge, story }) => {
      const era = node({
        type: 'period',
        title: 'Cloud-native era',
        start: Y(2013),
        end: Y(2024),
        // A worldwide shift, not a single place.
        metadata: { geoScope: 'global', images: [img('Kubernetes logo without workmark.svg', 'Kubernetes logo')] },
      })
      const dapper = node({
        type: 'event',
        title: 'Google publishes Dapper',
        start: Y(2010),
        summary: 'The paper that defined distributed tracing.',
        metadata: {
          location: 'Google, Mountain View, USA',
          lat: 37.39,
          lng: -122.08,
          citations: [{ title: 'Dapper, a Large-Scale Distributed Systems Tracing Infrastructure', url: 'https://research.google/pubs/pub36356/' }],
          images: [img('Google 2015 logo.svg', 'Google logo')],
        },
      })
      const newRelic = node({
        type: 'entity',
        title: 'New Relic',
        start: Y(2008),
        end: Y(2024),
        summary: 'APM pioneer.',
        metadata: { subtype: 'org', location: 'San Francisco, USA', lat: 37.77, lng: -122.42, images: [img('New Relic logo.svg', 'New Relic logo')] },
      })
      const datadog = node({
        type: 'entity',
        title: 'Datadog',
        start: Y(2010),
        end: Y(2024),
        metadata: { subtype: 'org', location: 'New York, USA', lat: 40.71, lng: -74.01, images: [img('Grafana dashboard.png', 'Monitoring dashboard')] },
      })
      const prometheus = node({
        type: 'event',
        title: 'Prometheus released',
        start: Y(2012),
        summary: 'SoundCloud open-sources Prometheus.',
        metadata: {
          location: 'Berlin, Germany (SoundCloud)',
          lat: 52.52,
          lng: 13.4,
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
        metadata: { location: 'Stockholm, Sweden', lat: 59.33, lng: 18.06, images: [img('Grafana logo.svg', 'Grafana logo')] },
      })
      const otel = node({
        type: 'event',
        title: 'OpenTelemetry merger',
        start: Y(2019),
        summary: 'OpenTracing + OpenCensus merge into one open standard.',
        // A distributed open standard with no single home.
        metadata: { geoScope: 'global', images: [img('Opentelemetry-logo.svg', 'OpenTelemetry logo')] },
      })
      // Three events on the SAME year — exercises lane-collision spreading. All
      // Grafana-stack projects, so they pin to Stockholm.
      node({ type: 'event', title: 'Loki launched', start: Y(2018), metadata: { location: 'Stockholm, Sweden', lat: 59.33, lng: 18.06, images: [img('Grafana logo.svg', 'Grafana Loki')] } })
      node({ type: 'event', title: 'Tempo launched', start: Y(2018), metadata: { location: 'Stockholm, Sweden', lat: 59.33, lng: 18.06, images: [img('Grafana logo.svg', 'Grafana Tempo')] } })
      node({ type: 'event', title: 'Cortex 1.0', start: Y(2018), metadata: { location: 'Stockholm, Sweden', lat: 59.33, lng: 18.06, images: [img('Cortex Logo.svg', 'Cortex logo')] } })

      edge(dapper, otel, 'influenced', 'tracing lineage')
      edge(newRelic, datadog, 'competed_with')
      edge(prometheus, otel, 'influenced')
      edge(prometheus, grafana, 'influenced')
      edge(era, datadog, 'caused', 'enabled')

      // Cross-globe story: where observability was actually built — Mountain View →
      // New York/San Francisco → Berlin → Stockholm, ending on the placeless open
      // standard (an off-map beat that exercises GS1's hold-camera path).
      story(
        dapper,
        {
          title: 'Seeing inside the machine',
          hook: 'Distributed tracing went from a Google paper to a global standard — passing through four cities on the way.',
          depthTier: 'deep',
          estimatedMinutes: 3,
          coverImage: storyImg('Grafana dashboard.png', 'A monitoring dashboard'),
        },
        [
          {
            bodyText:
              'In 2010 a team at Google published Dapper: how to follow one request as it fans out across thousands of machines. It named the problem the whole industry would spend a decade solving — how do you see inside a system too big to hold in your head?',
            kind: 'narration',
            settingNote: 'Mountain View, California',
            focusNodeId: dapper,
          },
          {
            bodyText:
              'The first answers were commercial. New Relic in San Francisco and Datadog in New York turned application monitoring into a business — dashboards you rented, agents you installed, a bill that grew with your traffic.',
            kind: 'narration',
            focusNodeId: newRelic,
          },
          {
            bodyText:
              'Then SoundCloud, a music-streaming startup in Berlin, open-sourced Prometheus: metrics you owned, scraped from your own services. It became the default heartbeat of the cloud-native world.',
            kind: 'narration',
            focusNodeId: prometheus,
          },
          {
            bodyText:
              'In Stockholm, Grafana turned all those numbers into something you could see — one pane of glass over metrics, logs, and traces, whoever produced them. Loki and Tempo followed, the same year, the same building.',
            kind: 'narration',
            focusNodeId: grafana,
          },
          {
            bodyText:
              'The last step had no address. OpenTelemetry merged the rival tracing standards into one open specification — vendor-neutral, owned by everyone and no one. The thing that watches the whole world stopped belonging to any single place.',
            kind: 'narration',
            focusNodeId: otel,
          },
        ],
      )
    },
  },
  {
    id: 'deep-learning',
    title: 'The rise of deep learning',
    description: 'Key milestones from the AI winter through the transformer era — and where they happened.',
    build: ({ node, edge, story }) => {
      const winter = node({
        type: 'period',
        title: 'Second AI winter',
        start: Y(1987),
        end: Y(1993),
        // Funding froze across labs worldwide — no single place.
        metadata: { geoScope: 'diffuse', images: [img('Artificial neural network.svg', 'Neural network diagram')] },
      })
      const backprop = node({
        type: 'event',
        title: 'Backpropagation popularized',
        start: Y(1986),
        summary: 'Rumelhart, Hinton & Williams.',
        metadata: { location: 'Toronto, Canada', lat: 43.66, lng: -79.4, images: [img('Geoffrey Hinton at UBC.jpg', 'Geoffrey Hinton', 'portrait')] },
      })
      const alexnet = node({
        type: 'event',
        title: 'AlexNet wins ImageNet',
        start: Y(2012),
        summary: 'Deep CNN crushes the ImageNet benchmark, kicking off the deep-learning boom.',
        metadata: {
          location: 'University of Toronto, Canada',
          lat: 43.66,
          lng: -79.4,
          citations: [{ title: 'ImageNet Classification with Deep CNNs', url: 'https://papers.nips.cc/paper/4824' }],
          images: [img('AlexNet block diagram.svg', 'AlexNet CNN architecture')],
        },
      })
      const deepmind = node({
        type: 'entity',
        title: 'DeepMind founded',
        start: Y(2010),
        end: Y(2024),
        summary: 'London lab betting on reinforcement learning.',
        metadata: { subtype: 'org', location: 'London, England', lat: 51.51, lng: -0.13, images: [img('Google 2015 logo.svg', 'DeepMind (Google) logo')] },
      })
      const alphago = node({
        type: 'event',
        title: 'AlphaGo defeats Lee Sedol',
        start: Y(2016, 2, 9),
        precision: 'day',
        summary: 'A machine beats a Go champion 4–1.',
        metadata: { location: 'Seoul, South Korea', lat: 37.57, lng: 126.98 },
      })
      const seq2seq = node({
        type: 'event',
        title: 'Seq2Seq + attention',
        start: Y(2014),
        metadata: { location: 'Google, Mountain View, USA', lat: 37.39, lng: -122.08, images: [img('Recurrent neural network unfold.svg', 'Unfolded recurrent neural network')] },
      })
      const transformer = node({
        type: 'event',
        title: '"Attention Is All You Need"',
        start: Y(2017),
        summary: 'The transformer architecture.',
        metadata: {
          location: 'Google, Mountain View, USA',
          lat: 37.39,
          lng: -122.08,
          citations: [{ title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' }],
          images: [img('Transformer, full architecture.png', 'Transformer architecture diagram', 'portrait')],
        },
      })
      const gpt = node({ type: 'event', title: 'GPT released', start: Y(2018), metadata: { location: 'OpenAI, San Francisco, USA', lat: 37.77, lng: -122.42, images: [img('OpenAI Logo.svg', 'OpenAI logo')] } })
      const bert = node({ type: 'event', title: 'BERT released', start: Y(2018), metadata: { location: 'Google, Mountain View, USA', lat: 37.39, lng: -122.08, images: [img('Google 2015 logo.svg', 'Google logo')] } })
      const era = node({
        type: 'period',
        title: 'Foundation-model era',
        start: Y(2018),
        end: Y(2024),
        metadata: { geoScope: 'global', images: [img('ChatGPT logo.svg', 'ChatGPT logo')] },
      })

      edge(backprop, alexnet, 'influenced')
      edge(alexnet, era, 'caused')
      edge(deepmind, alphago, 'caused', 'built AlphaGo')
      edge(seq2seq, transformer, 'influenced')
      edge(transformer, gpt, 'influenced')
      edge(transformer, bert, 'influenced')
      edge(gpt, bert, 'competed_with')

      // Cross-globe story: the thaw after the winter, hopping Toronto → London →
      // Seoul → the Bay Area. Opens on the placeless winter (an off-map beat).
      story(
        alexnet,
        {
          title: 'The thaw',
          hook: 'How neural networks went from a research backwater to the center of the world — in four cities.',
          depthTier: 'deep',
          estimatedMinutes: 4,
          coverImage: storyImg('AlexNet block diagram.svg', 'The AlexNet architecture'),
        },
        [
          {
            bodyText:
              'For years, “neural network” was a phrase that ended careers. Funding froze, papers were rejected, and a stubborn few kept working on an idea everyone else had written off. They called it the AI winter.',
            kind: 'narration',
            focusNodeId: winter,
          },
          {
            bodyText:
              'The thaw began in Toronto. In 2012 a deep convolutional network called AlexNet didn’t just win the ImageNet contest — it humiliated everything else, halving the error rate overnight. The backwater was suddenly the frontier.',
            kind: 'narration',
            settingNote: 'University of Toronto',
            focusNodeId: alexnet,
          },
          {
            bodyText:
              'In London, a small lab named DeepMind was betting on a different idea: agents that learn by playing. Acquired by Google in 2014, it kept its name and its nerve.',
            kind: 'narration',
            focusNodeId: deepmind,
          },
          {
            bodyText:
              'In 2016, in a Seoul hotel ballroom, DeepMind’s AlphaGo beat Lee Sedol four games to one at Go — a game thought to need human intuition. A hundred million people watched a machine play a move no human would have.',
            kind: 'narration',
            settingNote: 'Seoul, South Korea',
            focusNodeId: alphago,
          },
          {
            bodyText:
              'Back in the Bay Area, a 2017 Google paper threw out recurrence entirely: “Attention Is All You Need.” The transformer it described would become the engine under almost everything that followed.',
            kind: 'narration',
            focusNodeId: transformer,
          },
          {
            bodyText:
              'A year later an OpenAI lab in San Francisco scaled that engine up and called it GPT. The winter was a long time ago now.',
            kind: 'narration',
            focusNodeId: gpt,
          },
        ],
      )
    },
  },
  {
    id: 'space-race',
    title: 'The Space Race',
    description: 'Cold War spaceflight milestones, 1957–1972.',
    build: ({ node, edge, story }) => {
      const cold = node({
        type: 'period',
        title: 'Cold War',
        start: Y(1947),
        end: Y(1991),
        // A worldwide standoff — no single place.
        metadata: { geoScope: 'global', images: [img('Cold War alliances mid-1975.svg', 'Cold War alliances map')] },
      })
      const sputnik = node({
        type: 'event',
        title: 'Sputnik 1',
        start: Y(1957, 9, 4),
        precision: 'day',
        summary: 'First artificial satellite.',
        metadata: { location: 'Baikonur Cosmodrome, Kazakhstan', lat: 45.92, lng: 63.34, images: [img('Sputnik asm.jpg', 'Sputnik 1 replica')] },
      })
      const gagarin = node({
        type: 'event',
        title: 'Gagarin orbits Earth',
        start: Y(1961, 3, 12),
        precision: 'day',
        metadata: { location: 'Baikonur Cosmodrome, Kazakhstan', lat: 45.92, lng: 63.34, images: [img('Yuri Gagarin (1961) - Restoration.jpg', 'Yuri Gagarin', 'portrait')] },
      })
      const apollo = node({
        type: 'period',
        title: 'Apollo program',
        start: Y(1961),
        end: Y(1972),
        metadata: { location: 'Kennedy Space Center, Florida', lat: 28.57, lng: -80.65, images: [img('Apollo 11 insignia.png', 'Apollo 11 mission insignia')] },
      })
      const moon = node({
        type: 'event',
        title: 'Apollo 11 Moon landing',
        start: Y(1969, 6, 20),
        precision: 'day',
        summary: 'First crewed lunar landing.',
        metadata: {
          location: 'Kennedy Space Center, Florida (launch)',
          lat: 28.57,
          lng: -80.65,
          citations: [{ title: 'NASA — Apollo 11', url: 'https://www.nasa.gov/mission/apollo-11/' }],
          images: [img('Aldrin Apollo 11 original.jpg', 'Buzz Aldrin on the Moon', 'portrait')],
        },
      })
      const nasa = node({
        type: 'entity',
        title: 'NASA',
        start: Y(1958),
        end: Y(2024),
        metadata: { subtype: 'org', location: 'Washington, D.C.', lat: 38.88, lng: -77.02, images: [img('NASA logo.svg', 'NASA logo')] },
      })

      edge(cold, sputnik, 'caused')
      edge(sputnik, gagarin, 'succeeded', 'escalation')
      edge(gagarin, apollo, 'influenced')
      edge(apollo, moon, 'caused')
      edge(nasa, moon, 'caused')

      // Cross-globe story: the race itself, ground site to ground site — Baikonur
      // in the Kazakh steppe to Cape Canaveral in Florida to Washington, D.C. (GS1).
      story(
        moon,
        {
          title: 'One giant leap',
          hook: 'Twelve years from the first beep overhead to boots on the Moon.',
          depthTier: 'deep',
          estimatedMinutes: 3,
          coverImage: storyImg('Aldrin Apollo 11 original.jpg', 'Buzz Aldrin on the Moon', { aspect: 'portrait' }),
        },
        [
          {
            bodyText:
              'On 4 October 1957 a polished metal sphere lifted off the Kazakh steppe and began to beep. Sputnik weighed less than a man, but the sound of it passing overhead — audible on home radios — told the world the Soviets had reached space first.',
            kind: 'narration',
            settingNote: 'Baikonur Cosmodrome, Kazakhstan',
            focusNodeId: sputnik,
          },
          {
            bodyText:
              'Four years later, from the same launch site, Yuri Gagarin became the first human in orbit. “Poyekhali!” — “Let’s go!” — and ninety minutes later he had circled the entire Earth.',
            kind: 'narration',
            focusNodeId: gagarin,
          },
          {
            bodyText:
              'America answered from a sandbar in Florida. Cape Canaveral grew gantries and flame trenches as the Apollo program turned a national humiliation into a decade-long sprint.',
            kind: 'narration',
            settingNote: 'Kennedy Space Center, Florida',
            focusNodeId: apollo,
          },
          {
            bodyText:
              'On 20 July 1969 a fragile lander set down in the Sea of Tranquility and a human being stepped onto another world. Six hundred million people watched the grainy feed at once.',
            kind: 'narration',
            focusNodeId: moon,
            citations: [{ title: 'NASA — Apollo 11', url: 'https://www.nasa.gov/mission/apollo-11/' }],
          },
          {
            bodyText:
              'None of it was an accident. From Washington, NASA marshaled 400,000 people and a sliver of the federal budget toward a single sentence: before this decade is out, land a man on the Moon and return him safely to the Earth.',
            kind: 'narration',
            focusNodeId: nasa,
          },
        ],
      )
    },
  },
  {
    id: 'roman-republic',
    title: 'Fall of the Roman Republic',
    description: 'Caesar’s road from Gaul to the Ides — across the Mediterranean world.',
    build: ({ node, edge, story }) => {
      const republic = node({
        type: 'period',
        title: 'Roman Republic',
        start: Y(-509),
        end: Y(-27),
        metadata: { location: 'Rome', lat: 41.89, lng: 12.49, images: [img('Maccari-Cicero.jpg', 'Cicero denounces Catiline in the Senate')] },
      })
      const caesar = node({
        type: 'entity',
        title: 'Julius Caesar',
        start: Y(-100),
        end: Y(-44),
        metadata: { subtype: 'person', location: 'Rome', lat: 41.89, lng: 12.49, images: [img('Gaius Iulius Caesar (Vatican Museum).jpg', 'Bust of Julius Caesar', 'portrait')] },
      })
      const alesia = node({
        type: 'event',
        title: 'Siege of Alesia',
        start: Y(-52),
        summary: 'Caesar’s conquest of Gaul is sealed.',
        metadata: { location: 'Alesia, Gaul', lat: 47.54, lng: 4.5 },
      })
      const rubicon = node({
        type: 'event',
        title: 'Caesar crosses the Rubicon',
        start: Y(-49),
        summary: 'Civil war begins.',
        metadata: { location: 'Rubicon, northern Italy', lat: 44.1, lng: 12.4, images: [img('Gaius Iulius Caesar (Vatican Museum).jpg', 'Julius Caesar', 'portrait')] },
      })
      const pharsalus = node({
        type: 'event',
        title: 'Battle of Pharsalus',
        start: Y(-48),
        summary: 'Caesar defeats Pompey in Greece.',
        metadata: { location: 'Pharsalus, Greece', lat: 39.29, lng: 22.38 },
      })
      const alexandria = node({
        type: 'event',
        title: 'Caesar in Alexandria',
        start: Y(-48, 9, 1),
        summary: 'The Alexandrian war; Caesar and Cleopatra.',
        metadata: { location: 'Alexandria, Egypt', lat: 31.2, lng: 29.92 },
      })
      const ides = node({
        type: 'event',
        title: 'Assassination of Caesar',
        start: Y(-44, 2, 15),
        precision: 'day',
        metadata: { location: 'Theatre of Pompey, Rome', lat: 41.895, lng: 12.473, images: [img('Vincenzo Camuccini - La morte di Cesare.jpg', 'The Death of Caesar (Camuccini)')] },
      })
      const empire = node({
        type: 'event',
        title: 'Augustus becomes emperor',
        start: Y(-27),
        summary: 'The Republic becomes the Empire.',
        metadata: { location: 'Rome', lat: 41.89, lng: 12.49, images: [img('Statue-Augustus.jpg', 'Augustus of Prima Porta', 'portrait')] },
      })

      edge(republic, rubicon, 'caused')
      edge(caesar, alesia, 'caused', 'conquers Gaul')
      edge(alesia, rubicon, 'succeeded')
      edge(rubicon, pharsalus, 'caused')
      edge(pharsalus, alexandria, 'succeeded')
      edge(rubicon, ides, 'caused')
      edge(ides, empire, 'caused')
      edge(caesar, rubicon, 'caused')

      // Cross-globe story: Caesar’s last decade circles the Mediterranean —
      // Gaul → Italy → Greece → Egypt → Rome (GS1 sweeps the whole sea).
      story(
        caesar,
        {
          title: 'The road to the Ides',
          hook: 'Caesar conquered a continent and lost the Republic — the map of his last decade rings the Mediterranean.',
          depthTier: 'deep',
          estimatedMinutes: 4,
          coverImage: storyImg('Vincenzo Camuccini - La morte di Cesare.jpg', 'The Death of Caesar'),
        },
        [
          {
            bodyText:
              'It started in Gaul. At Alesia in 52 BCE, Caesar walled in an entire Gallic army, then walled in the relief force behind him, and won a siege from between two enemies. Eight years of conquest had made him the most dangerous man in Rome — and Rome noticed.',
            kind: 'narration',
            settingNote: 'Alesia, in what is now Burgundy',
            focusNodeId: alesia,
          },
          {
            bodyText:
              'Ordered to disband his army, he marched it instead to the Rubicon — the little river marking the edge of Italy, which no general could cross under arms. He crossed. “The die is cast.” Civil war.',
            kind: 'narration',
            focusNodeId: rubicon,
          },
          {
            bodyText:
              'He chased his rival Pompey across the Adriatic and broke him at Pharsalus, on the plains of Greece. Pompey fled to Egypt — where he was murdered on the beach by men hoping to please the winner.',
            kind: 'narration',
            settingNote: 'Pharsalus, Thessaly',
            focusNodeId: pharsalus,
          },
          {
            bodyText:
              'In Alexandria, Caesar was handed his enemy’s severed head — and met a 21-year-old queen named Cleopatra. He stayed far longer than the war required.',
            kind: 'narration',
            focusNodeId: alexandria,
          },
          {
            bodyText:
              'Back in Rome, master of the world, he was named dictator for life. On the Ides of March, 44 BCE, sixty senators surrounded him at the foot of Pompey’s statue. The Republic did not survive him.',
            kind: 'narration',
            focusNodeId: ides,
          },
        ],
      )
    },
  },
  {
    // Image-dense fixture: historical figures (entity nodes) each with a
    // portrait — the primary canvas to develop person/entity cards against,
    // and the visual anchor for the e2e canvas spec.
    id: 'figures',
    title: 'Figures of science',
    description: 'Portrait-rich entities for developing visual entity cards.',
    build: ({ node, edge, story }) => {
      const leonardo = node({
        type: 'entity',
        title: 'Leonardo da Vinci',
        start: Y(1452),
        end: Y(1519),
        summary: 'Polymath of the High Renaissance.',
        metadata: { subtype: 'person', location: 'Florence, Italy', lat: 43.7696, lng: 11.2558, images: [img('Francesco Melzi - Portrait of Leonardo - WGA14795.jpg', 'Portrait of Leonardo da Vinci', 'portrait')] },
      })
      const newton = node({
        type: 'entity',
        title: 'Isaac Newton',
        start: Y(1643),
        end: Y(1727),
        summary: 'Laws of motion and universal gravitation.',
        metadata: { subtype: 'person', location: 'Cambridge, England', lat: 52.2053, lng: 0.1218, images: [img('GodfreyKneller-IsaacNewton-1689.jpg', 'Portrait of Isaac Newton', 'portrait')] },
      })
      const darwin = node({
        type: 'entity',
        title: 'Charles Darwin',
        start: Y(1809),
        end: Y(1882),
        summary: 'Theory of evolution by natural selection.',
        metadata: { subtype: 'person', location: 'Downe, Kent, England', lat: 51.331, lng: 0.053, images: [img('Charles Darwin seated crop.jpg', 'Photograph of Charles Darwin', 'portrait')] },
      })
      const lovelace = node({
        type: 'entity',
        title: 'Ada Lovelace',
        start: Y(1815),
        end: Y(1852),
        summary: 'First algorithm intended for a machine.',
        metadata: { subtype: 'person', location: 'London, England', lat: 51.5074, lng: -0.1278, images: [img('Ada Lovelace portrait.jpg', 'Portrait of Ada Lovelace', 'portrait')] },
      })
      const curie = node({
        type: 'entity',
        title: 'Marie Curie',
        start: Y(1867),
        end: Y(1934),
        summary: 'Pioneer of radioactivity; two Nobel Prizes.',
        metadata: { subtype: 'person', location: 'Paris, France', lat: 48.8566, lng: 2.3522, images: [img('Marie Curie c. 1920s.jpg', 'Photograph of Marie Curie', 'portrait')] },
      })
      const einstein = node({
        type: 'entity',
        title: 'Albert Einstein',
        start: Y(1879),
        end: Y(1955),
        summary: 'Relativity; reshaped modern physics.',
        metadata: { subtype: 'person', location: 'Princeton, New Jersey, USA', lat: 40.3573, lng: -74.6672, images: [img('Einstein 1921 by F Schmutzer - restoration.jpg', 'Photograph of Albert Einstein', 'portrait')] },
      })

      edge(newton, darwin, 'influenced')
      edge(newton, einstein, 'influenced')
      edge(lovelace, curie, 'succeeded')

      // A multi-beat story on Darwin so the canvas ships with a real tap-through
      // story to play (and the e2e story-viewer spec has something to read).
      story(
        darwin,
        {
          title: 'The long wait before Origin',
          hook: 'Two decades between the idea and the book.',
          depthTier: 'deep',
          estimatedMinutes: 3,
        },
        [
          {
            bodyText:
              'Returning from the Beagle in 1836, Darwin filled notebook after notebook with a dangerous idea: that species were not fixed, but descended, with modification, from common ancestors.',
            kind: 'narration',
            settingNote: 'Down House, Kent — a study lined with specimens',
          },
          {
            bodyText:
              'He had read Newton’s mechanics as a student and admired how one law could govern many phenomena. Now he wanted the same for life: a single principle behind its endless forms.',
            kind: 'interior',
            // Spotlight Newton on this beat: the canvas pans + rings him and the
            // panel beside the story switches to his card (per-beat focus).
            focusNodeId: newton,
            relatedNodeIds: [newton],
          },
          {
            bodyText:
              'For twenty years he hesitated — gathering evidence, breeding pigeons, dreading the reaction. Only when Alfred Russel Wallace mailed him the same theory did he finally publish, in 1859.',
            kind: 'narration',
            citations: [
              {
                title: 'On the Origin of Species (1859)',
                url: 'https://en.wikipedia.org/wiki/On_the_Origin_of_Species',
                quote: 'There is grandeur in this view of life…',
              },
            ],
          },
          {
            bodyText:
              'The idea outlived him. Decades later, a young physicist named Einstein would reshape another fixed certainty — time itself — showing how completely the modern world had learned to question what once seemed eternal.',
            kind: 'narration',
            relatedNodeIds: [einstein],
          },
        ],
      )

      // A second, cross-globe story: the geography of a scientific revolution —
      // Florence → England → Paris → Princeton (GS1 sweeps the Atlantic).
      story(
        leonardo,
        {
          title: 'How an idea crosses a century',
          hook: 'Four cities, four centuries, one long argument about how the world works.',
          depthTier: 'deep',
          estimatedMinutes: 3,
          coverImage: storyImg('Francesco Melzi - Portrait of Leonardo - WGA14795.jpg', 'Portrait of Leonardo da Vinci', { aspect: 'portrait' }),
        },
        [
          {
            bodyText:
              'In Florence, Leonardo filled notebooks with water, flight, and anatomy — observation as a way of life, centuries before anyone called it science. He left almost nothing finished and almost nothing unquestioned.',
            kind: 'narration',
            focusNodeId: leonardo,
          },
          {
            bodyText:
              'In England, Isaac Newton did what Leonardo only sketched: he wrote the laws down. One mathematics for falling apples and orbiting moons. For two centuries it looked like the final word.',
            kind: 'narration',
            focusNodeId: newton,
          },
          {
            bodyText:
              'In Paris, Marie Curie pulled new elements from tons of ore and a new force from the atom — radioactivity — showing that even Newton’s solid matter had a restless interior no one had suspected.',
            kind: 'narration',
            focusNodeId: curie,
          },
          {
            bodyText:
              'And in Princeton, Albert Einstein bent the last fixed thing of all — time — and the final word turned out to be a question after all. The revolution that began in a Florentine notebook had crossed an ocean and four hundred years.',
            kind: 'narration',
            focusNodeId: einstein,
          },
        ],
      )
    },
  },
]

// E2E-only fixtures: seeded ONLY into the e2e DB (DATABASE_URL contains "e2e"),
// never the demo. `blank` has nodes but no coordinates — the coordinate-free
// timeline the globe empty-state / setup-path test drives, now that all six demo
// timelines are coordinated.
const E2E_FIXTURES: Seeder[] = [
  {
    id: 'blank',
    title: 'A blank timeline',
    description: 'A timeline with no places yet — exercises the globe setup path.',
    build: ({ node, edge }) => {
      const a = node({ type: 'event', title: 'First event', start: Y(2000) })
      const b = node({ type: 'event', title: 'Second event', start: Y(2010) })
      const era = node({ type: 'period', title: 'An era', start: Y(2000), end: Y(2020) })
      edge(a, b, 'succeeded')
      edge(era, a, 'caused')
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
  // The e2e DB gets extra fixtures (the coordinate-free `blank`); the demo DB stays
  // the six polished timelines only.
  const isE2E = (process.env.DATABASE_URL ?? '').includes('e2e')
  const pool = isE2E ? [...SEEDS, ...E2E_FIXTURES] : SEEDS
  const targets = only ? pool.filter((s) => s.id === only) : pool

  if (only && targets.length === 0) {
    console.error(`No seed with id "${only}". Available: ${pool.map((s) => s.id).join(', ')}`)
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
