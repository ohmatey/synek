// Download every seed image from Wikimedia Commons into public/seed/ so seeded
// timelines render offline (and first-run/demos never show broken thumbnails).
// Run under Node/Bun (global fetch): `bun run cache:images`. Commit the result.
import { mkdirSync, writeFileSync } from 'node:fs'
import { SEED_IMAGE_FILES, seedImageSlug, wikiUrl } from './seed-images'

const OUT = 'public/seed'
mkdirSync(OUT, { recursive: true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Commons rate-limits bursts (429); fetch one at a time with a polite delay and
// retry transient failures with backoff.
async function download(file: string): Promise<void> {
  const slug = seedImageSlug(file)
  // SVGs: fetch the original (scalable). Rasters: cap width to keep files small.
  const url = slug.endsWith('.svg') ? wikiUrl(file) : wikiUrl(file, 640)
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.status === 429) throw new Error('HTTP 429')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(`${OUT}/${slug}`, Buffer.from(await res.arrayBuffer()))
      return
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      if (attempt < 4) await sleep(attempt * 2500) // 2.5s, 5s, 7.5s backoff
    }
  }
  throw new Error(lastErr)
}

const files = [...new Set(SEED_IMAGE_FILES)]
console.log(`Caching ${files.length} seed images → ${OUT}/`)

let ok = 0
const failed: string[] = []
for (const file of files) {
  try {
    await download(file)
    ok++
    console.log(`  ✓ ${seedImageSlug(file)}`)
  } catch (e) {
    failed.push(file)
    console.error(`  ✗ ${file} — ${e instanceof Error ? e.message : String(e)}`)
  }
  await sleep(1200) // polite gap between files
}

console.log(`Done. ${ok}/${files.length} cached${failed.length ? ` — failed: ${failed.join(', ')}` : ''}.`)
if (failed.length) process.exit(1)
