import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { toolRegistry, makeRequireOwned, type ToolCtx, type ToolDef } from '../src/lib/mcp/registry'
import { makeRequireOwnedProject } from '../src/lib/db/projects'

// Live MCP-tool round-trip for the series layer (ADR 0006): drives the ACTUAL
// toolRegistry handlers (the same code both transports + the in-app agent run)
// through the morning-chapter loop, and verifies cross-owner denial. Run under
// Node 22: `bun run verify:series-tools`.

const A_EMAIL = 'stools-a@synek.app'
const B_EMAIL = 'stools-b@synek.app'

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
    await auth.api.signUpEmail({ body: { email, password: 'stools-pw-123', name: email } })
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

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  const ctxA: ToolCtx = { ownerId: a, requireOwned: makeRequireOwned(a), requireOwnedProject: makeRequireOwnedProject(a) }
  const ctxB: ToolCtx = { ownerId: b, requireOwned: makeRequireOwned(b), requireOwnedProject: makeRequireOwnedProject(b) }

  // Project + timeline + two moments via the real tools.
  const p = (await tool('create_project').handler({ title: 'Rome (series tools)' }, ctxA)) as { id: string }
  const tl = (await tool('create_timeline').handler({ title: 'Roman timeline', projectId: p.id }, ctxA)) as { id: string }
  const patched = (await tool('apply_patch').handler(
    {
      timelineId: tl.id,
      summary: 'seed moments',
      ops: [
        { op: 'add_node', ref: 'm1', type: 'event', title: 'The Founding', start: '-0509' },
        { op: 'add_node', ref: 'm2', type: 'event', title: 'The Punic Wars', start: '-0264' },
      ],
    },
    ctxA,
  )) as { results: Array<{ id: string }> }
  const [m1, m2] = patched.results.map((r) => r.id)
  assert(!!m1 && !!m2, 'two moments created via apply_patch')

  // create_series
  const s = (await tool('create_series').handler({ projectId: p.id, title: 'The Rise of the Republic', hook: 'how Rome became Rome' }, ctxA)) as {
    seriesId: string
    slug: string
    url: string
  }
  assert(!!s.seriesId && s.url.includes(`/sr/${s.slug}`), 'create_series returns a slug-addressable /sr url')

  // write_story appendToSeries → auto chapter numbers
  const c1 = (await tool('write_story').handler(
    { momentId: m1, title: 'Chapter I — Founding', appendToSeries: s.seriesId, segments: [{ bodyText: 'Rome is founded on seven hills.' }] },
    ctxA,
  )) as { storyId: string; chapterNumber: number }
  const c2 = (await tool('write_story').handler(
    {
      momentId: m2,
      title: 'Chapter II — Carthage',
      appendToSeries: s.seriesId,
      segments: [
        { bodyText: 'Rome and Carthage collide across the Mediterranean.', focusNodeId: m2 },
        { bodyText: 'Hannibal crosses the Alps.' },
      ],
    },
    ctxA,
  )) as { storyId: string; chapterNumber: number }
  assert(c1.chapterNumber === 1 && c2.chapterNumber === 2, 'appendToSeries auto-numbers chapters 1, 2')

  // get_series → ordered chapters + derived frontier
  const series = (await tool('get_series').handler({ seriesId: s.seriesId }, ctxA)) as {
    chapters: Array<{ chapterNumber: number; title: string; coveredNodeIds: string[] }>
    frontier: { lastChapterNumber: number | null; lastInstant: number | null }
  }
  assert(series.chapters.length === 2 && series.chapters[0]!.chapterNumber === 1, 'get_series returns chapters in order')
  assert(series.frontier.lastChapterNumber === 2 && series.frontier.lastInstant != null, 'get_series derives the frontier')
  assert(series.chapters[1]!.coveredNodeIds.includes(m2!), 'get_series reports per-chapter covered node ids (watermark)')

  // patch_story → surgical add, no nuke
  const patch = (await tool('patch_story').handler(
    { storyId: c2.storyId, ops: [{ op: 'add_segment', segment: { bodyText: 'Scipio answers at Zama.' } }] },
    ctxA,
  )) as { segmentCount: number }
  assert(patch.segmentCount === 3, 'patch_story add_segment grew chapter II to 3 beats (others kept)')

  // set_series_public → live season page
  const pub = (await tool('set_series_public').handler({ seriesId: s.seriesId, isPublic: true }, ctxA)) as { url: string }
  assert(pub.url.includes(`/sr/${s.slug}`), 'set_series_public returns the public season url')

  // Cross-owner denial across the new tools.
  await denied('B get_series(A)', () => tool('get_series').handler({ seriesId: s.seriesId }, ctxB))
  await denied('B patch_story(A chapter)', () => tool('patch_story').handler({ storyId: c1.storyId, ops: [{ op: 'update_meta', meta: { title: 'X' } }] }, ctxB))
  await denied('B set_series_public(A)', () => tool('set_series_public').handler({ seriesId: s.seriesId, isPublic: false }, ctxB))
  await denied('B create_series into A project', () => tool('create_series').handler({ projectId: p.id, title: 'intrude' }, ctxB))

  console.log(`\nseries MCP tools verified ✓   public season: /sr/${s.slug}`)
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
