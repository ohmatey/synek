import { eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db, sqlite } from '../src/lib/db'
import { user, timelines, artifacts, sources } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import {
  listProjects,
  createProject,
  getProject,
  getProjectMeta,
  getProjectBySlug,
  updateProject,
  deleteProject,
  ensureDefaultProject,
  makeRequireOwnedProject,
} from '../src/lib/db/projects'
import {
  createTimeline,
  ensureTimeline,
  listTimelines,
  getTimelineMeta,
  moveTimelineToProject,
  setTimelinePublic,
  resolveTimelineTheme,
} from '../src/lib/db/graph'
import { registerArtifact } from '../src/lib/db/artifacts'

// Projects contract test (ADR 0002), at the DATA layer — the same boundary
// verify-isolation.ts exercises, one container level up. Proves the five
// invariants the Projects spine must hold:
//   (a) project CRUD is owner-scoped (a non-owner mutation no-ops; reads own-check)
//   (b) a second owner CANNOT read / get / move into the first owner's project
//   (c) after migration every timeline/artifact/source has a project (the
//       write-path invariant for timelines + the shipped 0020 backfill for the
//       corpus rows that the runtime write path leaves null)
//   (d) the listTimelines(projectId) filter narrows correctly WITHIN one owner
//   (e) sharing is still PER-TIMELINE — isPublic is untouched by the Projects
//       layer and confers NO project visibility (no leak via the container)
// Run under Node: `bun run verify:projects`.

const A_EMAIL = 'proj-a@synek.app'
const B_EMAIL = 'proj-b@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

// A db-layer guard call that MUST throw for a non-owner.
function denied(label: string, fn: () => unknown) {
  try {
    fn()
  } catch {
    console.log(`  ✓ denied: ${label}`)
    return
  }
  throw new Error(`LEAK: ${label} was NOT denied for the non-owner`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'projects-pw-123', name: email } })
  } catch {
    /* already exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create user ${email}`)
  return row.id
}

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  assert(a !== b, 'two distinct users exist')
  const requireOwnedProjectA = makeRequireOwnedProject(a)
  const requireOwnedProjectB = makeRequireOwnedProject(b)

  // === (a) project CRUD is owner-scoped ====================================
  console.log('\n(a) project CRUD is owner-scoped')
  const pA = createProject('A Roman Republic', a, { description: 'A private project' })
  assert(!!pA.id && !!pA.slug, 'A created a project (id + slug)')
  assert(pA.ownerId === a, "the new project is owned by A")
  assert(pA.kind === 'nonfiction', 'slice-1 project defaults to kind=nonfiction')

  const aProjects = listProjects(a)
  assert(aProjects.some((p) => p.id === pA.id), 'A sees her own project in listProjects')

  const got = getProjectMeta(pA.id)
  assert(got?.id === pA.id && got.ownerId === a, "getProjectMeta returns A's project with her ownerId")

  // owner-scoped UPDATE by the owner takes effect
  updateProject(pA.id, a, { title: 'A Roman Empire' })
  assert(getProjectMeta(pA.id)?.title === 'A Roman Empire', "A's own updateProject renamed the project")

  // requireOwnedProject passes for the owner, throws for everyone else
  requireOwnedProjectA(pA.id)
  console.log('  ✓ requireOwnedProject(A) accepts A\'s own project')

  // ensureDefaultProject is idempotent (returns the newest existing, never a dup)
  const before = listProjects(a).length
  const def1 = ensureDefaultProject(a)
  const def2 = ensureDefaultProject(a)
  assert(def1 === def2, 'ensureDefaultProject is idempotent (same id on repeat)')
  assert(listProjects(a).length === before, 'ensureDefaultProject did NOT create a duplicate when one exists')

  // === (b) cross-owner denial: B cannot read / get / move into A's project ==
  console.log('\n(b) cross-owner denial')
  const bProjects = listProjects(b)
  assert(!bProjects.some((p) => p.id === pA.id), "B's listProjects excludes A's project")

  // The guard B would run for A's id must throw (this is the boundary the server
  // fn + MCP ctx both use to fail-closed).
  denied('B requireOwnedProject(A project)', () => requireOwnedProjectB(pA.id))

  // getProjectMeta is not owner-scoped (the caller own-checks) — confirm the
  // ownerId it returns is A's so a non-owner check correctly rejects.
  assert(getProjectMeta(pA.id)?.ownerId === a, "getProjectMeta(A project).ownerId is A, never B (own-check sees the truth)")

  // B's owner-scoped MUTATIONS on A's project no-op (0 rows matched) — the title
  // stays what A set, B cannot rename, re-theme, or delete A's container.
  updateProject(pA.id, b, { title: 'B HIJACK' })
  assert(getProjectMeta(pA.id)?.title === 'A Roman Empire', "B's updateProject on A's project NO-OPS (title unchanged)")
  deleteProject(pA.id, b)
  assert(!!getProjectMeta(pA.id), "B's deleteProject on A's project NO-OPS (project still exists)")

  // B cannot MOVE a timeline into A's project: createTimeline trusts its caller,
  // so the security check lives in requireOwnedProject — prove that guard denies B
  // for A's project id (the exact call the create_timeline tool makes before write).
  denied('B move-into A project (requireOwnedProject guard)', () => requireOwnedProjectB(pA.id))

  // === (c) every timeline / artifact / source has a project ================
  console.log('\n(c) every timeline / artifact / source has a project')

  // timelines: BOTH write paths set project_id at write time (the runtime invariant)
  const tlExplicit = createTimeline('A explicit-project timeline', a, pA.id)
  assert(tlExplicit.projectId === pA.id, 'createTimeline(projectId) attaches that project')
  const tlDefault = createTimeline('A default-project timeline', a)
  assert(!!tlDefault.projectId, 'createTimeline() without a project still attaches the owner default (never null)')
  const ensureId = 'verify-projects-ensure-tl'
  ensureTimeline(ensureId, a)
  assert(!!getTimelineMeta(ensureId)?.projectId, 'ensureTimeline (apply_patch build-as-you-go path) also attaches a project')

  // No owner-A timeline is ever orphaned at the write path.
  const aTimelineRows = db.select().from(timelines).where(eq(timelines.ownerId, a)).all()
  assert(
    aTimelineRows.length > 0 && aTimelineRows.every((t) => t.projectId != null),
    'EVERY owner-A timeline row has a non-null project_id (write-path invariant)',
  )

  // artifacts/sources: the runtime registerArtifact does NOT set project_id (it is
  // assigned by the migration backfill). Register a corpus row to create the
  // pre-backfill state, then run the SHIPPED 0020 backfill SQL and prove it leaves
  // NO orphan for this owner and never cross-attaches.
  const reg = registerArtifact({
    ownerId: a,
    artifact: { title: 'A charter', artifactType: 'document', transcript: 'projects verify corpus row' },
    source: { title: 'A archive' },
  })
  assert(!!reg.artifactId && !!reg.sourceId, 'A registered an artifact + source (corpus rows)')
  const artBefore = db.select().from(artifacts).where(eq(artifacts.id, reg.artifactId)).get()
  assert(artBefore?.projectId == null, 'runtime registerArtifact leaves project_id null (backfill assigns it) — documents the gap')

  // Apply ONLY the backfill block of the shipped migration (the DDL above it is
  // already applied by db/index.ts's migrate-on-load; re-running it would error,
  // so slice to the first INSERT INTO projects … like verify-projects-backfill.ts).
  const sqlPath = path.resolve(process.cwd(), 'drizzle', '0020_abnormal_dexter_bennett.sql')
  const full = readFileSync(sqlPath, 'utf8')
  const start = full.indexOf('INSERT INTO `projects`')
  assert(start > 0, 'located the hand-written backfill block in 0020_*.sql')
  for (const stmt of full.slice(start).split('--> statement-breakpoint')) {
    const s = stmt.trim()
    if (s) sqlite.exec(s)
  }

  const artAfter = db.select().from(artifacts).where(eq(artifacts.id, reg.artifactId)).get()
  const srcAfter = db.select().from(sources).where(eq(sources.id, reg.sourceId!)).get()
  assert(artAfter?.projectId != null, "after the 0020 backfill A's artifact has a non-null project_id")
  assert(srcAfter?.projectId != null, "after the 0020 backfill A's source has a non-null project_id")
  // …and it landed in one of A's OWN projects, never B's (no cross-tenant attach).
  const aProjectIds = new Set(listProjects(a).map((p) => p.id))
  assert(aProjectIds.has(artAfter!.projectId!), "A's backfilled artifact points at one of A's OWN projects")
  assert(aProjectIds.has(srcAfter!.projectId!), "A's backfilled source points at one of A's OWN projects")

  // Whole-table no-orphan guarantee after backfill.
  const orphanTl = sqlite.prepare('SELECT COUNT(*) AS n FROM timelines WHERE project_id IS NULL').get() as { n: number }
  const orphanArt = sqlite.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id IS NULL').get() as { n: number }
  const orphanSrc = sqlite.prepare('SELECT COUNT(*) AS n FROM sources WHERE project_id IS NULL').get() as { n: number }
  assert(orphanTl.n === 0, 'NO timeline is left without a project after backfill')
  assert(orphanArt.n === 0, 'NO artifact is left without a project after backfill')
  assert(orphanSrc.n === 0, 'NO source is left without a project after backfill')
  // No owned row ever points at the wrong owner's project (fail-closed).
  const cross = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT owner_id, project_id FROM timelines WHERE project_id IS NOT NULL
         UNION ALL SELECT owner_id, project_id FROM artifacts WHERE project_id IS NOT NULL
         UNION ALL SELECT owner_id, project_id FROM sources WHERE project_id IS NOT NULL
       ) r JOIN projects p ON p.id = r.project_id WHERE p.owner_id <> r.owner_id`,
    )
    .get() as { n: number }
  assert(cross.n === 0, 'NO owned row points at another owner\'s project (no cross-tenant attachment)')

  // === (d) listTimelines(projectId) narrows correctly within an owner ======
  console.log('\n(d) listTimelines(projectId) filter narrows within an owner')
  const pA2 = createProject('A second project', a)
  const tlIn2 = createTimeline('A timeline in project 2', a, pA2.id)

  const inPA = listTimelines(a, pA.id)
  assert(inPA.some((t) => t.id === tlExplicit.id), 'listTimelines(A, pA) includes the pA timeline')
  assert(!inPA.some((t) => t.id === tlIn2.id), 'listTimelines(A, pA) EXCLUDES the pA2 timeline (narrowed)')

  const inPA2 = listTimelines(a, pA2.id)
  assert(inPA2.some((t) => t.id === tlIn2.id), 'listTimelines(A, pA2) includes the pA2 timeline')
  assert(!inPA2.some((t) => t.id === tlExplicit.id), 'listTimelines(A, pA2) EXCLUDES the pA timeline (narrowed)')

  const all = listTimelines(a)
  assert(
    all.some((t) => t.id === tlExplicit.id) && all.some((t) => t.id === tlIn2.id),
    'listTimelines(A) with NO filter returns timelines across ALL A\'s projects (today\'s behavior preserved)',
  )
  // the filter is WITHIN-owner only: filtering by A's project from B's list yields nothing
  assert(listTimelines(b, pA.id).length === 0, "listTimelines(B, A's project) returns nothing (filter never crosses owners)")

  // === (e) sharing is still PER-TIMELINE — no project visibility leak =======
  console.log('\n(e) sharing is per-timeline; no project visibility leak')
  // Publish ONE timeline in A's project (the share-a-story primitive).
  setTimelinePublic(tlExplicit.id, a, true)
  const sharedMeta = getTimelineMeta(tlExplicit.id)
  assert(sharedMeta?.isPublic === true, 'publishing a timeline flips ONLY its isPublic flag')

  // Its sibling in the SAME project stays private — publication does not cascade.
  ensureTimeline('verify-projects-sibling-tl', a, 'A sibling in pA', pA.id)
  const sibling = getTimelineMeta('verify-projects-sibling-tl')
  assert(sibling?.projectId === pA.id, 'sibling shares the same project as the published timeline')
  assert(sibling?.isPublic === false, "the sibling in the SAME project stays PRIVATE (sharing does NOT cascade to the project)")

  // The project container itself carries no public flag — there is no
  // project-level visibility surface to leak. Confirm the project shape exposes
  // none of isPublic.
  const projShape = getProject(pA.id)
  assert(!!projShape && !('isPublic' in (projShape as object)), 'the project row exposes NO isPublic — visibility lives ONLY on timelines')

  // Publishing did not move/relabel the project or change its membership.
  assert(getTimelineMeta(tlExplicit.id)?.projectId === pA.id, 'a shared timeline keeps its project membership (share != move)')

  // theme inheritance still resolves through the project (the only thing the
  // container governs) and is unaffected by isPublic.
  updateProject(pA.id, a, { theme: { name: 'Imperial Marble', font: { display: 'serif' } } })
  const resolved = resolveTimelineTheme(getTimelineMeta(tlExplicit.id)!)
  assert(resolved != null, 'a shared timeline still inherits its project theme (container governs theme, not visibility)')

  // === (f) getProjectBySlug is owner-scoped (the /p/$slug resolver) =========
  console.log('\n(f) getProjectBySlug is owner-scoped (no cross-owner reveal)')
  const aBySlug = getProjectBySlug(pA.slug, a)
  assert(aBySlug?.id === pA.id, 'A resolves her OWN project by slug')
  assert(getProjectBySlug(pA.slug, b) === null, "B resolving A's slug returns null (foreign slug = no reveal)")
  assert(getProjectBySlug('definitely-not-a-real-slug', a) === null, 'an unknown slug returns null (not a throw, soft fail)')
  // missing and foreign both collapse to null — indistinguishable, so /p/$slug
  // can bounce both to `/` without leaking which case it was.
  assert(
    getProjectBySlug(pA.slug, b) === getProjectBySlug('definitely-not-a-real-slug', b),
    "a foreign slug and a missing slug are INDISTINGUISHABLE (both null) — existence never leaks",
  )

  // === (g) moveTimelineToProject: double owner-check (move affordance) ======
  console.log('\n(g) moveTimelineToProject double owner-check (local-126)')
  // A moves her own timeline from pA → pA2 (the happy path). The SERVER fn
  // own-checks the target project via requireOwnedProject; here we exercise the
  // db helper after asserting that guard would pass for A's own target.
  requireOwnedProjectA(pA2.id)
  moveTimelineToProject(tlExplicit.id, a, pA2.id)
  assert(getTimelineMeta(tlExplicit.id)?.projectId === pA2.id, 'A moved her own timeline pA → pA2')
  assert(listTimelines(a, pA2.id).some((t) => t.id === tlExplicit.id), 'the moved timeline now lists under pA2')
  assert(!listTimelines(a, pA.id).some((t) => t.id === tlExplicit.id), 'the moved timeline no longer lists under pA')
  // move it back so later assertions about membership/theme aren't disturbed.
  moveTimelineToProject(tlExplicit.id, a, pA.id)
  assert(getTimelineMeta(tlExplicit.id)?.projectId === pA.id, 'A moved the timeline back to pA')

  // (g1) B cannot move A's timeline: the db helper's ownerId predicate no-ops.
  moveTimelineToProject(tlExplicit.id, b, pA2.id)
  assert(
    getTimelineMeta(tlExplicit.id)?.projectId === pA.id,
    "B's move of A's timeline NO-OPS (ownerId predicate) — a foreign timeline can't be reassigned",
  )
  // (g2) the server fn's target own-check is the OTHER half: B (or A) moving into
  // a foreign target project must be denied by requireOwnedProject. Prove the
  // guard the server fn runs rejects A targeting B's project.
  const pB = createProject('B private project', b)
  denied('A move-into B project (requireOwnedProject target guard)', () => requireOwnedProjectA(pB.id))
  // And A actually attempting the move into B's project, with the guard skipped,
  // would corrupt tenancy — so the server fn's guard is load-bearing; here we
  // only assert the membership is still A's own project (the guard prevents the call).
  assert(getTimelineMeta(tlExplicit.id)?.projectId === pA.id, "A's timeline stays in A's project (never lands in B's)")

  console.log(
    '\nProjects contract verified ✓  (owner-scoped CRUD · cross-owner denial · every row has a project · projectId filter narrows · sharing stays per-timeline · slug resolver owner-scoped · move double-checks owner)',
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
