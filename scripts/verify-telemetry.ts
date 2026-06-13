import { readFileSync } from 'node:fs'
import { telemetryEnabled, heartbeatPayload, sendHeartbeat } from '../src/lib/telemetry/heartbeat'

// Data-layer proof of the opt-IN self-hoster heartbeat (roadmap LATER.3) WITHOUT
// touching the network: asserts the opt-out gate (default = silent), the opt-in
// gate (flag AND key both required), the anonymous payload shape, db_backend
// detection, and install_id stability. Run under Node: `bun run verify:telemetry`.

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function pkgVersion(): string {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
}

function clearOptIn() {
  delete process.env.SYNEK_TELEMETRY
  delete process.env.SYNEK_TELEMETRY_KEY
}

async function main() {
  // Pin a known secret + file DB so install_id / db_backend are deterministic.
  process.env.BETTER_AUTH_SECRET = 'verify-secret-aaaaaaaaaaaaaaaaaaaa'
  process.env.DATABASE_URL = 'local.db'

  // --- opt-out gate: a default install sends nothing ---
  clearOptIn()
  assert(telemetryEnabled() === false, 'default (no flag, no key) → disabled')
  await sendHeartbeat()
  assert(true, 'sendHeartbeat() is a silent no-op when disabled (no throw, no network)')

  // --- opt-in requires BOTH the flag and a key ---
  process.env.SYNEK_TELEMETRY = '1'
  assert(telemetryEnabled() === false, 'flag alone (no key) → still disabled')
  process.env.SYNEK_TELEMETRY_KEY = 'phc_verify_key'
  assert(telemetryEnabled() === true, 'flag + key → enabled')
  process.env.SYNEK_TELEMETRY = 'false'
  assert(telemetryEnabled() === false, 'explicit "false" flag → disabled even with a key')
  process.env.SYNEK_TELEMETRY = 'on'
  assert(telemetryEnabled() === true, 'truthy alias "on" → enabled')

  // --- payload is anonymous + well-shaped ---
  const p = heartbeatPayload()
  assert(/^[0-9a-f]{32}$/.test(p.install_id), 'install_id is a 32-char hex hash')
  assert(p.version === pkgVersion(), `version matches package.json (${p.version})`)
  assert(p.db_backend === 'sqlite', 'db_backend = sqlite for a file DATABASE_URL')
  const keys = Object.keys(p).sort().join(',')
  assert(keys === 'db_backend,install_id,version', `payload carries ONLY the 3 anonymous fields (${keys})`)

  // --- db_backend detects Postgres ---
  process.env.DATABASE_URL = 'postgresql://u:p@host:5432/db'
  assert(heartbeatPayload().db_backend === 'pg', 'db_backend = pg for a postgres:// URL')
  process.env.DATABASE_URL = 'local.db'

  // --- install_id is stable per-secret, rotates with the secret ---
  const a = heartbeatPayload().install_id
  assert(a === heartbeatPayload().install_id, 'install_id is stable across calls (same secret)')
  process.env.BETTER_AUTH_SECRET = 'a-different-secret-bbbbbbbbbbbbbbbb'
  assert(heartbeatPayload().install_id !== a, 'install_id changes when BETTER_AUTH_SECRET rotates')

  console.log('\n✅ telemetry opt-in contract verified')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
