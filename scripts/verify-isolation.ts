import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { toolRegistry, makeRequireOwned, type ToolCtx, type ToolDef } from '../src/lib/mcp/registry'
import { existingArtifactIds } from '../src/lib/db/artifacts'
import { setUserOpenRouterKey, getUserSettingsRow } from '../src/lib/db/user-settings'
import { encryptSecret, decryptSecret } from '../src/lib/crypto/secrets'

// Proves PER-USER ISOLATION (Phase 2): user B can reach NONE of user A's data via
// the shared tool surface, and A's artifact search/citation-validation never crosses
// to B. Runs against the real DB layer + MCP registry handlers (the isolation
// boundary) — no model, no HTTP. Run under Node: `bun run verify:isolation`.

const A_EMAIL = 'iso-a@synek.app'
const B_EMAIL = 'iso-b@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

// A tool call that MUST be rejected for a non-owner (handlers throw "not found").
async function denied(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch {
    console.log(`  ✓ denied: ${label}`)
    return
  }
  throw new Error(`LEAK: ${label} was NOT denied for the non-owner`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'isolation-pw-123', name: email } })
  } catch {
    /* already exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create user ${email}`)
  return row.id
}

const tool = (name: string): ToolDef => {
  const t = toolRegistry.find((x) => x.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return t
}

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  assert(a !== b, 'two distinct users exist')
  const ctxA: ToolCtx = { ownerId: a, requireOwned: makeRequireOwned(a) }
  const ctxB: ToolCtx = { ownerId: b, requireOwned: makeRequireOwned(b) }

  // --- A builds private data ------------------------------------------------
  const tl = (await tool('create_timeline').handler({ title: 'A private timeline' }, ctxA)) as { id: string }
  assert(!!tl.id, 'A created a timeline')

  const patch = (await tool('apply_patch').handler(
    { timelineId: tl.id, summary: 'seed', ops: [{ op: 'add_node', type: 'event', title: 'AlphaSecretNode', start: '1999' }] },
    ctxA,
  )) as { results: Array<{ id?: string }> }
  const nodeId = patch.results[0]?.id
  assert(!!nodeId, 'A added a node')

  const art = (await tool('register_artifact').handler(
    { title: 'Alpha secret letter', artifactType: 'letter', transcript: 'alphasecrettranscript unique words' },
    ctxA,
  )) as { artifactId: string }
  assert(!!art.artifactId, 'A registered a standalone artifact')

  // --- A can see her own ----------------------------------------------------
  const aList = (await tool('list_timelines').handler({}, ctxA)) as Array<{ id: string }>
  assert(aList.some((t) => t.id === tl.id), 'A sees her own timeline in list_timelines')
  const aSearch = (await tool('search_artifacts').handler({ query: 'alphasecrettranscript' }, ctxA)) as { results: unknown[] }
  assert(aSearch.results.length === 1, 'A finds her own artifact via search')
  assert(existingArtifactIds([art.artifactId], a).has(art.artifactId), 'A can validate her own artifact id')

  // --- B is denied / sees nothing of A's ------------------------------------
  const bList = (await tool('list_timelines').handler({}, ctxB)) as Array<{ id: string }>
  assert(!bList.some((t) => t.id === tl.id), "B's list_timelines excludes A's timeline")

  await denied('B get_timeline(A)', () => tool('get_timeline').handler({ timelineId: tl.id }, ctxB))
  await denied('B query_timeline(A)', () => tool('query_timeline').handler({ timelineId: tl.id }, ctxB))
  await denied('B get_layout_report(A)', () => tool('get_layout_report').handler({ timelineId: tl.id }, ctxB))
  await denied('B get_node(A.node)', () => tool('get_node').handler({ nodeId }, ctxB))
  await denied('B set_timeline_view(A)', () => tool('set_timeline_view').handler({ timelineId: tl.id, pxPerDay: 5 }, ctxB))
  await denied('B undo(A)', () => tool('undo').handler({ timelineId: tl.id }, ctxB))
  await denied('B apply_patch(A)', () =>
    tool('apply_patch').handler(
      { timelineId: tl.id, summary: 'intrude', ops: [{ op: 'add_node', type: 'event', title: 'BIntruder', start: '2000' }] },
      ctxB,
    ),
  )

  const bSearch = (await tool('search_artifacts').handler({ query: 'alphasecrettranscript' }, ctxB)) as { results: unknown[] }
  assert(bSearch.results.length === 0, "B's artifact search does NOT return A's artifact")
  assert(!existingArtifactIds([art.artifactId], b).has(art.artifactId), "B cannot validate (cite) A's artifact id")

  // --- per-user BYO key store (encrypted at rest, isolated) ------------------
  const aKey = 'sk-or-v1-alpha-secret-key'
  setUserOpenRouterKey(a, encryptSecret(aKey), aKey.slice(0, 12))
  const aRow = getUserSettingsRow(a)!
  assert(!!aRow.openRouterKeyEnc && aRow.openRouterKeyEnc !== aKey, "A's OpenRouter key is stored ENCRYPTED, not plaintext")
  assert(aRow.openRouterKeyEnc!.startsWith('v1:'), 'stored key uses the versioned AES-GCM blob format')
  assert(decryptSecret(aRow.openRouterKeyEnc!) === aKey, 'A key decrypts back to the original (server-side only)')
  const bRow = getUserSettingsRow(b)
  assert(!bRow?.openRouterKeyEnc, "B has no stored key — per-user settings are isolated")

  console.log('\nPer-user isolation verified ✓  (B reached none of A\'s timelines, nodes, history, artifacts, or key)')
}

main()
