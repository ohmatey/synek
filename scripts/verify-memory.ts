import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, getTimelineMemory, updateTimelineMemory } from '../src/lib/db/graph'
import { toolRegistry, makeRequireOwned } from '../src/lib/mcp/registry'
import { timelineMemoryUpdateSchema } from '../src/lib/domain/memory'

// Proves the per-timeline MEMORY path without the SDK or a model: the owner-scoped
// read/write, the FIELD-SCOPED merge that lets a keeper and the user share one
// column, and the MCP tools end to end.
//
// Every tool call here is parsed through the tool's own `inputSchema` FIRST. Both
// real callers (the MCP server and the in-app agent runner) do that, and a verify
// script that skips it silently passes on exactly the schema-drift bugs it exists
// to catch.
//
// Run under Node: `bun run verify:memory` (own DB via DATABASE_URL).

const TL = 'verify-memory'
const VERIFY_EMAIL = 'verify-memory@synek.app'
const OTHER_EMAIL = 'verify-memory-other@synek.app'

let failures = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++
    console.error(`  ✗ ${msg}`)
  } else {
    console.log(`  ✓ ${msg}`)
  }
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    // already exists
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create ${email}`)
  return row.id
}

// Call a registry tool the way the MCP server does: parse args through inputSchema,
// then hand the PARSED args to the handler.
async function callTool(name: string, rawArgs: unknown, ownerId: string) {
  const tool = toolRegistry.find((t) => t.name === name)
  if (!tool) throw new Error(`no such tool: ${name}`)
  const args = z.object(tool.inputSchema as Record<string, z.ZodTypeAny>).parse(rawArgs)
  return tool.handler(args, { ownerId, requireOwned: makeRequireOwned(ownerId) } as never)
}

async function main() {
  const ownerId = await ensureUser(VERIFY_EMAIL)
  const strangerId = await ensureUser(OTHER_EMAIL)
  ensureTimeline(TL, ownerId, 'Memory verify')

  console.log('\nzod contract')
  assert(timelineMemoryUpdateSchema.safeParse({}).success === false, 'an empty patch is rejected (no no-op writes)')
  assert(
    timelineMemoryUpdateSchema.safeParse({ coveredThrough: '10 Aug 2026' }).success === false,
    'a non-ISO date is rejected, which the old freeform log could not catch',
  )
  assert(
    timelineMemoryUpdateSchema.safeParse({ runs: [] }).success === false,
    'runs[] cannot be written directly — appendRun is the only way in',
  )

  console.log('\nowner scoping')
  assert(getTimelineMemory(TL, ownerId) === null, 'a fresh timeline has null memory')
  updateTimelineMemory(TL, ownerId, { notes: 'Prefer primary changelogs.' })
  assert(getTimelineMemory(TL, ownerId)?.notes === 'Prefer primary changelogs.', 'the owner reads back their notes')
  assert(getTimelineMemory(TL, strangerId) === null, 'a NON-OWNER reads null (owner check is in the query)')
  assert(
    updateTimelineMemory(TL, strangerId, { notes: 'pwned' }) === null,
    'a non-owner write no-ops and returns null',
  )
  assert(getTimelineMemory(TL, ownerId)?.notes === 'Prefer primary changelogs.', 'the notes survived the intruder')

  console.log('\nthe field-scoped merge (the reason the two regions can share one column)')
  updateTimelineMemory(TL, ownerId, {
    brief: 'AI tooling a 1-3 person team can ship on.',
    references: [{ title: 'OpenAI changelog', url: 'https://platform.openai.com/docs/changelog' }],
  })
  // A scheduled keeper logging a run must not touch anything the user owns.
  updateTimelineMemory(TL, ownerId, {
    appendRun: { date: '2026-08-17', routine: 'watch', summary: '+3 model releases', patchId: 'p1' },
    coveredThrough: '2026-08-17',
    watching: [{ item: 'Mistral Series C', firstSeen: '2026-08-17', promoteIf: 'a filing confirms the round' }],
  })
  let m = getTimelineMemory(TL, ownerId)!
  assert(m.notes === 'Prefer primary changelogs.', 'a keeper run did NOT clobber the user notes')
  assert(m.brief?.startsWith('AI tooling') === true, 'a keeper run did NOT clobber the brief')
  assert(m.references?.length === 1, 'a keeper run did NOT clobber the references')
  assert(m.runs?.length === 1 && m.runs[0].patchId === 'p1', 'the run was appended with its patchId')
  assert(m.coveredThrough === '2026-08-17', 'coveredThrough advanced')

  // …and the user editing notes must not drop the keeper's history.
  updateTimelineMemory(TL, ownerId, { notes: 'Prefer primary changelogs. Skip robotics.' })
  m = getTimelineMemory(TL, ownerId)!
  assert(m.runs?.length === 1, 'the user editing notes did NOT drop the run history')
  assert(m.watching?.length === 1, 'the user editing notes did NOT drop the watching list')
  assert(m.coveredThrough === '2026-08-17', 'the user editing notes did NOT reset coveredThrough')

  console.log('\nappendRun ordering')
  updateTimelineMemory(TL, ownerId, { appendRun: { date: '2026-08-24', summary: 'no new developments' } })
  m = getTimelineMemory(TL, ownerId)!
  assert(m.runs?.[0].date === '2026-08-24', 'newest run is first')
  assert(m.runs?.length === 2, 'the older run is still there')

  console.log('\nMCP tools (parsed through inputSchema, as the server does)')
  const report = (await callTool('get_layout_report', { timelineId: TL }, ownerId)) as { memory?: unknown }
  assert(report.memory != null, 'get_layout_report carries `memory`, so a keeper needs no second call')

  const wrote = (await callTool(
    'update_timeline_memory',
    { timelineId: TL, patch: { cadence: 'weekly (Mon 07:23)' } },
    ownerId,
  )) as { ok: boolean; memory: { cadence?: string; notes?: string } }
  assert(wrote.ok === true && wrote.memory.cadence === 'weekly (Mon 07:23)', 'update_timeline_memory writes cadence')
  assert(wrote.memory.notes === 'Prefer primary changelogs. Skip robotics.', 'the MCP write was field-scoped too')

  let rejected = false
  try {
    await callTool('update_timeline_memory', { timelineId: TL, patch: { lastRun: '2026-08-17' } }, ownerId)
  } catch {
    rejected = true
  }
  assert(rejected, 'an unknown patch key is an instructive error, not silently stripped')

  let guarded = false
  try {
    await callTool('update_timeline_memory', { timelineId: TL, patch: { notes: 'x' } }, strangerId)
  } catch {
    guarded = true
  }
  assert(guarded, 'the MCP tool refuses a non-owner (requireOwned)')

  console.log('\nclearing')
  updateTimelineMemory(TL, ownerId, { notes: '' })
  assert(getTimelineMemory(TL, ownerId)?.notes === undefined, 'an empty string clears a field')

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll memory checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
