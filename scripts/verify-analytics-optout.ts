import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/auth-schema'

// The /account "Product analytics" switch used to flip only the browser's
// localStorage, so the MCP layer's server-side PostHog events (`mcp_tool_called`,
// `key_connected`, ...) kept firing for a user who had switched analytics off. This
// proves the server now honours the per-user flag END TO END: a real posthog-node
// client posts to a local HTTP server standing in for PostHog, and we assert on what
// actually arrives on the wire, not on a mock. Run under Node: `bun run verify:analytics-optout`.

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

type Captured = { event: string; distinct_id: string }
const received: Captured[] = []

// posthog-node POSTs {api_key, batch:[{event, distinct_id, ...}]} to /batch/, gzip'd by default.
const sink = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    try {
      let raw = Buffer.concat(chunks)
      if (req.headers['content-encoding'] === 'gzip') raw = gunzipSync(raw)
      const body = JSON.parse(raw.toString('utf8')) as { batch?: Captured[] }
      for (const e of body.batch ?? []) received.push({ event: e.event, distinct_id: e.distinct_id })
    } catch {
      /* ignore non-capture traffic */
    }
    res.setHeader('content-type', 'application/json')
    res.end('{"status":1}')
  })
})

const A = 'optout-user-a'
const B = 'optout-user-b'
const C = 'optout-user-c' // never gets a user_settings row

async function main() {
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve))
  const port = (sink.address() as AddressInfo).port
  // posthog/server.ts reads its key/host at module load, so set them BEFORE importing it.
  process.env.POSTHOG_API_KEY = 'phc_verify_optout'
  process.env.POSTHOG_HOST = `http://127.0.0.1:${port}`
  const { captureServer, flushAnalytics, serverAnalyticsAllowed } = await import('../src/lib/posthog/server')
  const { isAnalyticsOptedOut, setUserAnalyticsOptOut } = await import('../src/lib/db/user-settings')

  db.delete(user).where(sql`${user.id} like 'optout-user-%'`).run()
  const now = new Date()
  db.insert(user)
    .values([A, B, C].map((id) => ({ id, name: id, email: `${id}@optout.test`, createdAt: now, updatedAt: now })))
    .run()

  const emit = async () => {
    received.length = 0
    for (const id of [A, B, C]) captureServer(id, 'mcp_tool_called', { tool: 'verify' })
    await flushAnalytics()
    return new Set(received.map((r) => r.distinct_id))
  }

  console.log('default (no settings row) is opted IN — the product posture:')
  assert(isAnalyticsOptedOut(A) === false, 'a user with no user_settings row reads as opted in')
  assert(serverAnalyticsAllowed(A) === true, 'serverAnalyticsAllowed → true by default')
  let seen = await emit()
  assert(seen.has(A) && seen.has(B) && seen.has(C), 'all three users’ events reach the capture host')

  console.log('A opts out:')
  setUserAnalyticsOptOut(A, true)
  assert(isAnalyticsOptedOut(A) === true, 'the flag persists to user_settings')
  assert(isAnalyticsOptedOut(B) === false, 'another user is unaffected')
  seen = await emit()
  assert(!seen.has(A), 'NOTHING for the opted-out user reaches the capture host')
  assert(seen.has(B) && seen.has(C), 'opted-in users still send')

  console.log('A opts back in:')
  setUserAnalyticsOptOut(A, false)
  seen = await emit()
  assert(seen.has(A), 'events resume once the user opts back in')

  console.log('opt-out is per user, set on a row-less user via upsert:')
  setUserAnalyticsOptOut(C, true)
  seen = await emit()
  assert(!seen.has(C) && seen.has(A) && seen.has(B), 'the upsert created C’s row and only C went quiet')

  db.delete(user).where(sql`${user.id} like 'optout-user-%'`).run()
  console.log('\nserver-side analytics opt-out verified ✓')
  sink.close()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
