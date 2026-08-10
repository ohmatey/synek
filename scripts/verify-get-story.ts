import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { toolRegistry, makeRequireOwned, type ToolCtx, type ToolDef } from '../src/lib/mcp/registry'
import { makeRequireOwnedProject } from '../src/lib/db/projects'

// The read-then-patch loop an EXTERNAL MCP client has to be able to run: find a
// story, read its beat ids back, then edit ONE beat by id — without resending the
// whole story. Before get_story no read returned a segmentId, so patch_story's
// update/delete/reorder ops were unreachable from a BYO client. Drives the ACTUAL
// toolRegistry handlers (both transports + the in-app agent run these).
// Run under Node 22: `bun run verify:get-story`.

const A_EMAIL = 'getstory-a@synek.app'
const B_EMAIL = 'getstory-b@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}
async function denied(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch {
    console.log(`  ✓ denied: ${label}`)
    return
  }
  throw new Error(`LEAK: ${label} was NOT denied`)
}
async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'getstory-pw-123', name: email } })
  } catch {}
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`no user ${email}`)
  return row.id
}
const tool = (name: string): ToolDef => {
  const t = toolRegistry.find((x) => x.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return t
}

type Beat = { id: string; sequence: number; bodyText: string }
type Story = {
  storyId: string
  momentId: string
  timelineId: string
  title: string
  status: string
  seriesId: string | null
  chapterNumber: number | null
  beatCount: number
  beats: Beat[]
}

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  const ctxA: ToolCtx = { ownerId: a, requireOwned: makeRequireOwned(a), requireOwnedProject: makeRequireOwnedProject(a) }
  const ctxB: ToolCtx = { ownerId: b, requireOwned: makeRequireOwned(b), requireOwnedProject: makeRequireOwnedProject(b) }

  // A moment + a chapter with three beats, written the way a client would.
  const p = (await tool('create_project').handler({ title: 'Apollo (get_story)' }, ctxA)) as { id: string }
  const tl = (await tool('create_timeline').handler({ title: 'Apollo programme', projectId: p.id }, ctxA)) as { id: string }
  const patched = (await tool('apply_patch').handler(
    { timelineId: tl.id, summary: 'seed moment', ops: [{ op: 'add_node', ref: 'm', type: 'event', title: 'Apollo 11 lands', start: '1969-07-20' }] },
    ctxA,
  )) as { results: Array<{ id: string }> }
  const moment = patched.results[0]!.id
  const s = (await tool('create_series').handler({ projectId: p.id, title: 'Moonshot' }, ctxA)) as { seriesId: string }
  const written = (await tool('write_story').handler(
    {
      momentId: moment,
      title: 'The Eagle has landed',
      appendToSeries: s.seriesId,
      segments: [
        { bodyText: 'Beat one: powered descent begins.' },
        { bodyText: 'Beat two: the 1202 alarm.' },
        { bodyText: 'Beat three: contact light.' },
      ],
    },
    ctxA,
  )) as { storyId: string }

  // (1) DISCOVERY — get_node hands back the story id, which get_story accepts.
  console.log('\n(1) find the story, then read it back')
  const node = (await tool('get_node').handler({ nodeId: moment }, ctxA)) as { stories: Array<{ storyId: string; beatCount: number }> }
  assert(node.stories.some((x) => x.storyId === written.storyId), 'get_node lists the story id on the moment')
  assert(node.stories[0]!.beatCount === 3, 'get_node reports a beat COUNT (but no beat ids — that is get_story)')

  const read = (await tool('get_story').handler({ storyId: written.storyId }, ctxA)) as Story
  assert(read.storyId === written.storyId && read.momentId === moment && read.timelineId === tl.id, 'get_story returns the story + its moment/timeline')
  assert(read.beatCount === 3 && read.beats.length === 3, 'get_story returns all three beats')
  assert(
    read.beats.every((x) => typeof x.id === 'string' && x.id.length > 0),
    'every beat carries an id — the segmentId patch_story edits by',
  )
  assert(
    read.beats.map((x) => x.sequence).join(',') === '0,1,2' || read.beats.every((x, i) => i === 0 || x.sequence > read.beats[i - 1]!.sequence),
    'beats come back in sequence order',
  )
  assert(read.seriesId === s.seriesId && read.chapterNumber === 1 && read.status === 'published', 'get_story reports chapter placement + publish status')

  // (2) PATCH ONE BEAT BY ID — the loop that was impossible from MCP.
  console.log('\n(2) patch one beat by the id we just read')
  const target = read.beats[1]!
  await tool('patch_story').handler(
    { storyId: read.storyId, ops: [{ op: 'update_segment', segmentId: target.id, segment: { bodyText: 'Beat two: the 1202 program alarm — Bales calls GO.' } }] },
    ctxA,
  )
  const after = (await tool('get_story').handler({ storyId: read.storyId }, ctxA)) as Story
  assert(after.beats[1]!.bodyText.includes('Bales calls GO'), 'the targeted beat changed')
  assert(after.beats[0]!.bodyText === read.beats[0]!.bodyText && after.beats[2]!.bodyText === read.beats[2]!.bodyText, 'the untouched beats are untouched')
  assert(after.beats.map((x) => x.id).join() === read.beats.map((x) => x.id).join(), 'beat ids are stable across the edit (re-readable)')

  // (3) The other id-keyed ops now have a source for their ids too.
  console.log('\n(3) reorder + delete by the same ids')
  const flipped = [after.beats[2]!.id, after.beats[1]!.id, after.beats[0]!.id]
  await tool('patch_story').handler({ storyId: read.storyId, ops: [{ op: 'reorder_segments', order: flipped }] }, ctxA)
  const reordered = (await tool('get_story').handler({ storyId: read.storyId }, ctxA)) as Story
  assert(reordered.beats.map((x) => x.id).join() === flipped.join(), 'reorder_segments applied the order we read back')

  await tool('patch_story').handler({ storyId: read.storyId, ops: [{ op: 'delete_segment', segmentId: flipped[1]! }] }, ctxA)
  const trimmed = (await tool('get_story').handler({ storyId: read.storyId }, ctxA)) as Story
  assert(trimmed.beatCount === 2 && !trimmed.beats.some((x) => x.id === flipped[1]), 'delete_segment removed exactly that beat')

  // (4) Owner scope — a story read is no wider than the timeline it hangs off.
  console.log('\n(4) owner scope')
  await denied('B get_story(A story)', () => tool('get_story').handler({ storyId: read.storyId }, ctxB))
  await denied('get_story(unknown id)', () => tool('get_story').handler({ storyId: 'no-such-story' }, ctxA))

  console.log('\nget_story → patch_story round-trip verified ✓')
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
