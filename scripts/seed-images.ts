// Canonical list of the Wikimedia Commons files the seed uses, with helpers to
// resolve each to (a) a stable LOCAL path under public/seed/ — what the app
// renders, so seeded timelines are offline-safe and never show broken thumbs —
// and (b) the remote Commons source the cache script downloads from.
//
// Keep SEED_IMAGE_FILES in sync with the files referenced in seed.ts, then run
// `bun run cache:images` to (re)download them into public/seed/.

export const SEED_IMAGE_FILES = [
  // observability
  'Kubernetes logo without workmark.svg',
  'New Relic logo.svg',
  'Grafana dashboard.png',
  'Prometheus software logo.svg',
  'Grafana logo.svg',
  'Opentelemetry-logo.svg',
  'Cortex Logo.svg',
  // deep-learning
  'Artificial neural network.svg',
  'Geoffrey Hinton at UBC.jpg',
  'AlexNet block diagram.svg',
  'Recurrent neural network unfold.svg',
  'Transformer, full architecture.png',
  'OpenAI Logo.svg',
  'Google 2015 logo.svg',
  'ChatGPT logo.svg',
  // space-race
  'Cold War alliances mid-1975.svg',
  'Sputnik asm.jpg',
  'Yuri Gagarin (1961) - Restoration.jpg',
  'Apollo 11 insignia.png',
  'Aldrin Apollo 11 original.jpg',
  'NASA logo.svg',
  // roman-republic
  'Maccari-Cicero.jpg',
  'Gaius Iulius Caesar (Vatican Museum).jpg',
  'Vincenzo Camuccini - La morte di Cesare.jpg',
  'Statue-Augustus.jpg',
  // figures
  'Francesco Melzi - Portrait of Leonardo - WGA14795.jpg',
  'GodfreyKneller-IsaacNewton-1689.jpg',
  'Charles Darwin seated crop.jpg',
  'Ada Lovelace portrait.jpg',
  'Marie Curie c. 1920s.jpg',
  'Einstein 1921 by F Schmutzer - restoration.jpg',
] as const

// Stable, filesystem-safe name (preserves the extension so content-type is right).
export function seedImageSlug(file: string): string {
  const dot = file.lastIndexOf('.')
  const ext = dot >= 0 ? file.slice(dot).toLowerCase() : ''
  const base = (dot >= 0 ? file.slice(0, dot) : file)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base}${ext}`
}

// What the app renders (served from public/).
export function seedImageUrl(file: string): string {
  return `/seed/${seedImageSlug(file)}`
}

// Remote Commons source. Special:FilePath always resolves to the current file;
// `width` rasterizes large photos (skip it for SVGs to keep them scalable).
export function wikiUrl(file: string, width?: number): string {
  const base = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`
  return width && width > 0 ? `${base}?width=${width}` : base
}
