import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, projects, brands } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import {
  listBrands,
  createBrand,
  getBrand,
  updateBrand,
  deleteBrand,
  setProjectBrand,
  makeRequireOwnedBrand,
} from '../src/lib/db/brands'
import { createProject, getProject } from '../src/lib/db/projects'
import { brandKitSchema, type BrandKit } from '../src/lib/domain/brand'

// Brands contract test (stories-first slice 2), at the DATA layer — the same
// boundary verify-isolation.ts / verify-projects.ts exercise. Proves:
//   (a) brand CRUD is owner-scoped (a non-owner mutation no-ops; reads own-check)
//   (b) a second owner CANNOT read / get / update / delete / link the first owner's
//       brand (cross-owner denial)
//   (c) brandKitSchema validates a FULL kit + REJECTS malformed input; the stored
//       kit round-trips
//   (d) setProjectBrand owner-checks BOTH the project AND the brand
//   (e) deleteBrand nulls projects.brandId (ON DELETE SET NULL) — the project
//       survives, the link clears
// Run under Node: `bun run verify:brands`.

const A_EMAIL = 'brand-a@synek.app'
const B_EMAIL = 'brand-b@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

// A db-layer call that MUST throw for a non-owner (or a foreign target).
function denied(label: string, fn: () => unknown) {
  try {
    fn()
  } catch {
    console.log(`  ✓ denied: ${label}`)
    return
  }
  throw new Error(`LEAK: ${label} was NOT denied`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'brands-pw-123', name: email } })
  } catch {
    /* already exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create user ${email}`)
  return row.id
}

// A fully-populated kit, parsed through the schema so any contract drift fails here.
function sampleKit(name: string, slug: string): BrandKit {
  return brandKitSchema.parse({
    name,
    slug,
    tagline: 'Roasted small, shipped fresh',
    description: 'A specialty coffee brand.',
    industries: ['Food & Beverage', 'Retail'],
    targetAudience: 'Home brewers who care about origin.',
    brandAttributes: ['warm', 'precise', 'honest'],
    colors: ['#3B2A1A', '#D9A066', '#F4ECE2'],
    fonts: [{ name: 'Inter', family: 'Inter, system-ui, sans-serif', category: 'body', weights: ['400', '600'] }],
    logoUrl: 'https://example.com/logo.svg',
    mission: 'Make great coffee approachable.',
    vision: 'A considered cup, every morning.',
    coreValues: [{ name: 'Craft', description: 'Every batch, dialed in.' }],
    keyMessages: ['Origin matters', 'Freshness is a deadline'],
    visualAesthetic: 'Warm earth tones, generous whitespace.',
    voiceSchema: {
      version: 1,
      personalityTraits: [{ trait: 'Confident', intensity: 7 }],
      writingRules: [
        { type: 'do', rule: 'Lead with origin' },
        { type: 'dont', rule: 'Use empty superlatives' },
      ],
      toneSpectrum: [{ dimension: 'warmth', labelLow: 'Professional', labelHigh: 'Warm', value: 70 }],
      examplePhrases: ['Single-origin, small-batch, shipped within days of the roast.'],
      contentTypeVariations: [{ contentType: 'product', guidance: 'Concrete, tasting-note specific.' }],
      vocabulary: { preferred: ['origin', 'craft'], avoided: ['cheap'], jargonLevel: 'minimal' },
    },
  })
}

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  assert(a !== b, 'two distinct users exist')
  const reqA = makeRequireOwnedBrand(a)
  const reqB = makeRequireOwnedBrand(b)

  // === (a) brand CRUD is owner-scoped ======================================
  console.log('\n(a) brand CRUD is owner-scoped')
  const brA = createBrand(a, { name: 'Northwind Coffee' })
  assert(!!brA.id && !!brA.slug, 'A created a brand (id + slug)')
  assert(brA.ownerId === a, 'the new brand is owned by A')
  assert(brA.kit === null, 'a fresh brand has a null kit')

  const brA2 = createBrand(a, { name: 'Northwind Coffee' })
  assert(brA2.slug !== brA.slug, 'a same-name brand gets a deduped slug (global-unique handle)')

  assert(listBrands(a).some((x) => x.id === brA.id), 'A sees her own brand in listBrands')

  const kit = sampleKit('Northwind Coffee Co.', brA.slug)
  updateBrand(brA.id, a, { name: 'Northwind Coffee Co.', kit })
  const after = getBrand(brA.id, a)
  assert(after?.name === 'Northwind Coffee Co.', "A's updateBrand renamed the brand")
  assert(after?.slug === brA.slug, 'slug is immutable across rename (handle stays stable)')

  // requireOwnedBrand passes for the owner.
  reqA(brA.id)
  console.log("  ✓ requireOwnedBrand(A) accepts A's own brand")

  // === (c) kit validates a full kit + rejects malformed + round-trips ======
  console.log('\n(c) brandKitSchema validates + round-trips')
  assert(after?.kit != null, 'the kit persisted')
  const rt = brandKitSchema.safeParse(after!.kit)
  assert(rt.success, 'a stored FULL kit re-parses against brandKitSchema')
  assert(rt.success && rt.data.colors.length === 3, 'palette colors round-trip (3)')
  assert(rt.success && rt.data.voiceSchema?.writingRules.length === 2, 'voice writing rules round-trip (do + dont)')
  assert(rt.success && rt.data.voiceSchema?.toneSpectrum[0]?.value === 70, 'tone spectrum value round-trips (70)')
  assert(rt.success && rt.data.coreValues.length === 1, 'core values round-trip (1)')
  // Reject malformed input — bad hex, bad intensity, unknown key.
  assert(!brandKitSchema.safeParse({ name: 'X', slug: 'x', colors: ['nope'] }).success, 'schema rejects a bad hex color')
  assert(
    !brandKitSchema.safeParse({ name: 'X', slug: 'x', voiceSchema: { personalityTraits: [{ trait: 'T', intensity: 99 }] } }).success,
    'schema rejects an out-of-range trait intensity (1-10)',
  )
  assert(!brandKitSchema.safeParse({ name: 'X', slug: 'x', wat: true }).success, 'schema rejects an unknown key (strictObject)')
  assert(!brandKitSchema.safeParse({ slug: 'x' }).success, 'schema rejects a kit missing the required name')
  // kit clear + restore.
  updateBrand(brA.id, a, { kit: null })
  assert(getBrand(brA.id, a)?.kit === null, 'updateBrand(kit:null) clears the kit')
  updateBrand(brA.id, a, { kit })
  assert(getBrand(brA.id, a)?.kit != null, 'updateBrand restores the kit')

  // === (b) cross-owner denial ==============================================
  console.log('\n(b) cross-owner denial')
  assert(!listBrands(b).some((x) => x.id === brA.id), "B's listBrands excludes A's brand")
  assert(getBrand(brA.id, b) === null, "B's getBrand(A's brand) returns null (owner-scoped read)")
  updateBrand(brA.id, b, { name: 'HIJACKED' })
  assert(getBrand(brA.id, a)?.name === 'Northwind Coffee Co.', "B's updateBrand on A's brand NO-OPS")
  deleteBrand(brA.id, b)
  assert(getBrand(brA.id, a) != null, "B's deleteBrand on A's brand NO-OPS")
  denied('B requireOwnedBrand(A brand)', () => reqB(brA.id))

  // === (d) setProjectBrand owner-checks BOTH project and brand =============
  console.log('\n(d) setProjectBrand double owner-check')
  const pA = createProject('A Coffee Project', a)
  const pB = createProject('B Project', b)
  const brB = createBrand(b, { name: 'B Brand' })

  // happy path — A links HER project to HER brand.
  setProjectBrand(pA.id, a, brA.id)
  assert(getProject(pA.id)?.brandId === brA.id, "A linked her project to her own brand")

  // B cannot re-brand A's project: the project-side ownerId predicate no-ops.
  setProjectBrand(pA.id, b, null)
  assert(getProject(pA.id)?.brandId === brA.id, "B's setProjectBrand on A's project NO-OPS (project own-check)")

  // A cannot link her project to B's brand: the brand-side guard throws.
  denied("A link her project to B's brand", () => setProjectBrand(pA.id, a, brB.id))
  assert(getProject(pA.id)?.brandId === brA.id, "A's project still points at her OWN brand (foreign brand rejected)")

  // B cannot link his project to A's brand either: the brand-side guard throws.
  denied("B link his project to A's brand", () => setProjectBrand(pB.id, b, brA.id))
  assert(getProject(pB.id)?.brandId == null, "B's project has no brand (foreign brand rejected)")

  // A can unlink her own project.
  setProjectBrand(pA.id, a, null)
  assert(getProject(pA.id)?.brandId === null, 'A unlinked her project (brandId null)')
  setProjectBrand(pA.id, a, brA.id) // relink for (e)

  // === (e) deleteBrand nulls projects.brandId (SET NULL) ===================
  console.log('\n(e) deleteBrand SET NULLs the project link')
  assert(getProject(pA.id)?.brandId === brA.id, 'precondition: A\'s project is linked to her brand')
  deleteBrand(brA.id, a)
  assert(getBrand(brA.id, a) === null, 'A deleted her brand')
  const survivor = getProject(pA.id)
  assert(survivor != null, 'the linked project SURVIVES the brand delete (no cascade to the project)')
  assert(survivor?.brandId === null, 'deleting a brand SET NULL the project link (FK on delete set null)')

  // cleanup — drop the test users' projects + brands so a re-run starts clean.
  db.delete(projects).where(eq(projects.ownerId, a)).run()
  db.delete(projects).where(eq(projects.ownerId, b)).run()
  db.delete(brands).where(eq(brands.ownerId, a)).run()
  db.delete(brands).where(eq(brands.ownerId, b)).run()

  console.log(
    '\nBrands contract verified ✓  (owner-scoped CRUD · cross-owner denial · kit validates+rejects · setProjectBrand double-checks · delete SET NULLs the link)',
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
