// One-step local setup for Synek — `bun run setup`.
//
// Collapses the manual 6–8 step setup into one command: writes a real .env
// (generating an auth secret), runs migrations + seeds the Stoicism timeline so
// the canvas is never blank, mints an MCP API key (for the Claude Desktop / stdio
// path), and prints how to connect Claude Code (OAuth) or Claude Desktop (stdio).
//
// Runs under Node via tsx (better-sqlite3 is a Node-ABI addon) — `bun run setup`.
// Idempotent: re-running won't rotate your secret or pile up keys.
//
//   bun run setup                         # set up, print next steps
//   bun run setup --start                 # ...then boot the dev server
//   bun run setup --email me@local --password 'hunter2'   # custom local account
//   bun run setup --no-seed               # skip the Stoicism seed
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2)
const has = (f: string) => argv.includes(f)
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const START = has('--start')
const SEED = !has('--no-seed')
const PORT = flag('--port') || process.env.PORT || '3001'
// One coherent local account owns the seeded timeline AND the minted key, so the
// connected MCP client immediately sees a populated canvas. Defaults match the
// seed's demo account; override for your own.
const EMAIL = flag('--email') || process.env.SYNEK_DEMO_EMAIL || 'demo@synek.app'
const PASSWORD = flag('--password') || process.env.SYNEK_DEMO_PASSWORD || 'demo-password-123'

const BASE_URL = `http://localhost:${PORT}`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`
const step = (n: number, s: string) => console.log(`\n${bold(`[${n}/4]`)} ${s}`)

// --- 1. .env ---------------------------------------------------------------
// Parse the existing .env (if any), ensure the keys we manage are present, write
// back only when something changed. Then mirror them into process.env so the
// app modules (which read env at import time) pick them up in THIS process and
// in the child processes we spawn.
function ensureEnv(): { created: boolean; changed: boolean } {
  const envPath = path.join(root, '.env')
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const lines = existing.split('\n')
  const get = (k: string) => {
    const m = existing.match(new RegExp(`^${k}=(.*)$`, 'm'))
    return m ? m[1] : undefined
  }
  const defaults: Record<string, string> = {
    DATABASE_URL: get('DATABASE_URL') || 'local.db',
    PORT: get('PORT') || PORT,
    // Generate a real secret so this instance isn't on the shared dev default.
    BETTER_AUTH_SECRET: get('BETTER_AUTH_SECRET') || randomBytes(32).toString('base64'),
    BETTER_AUTH_URL: get('BETTER_AUTH_URL') || BASE_URL,
  }

  let changed = false
  for (const [k, v] of Object.entries(defaults)) {
    process.env[k] = process.env[k] || v
    const idx = lines.findIndex((l) => l.startsWith(`${k}=`))
    if (idx === -1) {
      lines.push(`${k}=${v}`)
      changed = true
    } else if (!lines[idx]!.slice(k.length + 1)) {
      lines[idx] = `${k}=${v}`
      changed = true
    }
  }
  const created = !existing
  if (changed) writeFileSync(envPath, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n')
  return { created, changed }
}

async function main() {
  console.log(bold('\n  Synek setup') + dim('  — local-first timeline canvas, driven by your MCP client\n'))

  step(1, 'Configuring .env')
  const env = ensureEnv()
  console.log(
    `      ${ok('✓')} ${env.created ? 'created .env' : env.changed ? 'updated .env' : '.env already complete'}` +
      dim(`  (DATABASE_URL=${process.env.DATABASE_URL}, PORT=${process.env.PORT})`),
  )

  // The seed assigns the Stoicism timeline to this account; mint the key for the
  // same one so the connected client sees it. Thread creds to the child via env.
  process.env.SYNEK_DEMO_EMAIL = EMAIL
  process.env.SYNEK_DEMO_PASSWORD = PASSWORD

  step(2, SEED ? 'Migrating + seeding the Stoicism timeline' : 'Migrating (seed skipped)')
  if (SEED) {
    const seeded = spawnSync('npx', ['tsx', path.join(root, 'scripts', 'seed.ts'), 'stoicism'], {
      stdio: 'inherit',
      cwd: root,
      env: process.env,
    })
    if (seeded.status !== 0) {
      console.error('\n  Seeding failed. Fix the error above and re-run `bun run setup`.')
      process.exit(seeded.status ?? 1)
    }
    // Seed images render straight from public Wikimedia URLs — nothing to download.
  } else {
    // Importing the db client runs migrations (idempotent) and ensures the account.
    const { auth } = await import('../src/lib/auth')
    try {
      await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Local' } })
    } catch {
      // already exists — fine
    }
  }

  step(3, 'Minting an MCP API key')
  const { db } = await import('../src/lib/db/index')
  const { createApiKey, listApiKeys } = await import('../src/lib/auth/api-keys')
  const { user } = await import('../src/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const owner = db.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, EMAIL)).get()
  if (!owner) {
    console.error(`\n  Could not find the local account (${EMAIL}). Re-run without --no-seed.`)
    process.exit(1)
  }

  let rawKey: string | null = null
  if (listApiKeys(owner.id).length === 0) {
    rawKey = createApiKey('Local setup', owner.id).raw
    console.log(`      ${ok('✓')} minted a key for ${owner.email}`)
  } else {
    console.log(
      `      ${ok('✓')} ${owner.email} already has keys` +
        dim('  (secrets are show-once — create/copy one in the app’s Keys panel)'),
    )
  }

  // --- 4. report -----------------------------------------------------------
  step(4, 'Connect your MCP client')
  console.log(`
  ${bold('Local account')}   ${owner.email}  ${dim(`(password: ${PASSWORD} — change it in-app)`)}
  ${bold('Canvas')}          ${BASE_URL}
`)

  // Claude Code — OAuth, no key to copy. Install the plugin, then authorize once.
  console.log(`  ${bold('Claude Code')} ${dim('— OAuth, nothing to paste:')}`)
  console.log(`      /plugin marketplace add ohmatey/synek`)
  console.log(`      /plugin install synek@synek`)
  console.log(`      ${dim('then  /mcp → synek → Authenticate  (approve in the browser) → /synek:map Stoicism')}\n`)

  // Claude Desktop — stdio path uses a static API key.
  console.log(`  ${bold('Claude Desktop')} ${dim('(stdio, uses an API key) — add to claude_desktop_config.json:')}`)
  const key = rawKey ?? 'PASTE_AN_API_KEY'
  console.log(
    dim(
      JSON.stringify(
        { mcpServers: { synek: { command: 'bun', args: ['run', 'mcp:stdio'], cwd: root, env: { SYNEK_API_KEY: key } } } },
        null,
        2,
      )
        .split('\n')
        .map((l) => '      ' + l)
        .join('\n'),
    ),
  )
  if (rawKey) {
    console.log(`\n      ${dim('↑ that key is shown once. Pick ONE transport — Claude Code OR Desktop, not both on the same DB.')}`)
  } else {
    console.log(`\n      ${dim(`↑ create a key in the "Connect an MCP client" panel at ${BASE_URL} and drop it in.`)}`)
  }

  if (START) {
    console.log(`\n${bold('Starting the dev server…')}  ${dim('(Ctrl-C to stop)')}\n`)
    const dev = spawn('npx', ['vite', 'dev'], { stdio: 'inherit', cwd: root, env: process.env })
    dev.on('exit', (c) => process.exit(c ?? 0))
  } else {
    console.log(`\n  ${bold('Next:')} run ${ok('bun run dev')} to open the canvas at ${BASE_URL}\n`)
    process.exit(0)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
