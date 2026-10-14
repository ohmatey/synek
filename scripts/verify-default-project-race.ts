import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { projects } from '../src/lib/db/schema'
import { user } from '../src/lib/db/auth-schema'
import { ensureDefaultProject } from '../src/lib/db/projects'

// ensureDefaultProject is a read-then-insert. better-sqlite3 is synchronous, so two
// calls cannot interleave inside ONE process; the race is across processes (the app
// and the stdio MCP server share the DB file). This harness proves the cross-process
// case: WORKERS processes are released at the same instant and each calls
// ensureDefaultProject for the SAME fresh owners, in the same order. Exactly one
// project per owner must result.
//
// Probabilistic by nature: it can only fail when the race window is actually hit, so
// a pass is evidence, not proof. The guarantee itself comes from BEGIN IMMEDIATE
// taking the write lock before the read. Run under Node: `bun run verify:default-project`.

const OWNERS = 40
const WORKERS = 4

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

const ownerIds = Array.from({ length: OWNERS }, (_, i) => `race-owner-${i}`)

async function worker(startAt: number) {
  while (Date.now() < startAt) {
    /* spin to the barrier so every worker starts hammering together */
  }
  for (const id of ownerIds) ensureDefaultProject(id)
}

async function parent() {
  // Fresh state: owners are re-created each run, their projects cascade away with them.
  db.delete(user).where(sql`${user.id} like 'race-owner-%'`).run()
  const now = new Date()
  db.insert(user)
    .values(ownerIds.map((id) => ({ id, name: id, email: `${id}@race.test`, createdAt: now, updatedAt: now })))
    .run()

  const startAt = Date.now() + 4000 // workers boot (~1-2s) before the barrier
  const file = fileURLToPath(import.meta.url)
  const exits = await Promise.all(
    Array.from(
      { length: WORKERS },
      () =>
        new Promise<number>((resolve) => {
          const child = spawn(process.execPath, ['--import', 'tsx', file, 'worker', String(startAt)], {
            stdio: 'inherit',
            env: process.env,
          })
          child.on('exit', (code) => resolve(code ?? 1))
        }),
    ),
  )
  assert(exits.every((c) => c === 0), `all ${WORKERS} workers finished cleanly (a lock timeout would show here)`)

  const rows = db.select({ ownerId: projects.ownerId, id: projects.id }).from(projects).all()
  const counts = new Map<string, number>()
  for (const r of rows) if (r.ownerId?.startsWith('race-owner-')) counts.set(r.ownerId, (counts.get(r.ownerId) ?? 0) + 1)
  const dupes = [...counts.entries()].filter(([, n]) => n > 1)
  assert(counts.size === OWNERS, `every one of ${OWNERS} owners got a default project`)
  assert(dupes.length === 0, `no owner got more than one project (${dupes.length} duplicated of ${OWNERS})`)

  db.delete(user).where(sql`${user.id} like 'race-owner-%'`).run()
  console.log('\nensureDefaultProject cross-process race verified ✓')
  process.exit(0)
}

const isWorker = process.argv[2] === 'worker'
;(isWorker ? worker(Number(process.argv[3])).then(() => process.exit(0)) : parent()).catch((e) => {
  console.error(e)
  process.exit(1)
})
