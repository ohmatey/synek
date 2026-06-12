import { eq } from 'drizzle-orm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { buildMcpServer } from '../src/lib/mcp/server'
import { listArtifactsForTimeline } from '../src/lib/db/artifacts'

// Drives the NEW MCP tools through the real SDK tool path (Zod validation + the
// owner-guarded handlers + the JSON envelope), in-process via InMemoryTransport —
// no HTTP, no model. Covers S2.3 register_artifact + S2.5 search_artifacts + the
// write_story v2 citation union. Run under Node: `bun run verify:search`.

const TL = 'verify-search'
const VERIFY_EMAIL = 'verify-search@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureVerifyUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: VERIFY_EMAIL, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    /* exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, VERIFY_EMAIL)).get()
  if (!row) throw new Error('could not create the verify user')
  return row.id
}

function addMoment(ownerId: string, title: string): string {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [{ op: 'add_node', ref: 'm', type: 'event', title, start: '100' }])
  commitPatch(TL, builder, `add ${title}`)
  return (results[0] as { id: string }).id
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Search verify')
  const moment = addMoment(ownerId, 'Vindolanda')

  // Wire an in-memory MCP client ⇄ the owner-scoped server.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = buildMcpServer(ownerId)
  await server.connect(serverTransport)
  const client = new Client({ name: 'verify-search', version: '0.0.0' })
  await client.connect(clientTransport)

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] }
    return JSON.parse(res.content[0]!.text)
  }

  // tools are advertised
  const tools = (await client.listTools()).tools.map((t) => t.name)
  assert(tools.includes('register_artifact') && tools.includes('search_artifacts'), 'both new tools are advertised')

  // === register_artifact (S2.3) ===========================================
  console.log('register_artifact — source + artifact + moment link')
  const r1 = await call('register_artifact', {
    title: 'Tablet 291',
    artifactType: 'letter',
    transcript: 'a Roman birthday invitation from Claudia Severa',
    reliability: 'primary',
    sourceType: 'primary',
    date: 'AD 100',
    momentId: moment,
    source: { title: 'Vindolanda Tablets', sourceType: 'archive' },
  })
  assert(!!r1.artifactId && !!r1.sourceId, 'register_artifact returns artifactId + sourceId')
  const a1 = r1.artifactId as string

  const r2 = await call('register_artifact', { title: 'Tablet 343', artifactType: 'letter', transcript: 'a Roman request for supplies' })
  const a2 = r2.artifactId as string

  // === search_artifacts (S2.5) ============================================
  console.log('search_artifacts — recall, snippet, opaque score, filters, scope')
  const s1 = await call('search_artifacts', { query: 'birthday' })
  assert(s1.results.some((r: any) => r.id === a1), 'search recalls a1 by a transcript term')
  assert(s1.results.every((r: any) => typeof r.score === 'number' && !('rank' in r) && !('bm25' in r)), 'rows carry an opaque score, no backend key leaks')
  assert(s1.results.some((r: any) => typeof r.snippet === 'string' && r.snippet.length > 0), 'snippet populated')

  const filtered = await call('search_artifacts', { query: 'Roman', types: ['letter'], reliability: ['primary'] })
  assert(filtered.results.every((r: any) => r.artifactType === 'letter' && r.reliability === 'primary'), 'type + reliability filters narrow')
  assert(filtered.results.some((r: any) => r.id === a1), 'a1 (primary letter) survives the filters')

  const messy = await call('search_artifacts', { query: 'Roman -- ("' })
  assert(Array.isArray(messy.results), 'punctuation query does not throw')

  const scoped = await call('search_artifacts', { query: 'Roman', timelineId: TL })
  assert(scoped.results.some((r: any) => r.id === a1), 'timeline-scoped search includes the linked artifact')
  assert(!scoped.results.some((r: any) => r.id === a2), 'timeline-scoped search excludes the UNlinked artifact')

  // === write_story v2 union (S2.3 contract) ===============================
  console.log('write_story v2 — artifactId citation + unknown-id warning')
  const w1 = await call('write_story', {
    momentId: moment,
    title: 'Letters',
    segments: [
      { bodyText: 'She wrote.', citations: [{ artifactId: a1, excerptUsed: 'birthday invitation' }] },
      { bodyText: 'A note.', citations: [{ title: 'Bowman 1994', sourceType: 'scholarship' }] },
    ],
  })
  assert(Array.isArray(w1.warnings) && w1.warnings.length === 0, 'write_story accepts a known artifactId citation with no warning')

  const w2 = await call('write_story', {
    momentId: moment,
    title: 'Letters',
    segments: [{ bodyText: 'Bad ref.', citations: [{ artifactId: 'does-not-exist' }] }],
  })
  assert(
    w2.warnings.some((m: string) => m.includes('not a registered artifact')),
    'an unknown artifactId is dropped to a warning, not a hard failure',
  )

  // === artifact-first browse feed (S2.4 data layer) =======================
  console.log('listArtifactsForTimeline — browse feed')
  const browse = listArtifactsForTimeline(TL)
  const a1row = browse.find((r) => r.artifact.id === a1)
  assert(!!a1row, 'browse includes a1 (linked to a moment AND anchoring a story)')
  assert(a1row!.moments.some((m) => m.id === moment), 'browse row lists the moment it sits on')
  assert(a1row!.stories.length >= 1, 'browse row lists the story it anchors')
  assert(!browse.some((r) => r.artifact.id === a2), 'browse excludes a2 (linked to nothing in this timeline)')

  await client.close()
  await server.close()
  console.log('\nS2.3 register_artifact + S2.5 search_artifacts + S2.4 browse feed ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
