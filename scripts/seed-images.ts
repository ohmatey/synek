// Canonical list of the Wikimedia Commons files the seed uses. The app renders
// each one DIRECTLY from its public Commons URL (`seedImageUrl` → `wikiUrl`) — no
// local download, so the seed has zero image assets to ship. Tradeoff: thumbnails
// need network to load (not offline-safe).
//
// `bun run cache:images` + `seedImageSlug` remain only as an OPTIONAL way to mirror
// these into public/seed/ for an offline setup; the default render path is remote.
// Keep SEED_IMAGE_FILES in sync with the files referenced in seed.ts.

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
  // stoicism (Wikimedia Commons filenames confirmed via the page-images API —
  // each is a live Wikipedia infobox image, so the cache download resolves)
  'Crates of Thebes Villa Farnesina.jpg',
  'Paolo Monti - Servizio fotografico (Napoli, 1969) - BEIC 6353768.jpg',
  'Cleanthes from L. Annaei Senecae philosophi Opera, 1605, title page detail.png',
  'Chrysippos BM 1846.jpg',
  'Panaetius Nuremberg Chronicle.jpg',
  'Posidonio, replica augustea (23 ac.-14 dc ca) da originale del 100-50 ac. ca. 6142.JPG',
  'Duble herma of Socrates and Seneca Antikensammlung Berlin 07.jpg',
  'Epicteti Enchiridion Latinis versibus adumbratum (Oxford 1715) frontispiece (cropped).jpg',
  'MSR-ra-61-b-1-DM.jpg',
  'Attica 06-13 Athens 22 View from Acropolis Hill - Museum of Ancient Agora.jpg',
  'Marcus Aurelius. De seipso, seu vita sua (Xylander, 1558).jpg',
  'The Discourses of Epictetus - Elizabeth Carter - 1759 - page 1.jpg',
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

// What the app renders: the public Wikimedia Commons image directly (no local
// download). SVGs stay vector (scalable); raster photos are rasterized to a sane
// card width so we don't pull multi-MB originals into a thumbnail.
export function seedImageUrl(file: string): string {
  return /\.svg$/i.test(file) ? wikiUrl(file) : wikiUrl(file, 600)
}

// Remote Commons source. Special:FilePath always resolves to the current file;
// `width` rasterizes large photos (skip it for SVGs to keep them scalable).
export function wikiUrl(file: string, width?: number): string {
  const base = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`
  return width && width > 0 ? `${base}?width=${width}` : base
}
