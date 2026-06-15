import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { toolRegistry, makeRequireOwned, type ToolCtx, type ToolDef } from '../src/lib/mcp/registry'
import { makeRequireOwnedProject } from '../src/lib/db/projects'

const A_EMAIL = 'ptools-a@synek.app'
const B_EMAIL = 'ptools-b@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}
async function denied(label: string, fn: () => Promise<unknown>) {
  try { await fn() } catch { console.log(`  ✓ denied: ${label}`); return }
  throw new Error(`LEAK: ${label} was NOT denied`)
}
async function ensureUser(email: string): Promise<string> {
  try { await auth.api.signUpEmail({ body: { email, password: 'ptools-pw-123', name: email } }) } catch {}
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

  const p = (await tool('create_project').handler({ title: 'A Roman Project' }, ctxA)) as { id: string; slug: string; url: string }
  assert(!!p.id && !!p.slug, 'A created a project (id + slug)')
  assert(p.url.includes(`/p/${p.slug}`), 'project url is slug-addressable (/p/$slug)')

  const aProjects = (await tool('list_projects').handler({}, ctxA)) as Array<{ id: string }>
  assert(aProjects.some((x) => x.id === p.id), 'A sees her project in list_projects')

  const got = (await tool('get_project').handler({ projectId: p.id }, ctxA)) as { id: string; timelines: unknown[] }
  assert(got.id === p.id, 'A can get_project her own')

  // create_timeline WITH the project id lands in that project
  const tl = (await tool('create_timeline').handler({ title: 'TL in project', projectId: p.id }, ctxA)) as { id: string; projectId: string }
  assert(tl.projectId === p.id, 'create_timeline(projectId) lands the timeline in that project')

  // list_timelines filtered by project returns it; with another project it does not
  const filtered = (await tool('list_timelines').handler({ projectId: p.id }, ctxA)) as Array<{ id: string }>
  assert(filtered.some((x) => x.id === tl.id), 'list_timelines(projectId) includes the project timeline')

  // create_timeline WITHOUT projectId still works (default project resolves)
  const tl2 = (await tool('create_timeline').handler({ title: 'TL no project' }, ctxA)) as { id: string; projectId: string }
  assert(!!tl2.projectId, 'create_timeline without projectId still gets a project (default)')

  // list_timelines WITHOUT a filter returns all of A's (today's behavior preserved)
  const all = (await tool('list_timelines').handler({}, ctxA)) as Array<{ id: string }>
  assert(all.some((x) => x.id === tl.id) && all.some((x) => x.id === tl2.id), 'list_timelines() returns ALL the owner timelines')

  // B is denied A's project + cannot create a timeline in it
  const bProjects = (await tool('list_projects').handler({}, ctxB)) as Array<{ id: string }>
  assert(!bProjects.some((x) => x.id === p.id), "B's list_projects excludes A's project")
  await denied('B get_project(A)', () => tool('get_project').handler({ projectId: p.id }, ctxB))
  await denied('B create_timeline into A project', () => tool('create_timeline').handler({ title: 'intrude', projectId: p.id }, ctxB))
  await denied('B list_timelines(A project)', () => tool('list_timelines').handler({ projectId: p.id }, ctxB))

  console.log('\nProject tools verified ✓')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
