import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, loadGraph } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import {
  createSource,
  createArtifact,
  updateArtifact,
  deleteArtifact,
  getArtifactById,
  registerArtifact,
  linkMomentArtifact,
  listArtifactsForMoment,
  searchArtifacts,
} from '../src/lib/db/artifacts'

// Proves the S2.1 data layer: sources/artifacts CRUD, the FTS5 external-content
// index + its sync triggers (insert/update/delete reflected in MATCH), search
// ranking/snippet/filters/timeline-scope, MATCH sanitization, and an opaque score.
// Run under Node: `bun run verify:artifacts`.

const TL = 'verify-artifacts'
const VERIFY_EMAIL = 'verify-artifacts@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

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

function addMoment(title: string): string {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [{ op: 'add_node', ref: 'm', type: 'event', title, start: '100' }])
  commitPatch(TL, builder, `add ${title}`)
  return (results[0] as { id: string }).id
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Artifacts verify')

  // === sources + artifacts CRUD ============================================
  console.log('CRUD — source + artifact round-trip')
  const src = createSource({ ownerId, title: 'Vindolanda Tablets', author: 'Bowman & Thomas', year: 1994, sourceType: 'archive' })
  assert(!!src.id && src.title === 'Vindolanda Tablets', 'source created')

  const a1 = createArtifact({ ownerId,
    title: 'Tablet 291',
    artifactType: 'letter',
    transcript: 'a Roman letter inviting Sulpicia to a birthday',
    reliability: 'primary',
    sourceType: 'primary',
    sourceId: src.id,
    dateInstant: -59011200000,
    datePrecision: 'year',
  })
  const got = getArtifactById(a1.id, ownerId)
  assert(!!got && got.title === 'Tablet 291' && got.sourceId === src.id, 'artifact round-trips with sourceId')
  assert(got!.reliability === 'primary' && got!.sourceType === 'primary', 'reliability + genre sourceType both stored')

  const a2 = createArtifact({ ownerId, title: 'Census Record', artifactType: 'record', transcript: 'a Roman census of the colony', reliability: 'secondary' })

  // === FTS5: insert reflected in MATCH =====================================
  console.log('FTS5 — insert/update/delete reflected in search')
  assert(searchArtifacts({ ownerId, query: 'birthday' }).some((r) => r.id === a1.id), 'insert trigger indexed a1 (transcript term)')
  assert(searchArtifacts({ ownerId, query: 'census' }).some((r) => r.id === a2.id), 'insert trigger indexed a2')

  // update → re-MATCH (AFTER UPDATE trigger reindexes)
  updateArtifact(a1.id, { transcript: 'a Roman letter mentioning Zenodotus the scribe' }, ownerId)
  assert(searchArtifacts({ ownerId, query: 'Zenodotus' }).some((r) => r.id === a1.id), 'update trigger reindexed the new term')
  assert(!searchArtifacts({ ownerId, query: 'birthday' }).some((r) => r.id === a1.id), 'update trigger evicted the old term')

  // delete → gone from FTS (AFTER DELETE trigger)
  deleteArtifact(a2.id, ownerId)
  assert(searchArtifacts({ ownerId, query: 'census' }).length === 0, 'delete trigger evicted a2 from the index')

  // === filters + ranking + snippet + opaque score ==========================
  console.log('search — filters, snippet, opaque score')
  const a3 = createArtifact({ ownerId, title: 'Roman Coin', artifactType: 'object', transcript: 'a Roman bronze coin', reliability: 'tertiary' })
  const roman = searchArtifacts({ ownerId, query: 'Roman' })
  assert(roman.length >= 2 && roman.every((r) => 'score' in r), 'Roman matches multiple, each carries a score')
  assert(roman.every((r) => !('rank' in r) && !('bm25' in r)), 'no backend key (rank/bm25) leaks — score is opaque')
  assert(roman.every((r, i) => i === 0 || roman[i - 1]!.score >= r.score), 'results sorted by score, higher is better')
  assert(roman.some((r) => r.snippet.length > 0), 'snippet() populated')

  assert(searchArtifacts({ ownerId, query: 'Roman', types: ['letter'] }).every((r) => r.artifactType === 'letter'), 'type filter narrows')
  assert(searchArtifacts({ ownerId, query: 'Roman', reliability: ['tertiary'] }).every((r) => r.id === a3.id), 'reliability filter narrows')

  // MATCH sanitization — punctuation/operators must not throw, real terms survive
  assert(
    searchArtifacts({ ownerId, query: 'Roman?! ("bronze")' }).some((r) => r.id === a3.id),
    'punctuation stripped, real terms (Roman + bronze) still match a3',
  )
  assert(searchArtifacts({ ownerId, query: '-- ( ) !! :*' }).length === 0, 'all-punctuation query returns [] without throwing')

  // === moment link + timeline scope ========================================
  console.log('moment link + timelineId scope')
  const moment = addMoment('A Roman moment')
  linkMomentArtifact(moment, a1.id)
  assert(listArtifactsForMoment(moment).some((a) => a.id === a1.id), 'listArtifactsForMoment returns the linked artifact')

  const scoped = searchArtifacts({ ownerId, query: 'Roman', timelineId: TL })
  assert(scoped.some((r) => r.id === a1.id), 'timeline-scoped search includes the linked artifact')
  assert(!scoped.some((r) => r.id === a3.id), 'timeline-scoped search excludes an UNlinked artifact')
  assert(searchArtifacts({ ownerId, query: 'Roman' }).some((r) => r.id === a3.id), 'unscoped search still includes it')

  // === registerArtifact orchestration (source + artifact + moment in one txn)
  console.log('registerArtifact — source + artifact + moment link in one transaction')
  const reg = registerArtifact({
    ownerId,
    artifact: { title: 'Altar Inscription', artifactType: 'inscription', transcript: 'a Roman dedication to Mithras' },
    source: { title: 'Corpus Inscriptionum', sourceType: 'book' },
    momentId: moment,
  })
  assert(!!reg.artifactId && !!reg.sourceId, 'registerArtifact returns artifact + source ids')
  assert(getArtifactById(reg.artifactId, ownerId)!.sourceId === reg.sourceId, 'artifact wired to the new source')
  assert(listArtifactsForMoment(moment).some((a) => a.id === reg.artifactId), 'registered artifact linked to the moment')

  console.log('\nS2.1 artifacts data layer + FTS5 ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
