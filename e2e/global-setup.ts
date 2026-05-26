import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

// Reset + seed the throwaway e2e DB before the suite. The seed imports the DB
// client, which migrates the fresh file, then writes the example timelines
// (incl. the image-rich `figures` fixture the canvas spec asserts).
export default function globalSetup() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`e2e.db${suffix}`, { force: true })
  }
  execFileSync('bunx', ['tsx', 'scripts/seed.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'e2e.db' },
  })
}
