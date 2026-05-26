import { execFileSync } from 'node:child_process'

// Seed the throwaway e2e DB before the suite. The seed imports the DB client,
// which migrates the file (incl. the auth tables and the chat-table drop), then
// resets the example timelines (idempotent per id, incl. the image-rich `figures`
// fixture the canvas spec asserts).
//
// We deliberately do NOT delete the DB *file*: the dev server imports the DB
// module — which opens e2e.db — the moment Playwright probes it for readiness.
// Unlinking the file would leave that long-lived server handle pointing at a
// stale, now-unlinked (empty) inode for the whole run, so every read would miss
// the seed AND any token minted at test time (→ spurious empty pages / MCP 401s).
// Resetting in place keeps the inode the server holds.
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: 'e2e.db' }
  execFileSync('bunx', ['tsx', 'scripts/seed.ts'], { stdio: 'inherit', env })

  // Clean keys slate per run — delete rows (never unlink the file, per above) so
  // api_keys don't accumulate across runs and the first home load re-seeds the
  // "Default" key deterministically.
  execFileSync('bunx', ['tsx', '-e', "import('./src/lib/db').then(({ sqlite }) => sqlite.exec('DELETE FROM api_keys'))"], {
    stdio: 'inherit',
    env,
  })
}
