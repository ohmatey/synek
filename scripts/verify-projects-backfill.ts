import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'

// Proves the migration-0020 BACKFILL leaves NO orphans and never cross-attaches a
// row to the wrong owner's project. It applies the full migration set (DDL only is
// idempotent), seeds a MULTI-USER populated dataset (the realistic upgrade case),
// then resets project_id to the pre-backfill state (null everywhere, no projects)
// and re-runs ONLY the backfill statements from 0020_*.sql — the exact SQL shipped.
// Run under Node: `bunx tsx scripts/verify-projects-backfill.ts` (or via the npm script).

const DB = path.resolve(process.cwd(), 'verify-projects-backfill.db')
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f)

const sqlite = new Database(DB)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
const db = drizzle(sqlite)

const drizzleDir = path.resolve(process.cwd(), 'drizzle')
migrate(db, { migrationsFolder: drizzleDir })

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`  ✓ ${msg}`)
}

const ms = Date.now()
const uid = () => sqlite.prepare('SELECT lower(hex(randomblob(16))) AS id').get() as { id: string }

// --- Seed a realistic multi-user pre-0020 dataset --------------------------
// Two users (A, B), each owning a timeline + a node + a linked artifact (via
// moment_artifacts) + that artifact's source. Plus one ORPHAN artifact for A
// (no linked timeline) to exercise the owner-default fallback. project_id is left
// NULL (the pre-backfill state) by NOT setting it on insert.
const A = uid().id
const B = uid().id
sqlite
  .prepare(`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
  .run(A, 'A', 'bf-a@synek.app', 1, ms, ms)
sqlite
  .prepare(`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
  .run(B, 'B', 'bf-b@synek.app', 1, ms, ms)

function seedOwner(owner: string, tag: string) {
  const tl = uid().id
  sqlite
    .prepare(`INSERT INTO timelines (id, owner_id, is_public, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(tl, owner, 0, `${tag} timeline`, ms, ms)
  const node = uid().id
  sqlite
    .prepare(
      `INSERT INTO nodes (id, timeline_id, type, title, start_instant, precision, created_at) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(node, tl, 'event', `${tag} node`, 0, 'year', ms)
  const src = uid().id
  sqlite
    .prepare(`INSERT INTO sources (id, owner_id, title, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run(src, owner, `${tag} source`, ms, ms)
  const art = uid().id
  sqlite
    .prepare(
      `INSERT INTO artifacts (id, owner_id, title, artifact_type, date_precision, source_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(art, owner, `${tag} artifact`, 'letter', 'year', src, ms, ms)
  sqlite.prepare(`INSERT INTO moment_artifacts (moment_id, artifact_id) VALUES (?,?)`).run(node, art)
  return { tl, node, src, art }
}

const aData = seedOwner(A, 'A')
const bData = seedOwner(B, 'B')

// Orphan artifact for A — owned, but linked to NO timeline (exercises owner-default).
const orphanArt = uid().id
sqlite
  .prepare(
    `INSERT INTO artifacts (id, owner_id, title, artifact_type, date_precision, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
  )
  .run(orphanArt, A, 'A orphan artifact', 'object', 'year', ms, ms)

// --- Reset to the pre-backfill state ---------------------------------------
// The migrator already ran 0020 (which auto-seeds default projects for owners).
// To exercise the SHIPPED backfill SQL against this populated data, blow away that
// state: drop the projects + null every project_id, then re-run the backfill block.
sqlite.exec('DELETE FROM projects')
sqlite.exec('UPDATE timelines SET project_id = NULL')
sqlite.exec('UPDATE artifacts SET project_id = NULL')
sqlite.exec('UPDATE sources SET project_id = NULL')

// --- Re-run ONLY the backfill statements from 0020_*.sql --------------------
const migFile = path
  .resolve(drizzleDir)
const sqlPath = path.join(migFile, '0020_abnormal_dexter_bennett.sql')
const full = readFileSync(sqlPath, 'utf8')
// The backfill begins at the first INSERT INTO `projects` ... SELECT (the DDL above
// it is CREATE TABLE/INDEX + ALTER ADD COLUMN, already applied by the migrator).
const backfillStart = full.indexOf('INSERT INTO `projects`')
assert(backfillStart > 0, 'located the hand-written backfill block in 0020_*.sql')
const backfill = full.slice(backfillStart)
for (const stmt of backfill.split('--> statement-breakpoint')) {
  const s = stmt.trim()
  if (s) sqlite.exec(s)
}

// --- Assert the no-orphan guarantee ----------------------------------------
const orphanTl = sqlite.prepare('SELECT COUNT(*) AS n FROM timelines WHERE project_id IS NULL').get() as { n: number }
const orphanArtN = sqlite.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id IS NULL').get() as { n: number }
const orphanSrc = sqlite.prepare('SELECT COUNT(*) AS n FROM sources WHERE project_id IS NULL').get() as { n: number }
assert(orphanTl.n === 0, 'every timeline has a non-null project_id after backfill')
assert(orphanArtN.n === 0, 'every artifact (incl. the orphan) has a non-null project_id after backfill')
assert(orphanSrc.n === 0, 'every source has a non-null project_id after backfill')

// --- One default project per owner -----------------------------------------
const projCount = sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }
assert(projCount.n === 2, 'exactly one default project per owner (2 owners → 2 projects)')
const aProj = sqlite.prepare('SELECT id FROM projects WHERE owner_id = ?').get(A) as { id: string }
const bProj = sqlite.prepare('SELECT id FROM projects WHERE owner_id = ?').get(B) as { id: string }
assert(!!aProj && !!bProj && aProj.id !== bProj.id, "A and B each got their OWN default project")

// --- No cross-tenant attachment (the fail-closed property) ------------------
const aTlProj = sqlite.prepare('SELECT project_id FROM timelines WHERE id = ?').get(aData.tl) as { project_id: string }
const bTlProj = sqlite.prepare('SELECT project_id FROM timelines WHERE id = ?').get(bData.tl) as { project_id: string }
assert(aTlProj.project_id === aProj.id, "A's timeline attached to A's project")
assert(bTlProj.project_id === bProj.id, "B's timeline attached to B's project")
const aArtProj = sqlite.prepare('SELECT project_id FROM artifacts WHERE id = ?').get(aData.art) as { project_id: string }
const bArtProj = sqlite.prepare('SELECT project_id FROM artifacts WHERE id = ?').get(bData.art) as { project_id: string }
assert(aArtProj.project_id === aProj.id, "A's linked artifact inherited A's project via its timeline")
assert(bArtProj.project_id === bProj.id, "B's linked artifact inherited B's project via its timeline")
const orphanProj = sqlite.prepare('SELECT project_id FROM artifacts WHERE id = ?').get(orphanArt) as {
  project_id: string
}
assert(orphanProj.project_id === aProj.id, "A's orphan artifact fell back to A's default project (never B's)")
const aSrcProj = sqlite.prepare('SELECT project_id FROM sources WHERE id = ?').get(aData.src) as { project_id: string }
assert(aSrcProj.project_id === aProj.id, "A's source inherited A's project via its artifact")

// --- No B-owned row ever points at A's project (or vice versa) --------------
const cross = sqlite
  .prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT owner_id, project_id FROM timelines WHERE project_id IS NOT NULL
       UNION ALL SELECT owner_id, project_id FROM artifacts WHERE project_id IS NOT NULL
       UNION ALL SELECT owner_id, project_id FROM sources WHERE project_id IS NOT NULL
     ) r JOIN projects p ON p.id = r.project_id WHERE p.owner_id <> r.owner_id`,
  )
  .get() as { n: number }
assert(cross.n === 0, 'NO owned row points at another owner\'s project (fail-closed, no cross-tenant attachment)')

sqlite.close()
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f)
console.log('\nMigration 0020 backfill verified ✓  (no orphans, one project per owner, no cross-tenant attachment)')
