import { eq } from 'drizzle-orm'
import { z } from 'zod'
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
// Call a tool THE WAY A CLIENT DOES: validate the args against the tool's own
// inputSchema first, then run the handler on the PARSED args — the MCP SDK
// (registerTool) and the agent runner (runner.ts) both do exactly this. Calling the
// handler directly would skip the Zod boundary, which is where a field the schema
// forgot gets silently stripped — the bug this script exists to catch.
const call = async (name: string, args: unknown, ctx: ToolCtx): Promise<any> => {
  const t = tool(name)
  return t.handler(z.object(t.inputSchema).parse(args), ctx)
}

type Citation = { artifactId?: string; excerptUsed?: string; title?: string; quote?: string }
type Beat = { id: string; sequence: number; bodyText: string; citations?: Citation[] }
type Story = {
  storyId: string
  momentId: string
  timelineId: string
  title: string
  status: string
  isPublic: boolean
  url: string | null
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
  const p = (await call('create_project', { title: 'Apollo (get_story)' }, ctxA)) as { id: string }
  const tl = (await call('create_timeline', { title: 'Apollo programme', projectId: p.id }, ctxA)) as { id: string }
  const patched = (await call('apply_patch', 
    { timelineId: tl.id, summary: 'seed moment', ops: [{ op: 'add_node', ref: 'm', type: 'event', title: 'Apollo 11 lands', start: '1969-07-20' }] },
    ctxA,
  )) as { results: Array<{ id: string }> }
  const moment = patched.results[0]!.id
  const s = (await call('create_series', { projectId: p.id, title: 'Moonshot' }, ctxA)) as { seriesId: string }
  // A registered artifact cited by beat one — the citation shape that has to survive
  // a read → re-send round-trip (the reader's DTO projects its excerpt into `quote`).
  const art = (await call('register_artifact', 
    { title: 'Apollo 11 air-to-ground voice transcription', artifactType: 'document', transcript: 'Houston, Tranquility Base here.' },
    ctxA,
  )) as { artifactId: string }
  const written = (await call('write_story', 
    {
      momentId: moment,
      title: 'The Eagle has landed',
      appendToSeries: s.seriesId,
      segments: [
        { bodyText: 'Beat one: powered descent begins.', citations: [{ artifactId: art.artifactId, excerptUsed: 'Houston, Tranquility Base here.' }] },
        { bodyText: 'Beat two: the 1202 alarm.' },
        { bodyText: 'Beat three: contact light.' },
      ],
    },
    ctxA,
  )) as { storyId: string }

  // (1) DISCOVERY — get_node hands back the story id, which get_story accepts.
  console.log('\n(1) find the story, then read it back')
  const node = (await call('get_node', { nodeId: moment }, ctxA)) as { stories: Array<{ storyId: string; beatCount: number }> }
  assert(node.stories.some((x) => x.storyId === written.storyId), 'get_node lists the story id on the moment')
  assert(node.stories[0]!.beatCount === 3, 'get_node reports a beat COUNT (but no beat ids — that is get_story)')

  const read = (await call('get_story', { storyId: written.storyId }, ctxA)) as Story
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
  assert(read.isPublic === false && read.url === null, 'no share url while the story is private (that link would 404)')

  // (2) PATCH ONE BEAT BY ID — the loop that was impossible from MCP.
  console.log('\n(2) patch one beat by the id we just read')
  const target = read.beats[1]!
  await call('patch_story', 
    { storyId: read.storyId, ops: [{ op: 'update_segment', segmentId: target.id, segment: { bodyText: 'Beat two: the 1202 program alarm — Bales calls GO.' } }] },
    ctxA,
  )
  const after = (await call('get_story', { storyId: read.storyId }, ctxA)) as Story
  assert(after.beats[1]!.bodyText.includes('Bales calls GO'), 'the targeted beat changed')
  assert(after.beats[0]!.bodyText === read.beats[0]!.bodyText && after.beats[2]!.bodyText === read.beats[2]!.bodyText, 'the untouched beats are untouched')
  assert(after.beats.map((x) => x.id).join() === read.beats.map((x) => x.id).join(), 'beat ids are stable across the edit (re-readable)')

  // (3) The other id-keyed ops now have a source for their ids too.
  console.log('\n(3) reorder + delete by the same ids')
  const flipped = [after.beats[2]!.id, after.beats[1]!.id, after.beats[0]!.id]
  await call('patch_story', { storyId: read.storyId, ops: [{ op: 'reorder_segments', order: flipped }] }, ctxA)
  const reordered = (await call('get_story', { storyId: read.storyId }, ctxA)) as Story
  assert(reordered.beats.map((x) => x.id).join() === flipped.join(), 'reorder_segments applied the order we read back')

  await call('patch_story', { storyId: read.storyId, ops: [{ op: 'delete_segment', segmentId: flipped[1]! }] }, ctxA)
  const trimmed = (await call('get_story', { storyId: read.storyId }, ctxA)) as Story
  assert(trimmed.beatCount === 2 && !trimmed.beats.some((x) => x.id === flipped[1]), 'delete_segment removed exactly that beat')

  // (4) What get_story emits, patch_story must accept — re-sending a beat's citations
  // verbatim (they REPLACE, not merge) must not quietly strip the artifact's excerpt.
  console.log('\n(4) citations round-trip through patch_story')
  const cited = trimmed.beats.find((x) => x.citations?.length)!
  const citation = cited.citations![0]!
  assert(citation.artifactId === art.artifactId && citation.excerptUsed === 'Houston, Tranquility Base here.', 'an artifact citation comes back as { artifactId, excerptUsed }')
  await call('patch_story', 
    { storyId: read.storyId, ops: [{ op: 'update_segment', segmentId: cited.id, segment: { bodyText: cited.bodyText, citations: cited.citations } }] },
    ctxA,
  )
  const resent = (await call('get_story', { storyId: read.storyId }, ctxA)) as Story
  const after4 = resent.beats.find((x) => x.id === cited.id)!
  assert(after4.citations?.[0]?.artifactId === art.artifactId, 'the artifact link survived the re-send')
  assert(after4.citations?.[0]?.excerptUsed === 'Houston, Tranquility Base here.', 'so did its excerpt (not silently dropped)')

  // (5) update_meta `cast` — advertised in the tool description and supported by the
  // db layer, but missing from the Zod schema, so a client's cast was silently
  // stripped. It is the documented fix for write_story's "cast without nodes" warning.
  console.log('\n(5) update_meta cast lands (it used to vanish at the schema boundary)')
  const armstrong = (await call('apply_patch', 
    { timelineId: tl.id, summary: 'cast node', ops: [{ op: 'add_node', ref: 'a', type: 'entity', title: 'Neil Armstrong', start: '1930-08-05' }] },
    ctxA,
  )) as { results: Array<{ id: string }> }
  const castPatch = (await call('patch_story', 
    {
      storyId: read.storyId,
      ops: [{ op: 'update_meta', meta: { cast: [{ nodeId: armstrong.results[0]!.id, role: 'the commander' }, { name: 'Michael Collins', role: 'in orbit' }] } }],
    },
    ctxA,
  )) as { warnings: string[] }
  const withCast = (await call('get_story', { storyId: read.storyId }, ctxA)) as Story & { cast: Array<{ nodeId?: string; name?: string; role?: string }> }
  assert(withCast.cast.length === 2 && withCast.cast[0]!.nodeId === armstrong.results[0]!.id, 'the cast was actually written (readable via get_story)')
  assert(castPatch.warnings.some((w) => w.includes('Michael Collins')), 'a name-only cast member still warns, same as write_story')

  // (6) A published story reports the share link it actually has.
  console.log('\n(6) share url appears on publish')
  await call('patch_story', { storyId: read.storyId, ops: [{ op: 'update_meta', meta: { isPublic: true } }] }, ctxA)
  const shared = (await call('get_story', { storyId: read.storyId }, ctxA)) as Story
  assert(shared.isPublic && !!shared.url && shared.url.includes('/s/'), 'get_story returns the /s/ url once the story is public')

  // (6) Owner scope — a story read is no wider than the timeline it hangs off.
  console.log('\n(7) owner scope')
  await denied('B get_story(A story)', () => call('get_story', { storyId: read.storyId }, ctxB))
  await denied('get_story(unknown id)', () => call('get_story', { storyId: 'no-such-story' }, ctxA))

  console.log('\nget_story → patch_story round-trip verified ✓')
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
