import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch, undo, redo, historyState } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'

// Proves the MCP write path end-to-end WITHOUT the SDK or a model: a batch of ops
// (two add_node via `ref` + one add_edge referencing them) → one Patch → assert
// it landed → undo/redo → assert history. Run under Node: `bun run verify:mcp`.

const TL = 'verify-mcp'
const VERIFY_EMAIL = 'verify@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

// Timelines are owner-scoped now, so we need a real user to own the verify
// timeline. Create one (idempotent) via Better Auth, like the seed does.
async function ensureVerifyUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: VERIFY_EMAIL, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    // already exists — fine
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, VERIFY_EMAIL)).get()
  if (!row) throw new Error('could not create the verify user')
  return row.id
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'MCP verify')
  const before = loadGraph(TL)
  const beforeNodes = before.nodes.length
  const beforeEdges = before.edges.length

  const builder = new PatchBuilder(TL, before)
  const { results } = applyOps(builder, [
    { op: 'add_node', ref: 'a', type: 'event', title: 'Verify A', start: '2001' },
    { op: 'add_node', ref: 'b', type: 'event', title: 'Verify B', start: '2002' },
    { op: 'add_edge', sourceId: 'a', targetId: 'b', kind: 'caused' },
  ])
  assert(results.length === 3, '3 op results')
  assert(results.every((r) => 'id' in r), 'every op resolved to an id (no errors)')

  const patchId = commitPatch(TL, builder, 'verify batch')
  assert(!!patchId, 'commitPatch returned a patch id')

  const after = loadGraph(TL)
  assert(after.nodes.length === beforeNodes + 2, '2 nodes added')
  assert(after.edges.length === beforeEdges + 1, '1 edge added (ref resolved to real ids)')

  assert(historyState(TL).canUndo, 'canUndo after commit')
  assert(undo(TL), 'undo succeeded')
  const undone = loadGraph(TL)
  assert(undone.nodes.length === beforeNodes, 'undo removed the 2 nodes')
  assert(undone.edges.length === beforeEdges, 'undo removed the edge')

  assert(historyState(TL).canRedo, 'canRedo after undo')
  assert(redo(TL), 'redo succeeded')
  const redone = loadGraph(TL)
  assert(redone.nodes.length === beforeNodes + 2, 'redo restored the nodes')

  // Clean up so the script is idempotent.
  undo(TL)
  console.log('\nMCP op path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
